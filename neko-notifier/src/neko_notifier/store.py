"""Thread-safe in-memory approval lease store."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from threading import RLock
from time import monotonic

from . import DEFAULT_LEASE_TTL_SECONDS, MAX_NOTIFICATIONS


@dataclass(frozen=True, slots=True)
class ApprovalLease:
    """One pending approval owned by a VS Code extension window."""

    notification_id: str
    title: str
    body: str
    callback_url: str
    callback_token: str
    client_id: str
    created_sequence: int
    expires_at: float


@dataclass(frozen=True, slots=True)
class LeaseInput:
    """Validated data used to create or update an approval lease."""

    notification_id: str
    title: str
    body: str
    callback_url: str
    callback_token: str
    client_id: str


class CapacityError(RuntimeError):
    """Raised when a new lease would exceed the configured queue capacity."""


class ApprovalStore:
    """Maintain pending approvals in stable first-received FIFO order."""

    def __init__(
        self,
        *,
        ttl_seconds: float = DEFAULT_LEASE_TTL_SECONDS,
        max_notifications: int = MAX_NOTIFICATIONS,
        clock: Callable[[], float] = monotonic,
        on_change: Callable[[int], None] | None = None,
    ) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        if max_notifications <= 0:
            raise ValueError("max_notifications must be positive")
        self._ttl_seconds = ttl_seconds
        self._max_notifications = max_notifications
        self._clock = clock
        self._on_change = on_change
        self._leases: dict[str, ApprovalLease] = {}
        self._next_sequence = 1
        self._lock = RLock()

    def upsert(self, value: LeaseInput) -> ApprovalLease:
        """Create or refresh a lease without changing an existing lease's FIFO position."""
        changed_count: int | None = None
        with self._lock:
            now = self._clock()
            changed_count = self._prune_locked(now)
            existing = self._leases.get(value.notification_id)
            if existing is None:
                if len(self._leases) >= self._max_notifications:
                    self._notify(changed_count)
                    raise CapacityError("notification queue is full")
                sequence = self._next_sequence
                self._next_sequence += 1
            else:
                sequence = existing.created_sequence

            lease = ApprovalLease(
                notification_id=value.notification_id,
                title=value.title,
                body=value.body,
                callback_url=value.callback_url,
                callback_token=value.callback_token,
                client_id=value.client_id,
                created_sequence=sequence,
                expires_at=now + self._ttl_seconds,
            )
            self._leases[value.notification_id] = lease
            if existing is None:
                changed_count = len(self._leases)
        self._notify(changed_count)
        return lease

    def heartbeat(self, notification_ids: Iterable[str], *, client_id: str) -> tuple[str, ...]:
        """Refresh leases owned by a client and return the IDs that were actually refreshed."""
        changed_count: int | None = None
        refreshed: list[str] = []
        with self._lock:
            now = self._clock()
            changed_count = self._prune_locked(now)
            expires_at = now + self._ttl_seconds
            for notification_id in dict.fromkeys(notification_ids):
                lease = self._leases.get(notification_id)
                if lease is None or lease.client_id != client_id:
                    continue
                self._leases[notification_id] = replace(lease, expires_at=expires_at)
                refreshed.append(notification_id)
        self._notify(changed_count)
        return tuple(refreshed)

    def remove(self, notification_id: str, *, client_id: str | None = None) -> bool:
        """Remove a lease idempotently, optionally requiring matching ownership."""
        changed_count: int | None = None
        removed = False
        with self._lock:
            now = self._clock()
            changed_count = self._prune_locked(now)
            lease = self._leases.get(notification_id)
            if lease is not None and (client_id is None or lease.client_id == client_id):
                del self._leases[notification_id]
                removed = True
                changed_count = len(self._leases)
        self._notify(changed_count)
        return removed

    def remove_client(self, client_id: str) -> int:
        """Remove every lease owned by one extension window."""
        changed_count: int | None = None
        with self._lock:
            now = self._clock()
            changed_count = self._prune_locked(now)
            owned_ids = [lease.notification_id for lease in self._leases.values() if lease.client_id == client_id]
            for notification_id in owned_ids:
                del self._leases[notification_id]
            if owned_ids:
                changed_count = len(self._leases)
        self._notify(changed_count)
        return len(owned_ids)

    def first(self) -> ApprovalLease | None:
        """Return the oldest live lease without dismissing or reordering it."""
        changed_count: int | None = None
        with self._lock:
            changed_count = self._prune_locked(self._clock())
            lease = min(self._leases.values(), key=lambda item: item.created_sequence, default=None)
        self._notify(changed_count)
        return lease

    def count(self) -> int:
        """Return the number of live leases."""
        changed_count: int | None = None
        with self._lock:
            changed_count = self._prune_locked(self._clock())
            count = len(self._leases)
        self._notify(changed_count)
        return count

    def prune_expired(self) -> int:
        """Remove expired leases and return how many were removed."""
        changed_count: int | None = None
        with self._lock:
            before = len(self._leases)
            changed_count = self._prune_locked(self._clock())
            removed = before - len(self._leases)
        self._notify(changed_count)
        return removed

    def snapshot(self) -> tuple[ApprovalLease, ...]:
        """Return a live FIFO-ordered immutable snapshot."""
        changed_count: int | None = None
        with self._lock:
            changed_count = self._prune_locked(self._clock())
            snapshot = tuple(sorted(self._leases.values(), key=lambda item: item.created_sequence))
        self._notify(changed_count)
        return snapshot

    def _prune_locked(self, now: float) -> int | None:
        expired = [notification_id for notification_id, lease in self._leases.items() if lease.expires_at <= now]
        for notification_id in expired:
            del self._leases[notification_id]
        return len(self._leases) if expired else None

    def _notify(self, count: int | None) -> None:
        if count is not None and self._on_change is not None:
            self._on_change(count)

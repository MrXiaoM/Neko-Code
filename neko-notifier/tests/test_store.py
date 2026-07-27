from __future__ import annotations

from dataclasses import dataclass

import pytest

from neko_notifier.store import ApprovalStore, CapacityError, LeaseInput


@dataclass
class FakeClock:
    value: float = 100.0

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def lease(notification_id: str, client_id: str = "window-1", title: str | None = None) -> LeaseInput:
    return LeaseInput(
        notification_id=notification_id,
        client_id=client_id,
        title=title or notification_id,
        body=f"body-{notification_id}",
        callback_url="http://127.0.0.1:32100/focus",
        callback_token="x" * 48,
    )


def test_upsert_preserves_first_received_fifo_position() -> None:
    clock = FakeClock()
    store = ApprovalStore(clock=clock)

    store.upsert(lease("first"))
    clock.advance(1)
    store.upsert(lease("second"))
    clock.advance(1)
    updated = store.upsert(lease("first", title="updated"))

    assert updated.title == "updated"
    assert [item.notification_id for item in store.snapshot()] == ["first", "second"]
    assert store.first() is not None
    assert store.first().notification_id == "first"


def test_heartbeat_refreshes_only_leases_owned_by_client() -> None:
    clock = FakeClock()
    store = ApprovalStore(ttl_seconds=10, clock=clock)
    store.upsert(lease("a", "window-1"))
    store.upsert(lease("b", "window-2"))

    clock.advance(8)
    assert store.heartbeat(["a", "b", "missing"], client_id="window-1") == ("a",)
    clock.advance(3)

    assert [item.notification_id for item in store.snapshot()] == ["a"]


def test_expired_leases_are_removed_and_change_is_reported() -> None:
    clock = FakeClock()
    counts: list[int] = []
    store = ApprovalStore(ttl_seconds=5, clock=clock, on_change=counts.append)
    store.upsert(lease("a"))
    store.upsert(lease("b"))

    clock.advance(5)

    assert store.prune_expired() == 2
    assert store.count() == 0
    assert counts == [1, 2, 0]


def test_remove_is_idempotent_and_requires_matching_owner() -> None:
    store = ApprovalStore()
    store.upsert(lease("a", "window-1"))

    assert store.remove("a", client_id="window-2") is False
    assert store.remove("a", client_id="window-1") is True
    assert store.remove("a", client_id="window-1") is False


def test_remove_client_does_not_touch_other_windows() -> None:
    store = ApprovalStore()
    store.upsert(lease("a", "window-1"))
    store.upsert(lease("b", "window-1"))
    store.upsert(lease("c", "window-2"))

    assert store.remove_client("window-1") == 2
    assert [item.notification_id for item in store.snapshot()] == ["c"]


def test_capacity_rejects_only_new_ids_but_allows_existing_update() -> None:
    store = ApprovalStore(max_notifications=1)
    store.upsert(lease("a"))

    store.upsert(lease("a", title="updated"))
    with pytest.raises(CapacityError):
        store.upsert(lease("b"))

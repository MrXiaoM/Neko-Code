"""Authenticated loopback HTTP API for approval lease management."""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import DEFAULT_HEARTBEAT_INTERVAL_SECONDS, DEFAULT_LEASE_TTL_SECONDS, PROTOCOL_VERSION
from .store import ApprovalStore, CapacityError, LeaseInput

Identifier = Annotated[str, Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9._:-]+$")]
Secret = Annotated[str, Field(min_length=32, max_length=256)]
DisplayText = Annotated[str, Field(min_length=1, max_length=512)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ProtocolRequest(StrictModel):
    protocol_version: int = Field(alias="protocolVersion")

    @field_validator("protocol_version")
    @classmethod
    def validate_protocol(cls, value: int) -> int:
        if value != PROTOCOL_VERSION:
            raise ValueError(f"unsupported protocol version: {value}")
        return value


class ApprovalRequest(ProtocolRequest):
    notification_id: Identifier = Field(alias="notificationId")
    client_id: Identifier = Field(alias="clientId")
    title: DisplayText
    body: DisplayText
    callback_url: Annotated[str, Field(min_length=1, max_length=2048)] = Field(alias="callbackUrl")
    callback_token: Secret = Field(alias="callbackToken")

    @field_validator("callback_url")
    @classmethod
    def validate_callback_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1":
            raise ValueError("callbackUrl must use http://127.0.0.1")
        if parsed.username is not None or parsed.password is not None or parsed.fragment:
            raise ValueError("callbackUrl must not contain credentials or a fragment")
        try:
            port = parsed.port
        except ValueError as error:
            raise ValueError("callbackUrl contains an invalid port") from error
        if port is None or not 1 <= port <= 65535 or not parsed.path.startswith("/"):
            raise ValueError("callbackUrl must include a valid port and absolute path")
        return value


class HeartbeatRequest(ProtocolRequest):
    client_id: Identifier = Field(alias="clientId")
    notification_ids: Annotated[list[Identifier], Field(max_length=256)] = Field(alias="notificationIds")


class DeleteClientRequest(ProtocolRequest):
    client_id: Identifier = Field(alias="clientId")


class HealthResponse(StrictModel):
    status: Literal["ok"] = "ok"
    protocol_version: int = Field(alias="protocolVersion")
    instance_id: str = Field(alias="instanceId")
    pending_count: int = Field(alias="pendingCount")
    lease_ttl_seconds: float = Field(alias="leaseTtlSeconds")
    heartbeat_interval_seconds: float = Field(alias="heartbeatIntervalSeconds")


class CountResponse(StrictModel):
    pending_count: int = Field(alias="pendingCount")


class HeartbeatResponse(CountResponse):
    refreshed_ids: list[str] = Field(alias="refreshedIds")


class DeleteResponse(CountResponse):
    removed: bool


class DeleteClientResponse(CountResponse):
    removed_count: int = Field(alias="removedCount")


@dataclass(frozen=True, slots=True)
class ApiContext:
    store: ApprovalStore
    token: str
    instance_id: str
    lease_ttl_seconds: float = DEFAULT_LEASE_TTL_SECONDS
    heartbeat_interval_seconds: float = DEFAULT_HEARTBEAT_INTERVAL_SECONDS


def create_app(context: ApiContext) -> FastAPI:
    """Build the private service API with no unauthenticated operational endpoints."""
    app = FastAPI(
        title="Neko Notifier",
        version=str(PROTOCOL_VERSION),
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    async def authenticate(
        request: Request,
        authorization: Annotated[str | None, Header()] = None,
    ) -> None:
        client_host = request.client.host if request.client else None
        if client_host not in {"127.0.0.1", "::1", "::ffff:127.0.0.1", "testclient"}:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        expected = f"Bearer {context.token}"
        if authorization is None or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, headers={"WWW-Authenticate": "Bearer"})

    auth_dependency = [Depends(authenticate)]

    @app.get(
        "/v1/health",
        response_model=HealthResponse,
        response_model_by_alias=True,
        dependencies=auth_dependency,
    )
    async def health() -> HealthResponse:
        return HealthResponse(
            protocolVersion=PROTOCOL_VERSION,
            instanceId=context.instance_id,
            pendingCount=context.store.count(),
            leaseTtlSeconds=context.lease_ttl_seconds,
            heartbeatIntervalSeconds=context.heartbeat_interval_seconds,
        )

    @app.put(
        "/v1/approvals/{notification_id}",
        response_model=CountResponse,
        response_model_by_alias=True,
        dependencies=auth_dependency,
    )
    async def upsert_approval(notification_id: str, payload: ApprovalRequest) -> CountResponse:
        if notification_id != payload.notification_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="notificationId does not match path")
        try:
            context.store.upsert(
                LeaseInput(
                    notification_id=payload.notification_id,
                    title=payload.title,
                    body=payload.body,
                    callback_url=payload.callback_url,
                    callback_token=payload.callback_token,
                    client_id=payload.client_id,
                )
            )
        except CapacityError as error:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(error)) from error
        return CountResponse(pendingCount=context.store.count())

    @app.post(
        "/v1/heartbeats",
        response_model=HeartbeatResponse,
        response_model_by_alias=True,
        dependencies=auth_dependency,
    )
    async def heartbeat(payload: HeartbeatRequest) -> HeartbeatResponse:
        refreshed = context.store.heartbeat(payload.notification_ids, client_id=payload.client_id)
        return HeartbeatResponse(refreshedIds=list(refreshed), pendingCount=context.store.count())

    @app.delete(
        "/v1/approvals/{notification_id}",
        response_model=DeleteResponse,
        response_model_by_alias=True,
        dependencies=auth_dependency,
    )
    async def delete_approval(
        notification_id: str,
        client_id: Annotated[str, Header(alias="X-Neko-Client-Id")],
        protocol_version: Annotated[int, Header(alias="X-Neko-Protocol-Version")],
    ) -> DeleteResponse:
        if protocol_version != PROTOCOL_VERSION:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="unsupported protocol version")
        removed = context.store.remove(notification_id, client_id=client_id)
        return DeleteResponse(removed=removed, pendingCount=context.store.count())

    @app.post(
        "/v1/clients/remove",
        response_model=DeleteClientResponse,
        response_model_by_alias=True,
        dependencies=auth_dependency,
    )
    async def delete_client(payload: DeleteClientRequest) -> DeleteClientResponse:
        removed_count = context.store.remove_client(payload.client_id)
        return DeleteClientResponse(removedCount=removed_count, pendingCount=context.store.count())

    return app

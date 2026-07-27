from __future__ import annotations

from fastapi.testclient import TestClient

from neko_notifier import PROTOCOL_VERSION
from neko_notifier.api import ApiContext, create_app
from neko_notifier.store import ApprovalStore

TOKEN = "service-token-" + "x" * 40
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def payload(notification_id: str = "approval-1", client_id: str = "window-1") -> dict[str, object]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "notificationId": notification_id,
        "clientId": client_id,
        "title": "Approval needed",
        "body": "Review this command",
        "callbackUrl": "http://127.0.0.1:41000/neko-focus/token",
        "callbackToken": "callback-" + "y" * 40,
    }


def make_client() -> tuple[TestClient, ApprovalStore]:
    store = ApprovalStore()
    app = create_app(ApiContext(store=store, token=TOKEN, instance_id="instance-1"))
    return TestClient(app), store


def test_health_requires_authentication_and_returns_instance_identity() -> None:
    client, _store = make_client()

    assert client.get("/v1/health").status_code == 401
    assert client.get("/v1/health", headers={"Authorization": "Bearer wrong"}).status_code == 401

    response = client.get("/v1/health", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "protocolVersion": PROTOCOL_VERSION,
        "instanceId": "instance-1",
        "pendingCount": 0,
        "leaseTtlSeconds": 20.0,
        "heartbeatIntervalSeconds": 5.0,
    }


def test_upsert_heartbeat_and_delete_are_owner_scoped() -> None:
    client, store = make_client()

    response = client.put("/v1/approvals/approval-1", headers=AUTH, json=payload())
    assert response.status_code == 200
    assert response.json() == {"pendingCount": 1}

    heartbeat = client.post(
        "/v1/heartbeats",
        headers=AUTH,
        json={
            "protocolVersion": PROTOCOL_VERSION,
            "clientId": "window-2",
            "notificationIds": ["approval-1"],
        },
    )
    assert heartbeat.status_code == 200
    assert heartbeat.json()["refreshedIds"] == []

    wrong_owner = client.delete(
        "/v1/approvals/approval-1",
        headers={**AUTH, "X-Neko-Client-Id": "window-2", "X-Neko-Protocol-Version": str(PROTOCOL_VERSION)},
    )
    assert wrong_owner.status_code == 200
    assert wrong_owner.json() == {"pendingCount": 1, "removed": False}

    right_owner = client.delete(
        "/v1/approvals/approval-1",
        headers={**AUTH, "X-Neko-Client-Id": "window-1", "X-Neko-Protocol-Version": str(PROTOCOL_VERSION)},
    )
    assert right_owner.json() == {"pendingCount": 0, "removed": True}
    assert store.count() == 0


def test_rejects_path_mismatch_unsupported_protocol_and_non_loopback_callback() -> None:
    client, _store = make_client()

    assert client.put("/v1/approvals/other", headers=AUTH, json=payload()).status_code == 409

    wrong_protocol = payload()
    wrong_protocol["protocolVersion"] = PROTOCOL_VERSION + 1
    assert client.put("/v1/approvals/approval-1", headers=AUTH, json=wrong_protocol).status_code == 422

    unsafe_callback = payload()
    unsafe_callback["callbackUrl"] = "http://192.168.1.2:41000/focus"
    assert client.put("/v1/approvals/approval-1", headers=AUTH, json=unsafe_callback).status_code == 422


def test_remove_client_clears_only_that_window() -> None:
    client, store = make_client()
    client.put("/v1/approvals/a", headers=AUTH, json=payload("a", "window-1"))
    client.put("/v1/approvals/b", headers=AUTH, json=payload("b", "window-2"))

    response = client.post(
        "/v1/clients/remove",
        headers=AUTH,
        json={"protocolVersion": PROTOCOL_VERSION, "clientId": "window-1"},
    )

    assert response.status_code == 200
    assert response.json() == {"pendingCount": 1, "removedCount": 1}
    assert [item.notification_id for item in store.snapshot()] == ["b"]

"""TC-35-01/02/03: actual Flask → PostgREST → PostgreSQL, isolated test data."""

import importlib
import os
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from app import create_app

from .conftest import ORIGIN, select_user
from .test_equipment import details

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


@pytest.fixture
def live_requests(monkeypatch):
    assert os.environ["POSTGREST_TEST_URL"] in (
        "http://127.0.0.1:55433",
        "http://localhost:55433",
    ), "Use only the disposable database."
    with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as db:
        for name in (
            "users",
            "equipment_repository",
            "equipment_request_repository",
            "rbac",
            "auth",
        ):
            monkeypatch.setattr(
                importlib.import_module(f"app.{name}"), "get_supabase_client", lambda: db
            )
        app = create_app(
            {
                "TESTING": True,
                "APP_ENV": "development",
                "DEV_ROLE_SWITCHER_ENABLED": True,
                "SECRET_KEY": "test-only",
                "FRONTEND_ORIGIN": ORIGIN["Origin"],
            }
        )
        users = {number: app.test_client() for number in (1, 2, 3, 4, 5, 7)}
        for number, client in users.items():
            assert select_user(client, number).status_code == 200
        event_ids, stock_ids = [], []

        def make_event(coordinator=2, status="Planning"):
            row = (
                db.table("events")
                .insert(
                    {
                        "title": f"Request acceptance {uuid4()}",
                        "description": "Test event",
                        "purpose": "Acceptance",
                        "category": "Workshop",
                        "expected_attendance": 20,
                        "event_datetime": "2099-10-20T06:00:00Z",
                        "organiser_id": 1,
                        "coordinator_id": coordinator,
                        "status": status,
                        "submitted_at": "2026-10-01T06:00:00Z",
                    }
                )
                .execute()
                .data[0]
            )
            event_ids.append(row["id"])
            return row

        event = make_event()
        for _ in range(2):
            response = users[4].post(
                "/equipment",
                json={
                    **details(),
                    "equipment_type": f"Request acceptance {uuid4()}",
                },
                headers=ORIGIN,
            )
            assert response.status_code == 201
            stock_ids.append(response.json["equipment"]["id"])
        items = [
            {"equipment_id": stock_ids[0], "quantity": 1, "technical_notes": " HDMI "},
            {"equipment_id": stock_ids[1], "quantity": 12, "technical_notes": "Spare batteries"},
        ]
        try:
            yield db, users, event, items, make_event
        finally:
            for event_id in event_ids:
                db.table("equipment_requests").delete().eq("event_id", event_id).execute()
                db.table("events").delete().eq("id", event_id).execute()
            for stock_id in stock_ids:
                db.table("equipment_items").delete().eq("id", stock_id).execute()


def test_record_two_items_routing_audit_reload_and_no_stock_change(live_requests):
    db, users, event, items, _ = live_requests
    response = users[2].post(
        "/equipment/requests", json={"event_id": event["id"], "items": items}, headers=ORIGIN
    )
    assert response.status_code == 201, response.json
    saved = response.json["request"]
    assert saved["event_id"] == event["id"]
    assert saved["status"] == "Requested" and saved["routed_to"] == "Tech Support"
    assert saved["requested_by"] == 2 and saved["requested_at"]
    for actor in (2, 4):
        rows = users[actor].get("/equipment/requests", headers=ORIGIN).json["requests"]
        found = next(row for row in rows if row["id"] == saved["id"])
        assert found["event"]["title"] == event["title"]
        assert found["requester"]["display_name"] == "Demo Coordinator"
        assert [line["quantity"] for line in found["items"]] == [1, 12]
        assert [line["technical_notes"] for line in found["items"]] == ["HDMI", "Spare batteries"]
        assert [line["equipment_id"] for line in found["items"]] == [
            i["equipment_id"] for i in items
        ]
    assert users[7].get("/equipment/requests", headers=ORIGIN).json["requests"] == []
    assert db.table("equipment_requests").select("*").eq("id", saved["id"]).execute().data == [
        saved
    ]
    assert all(
        row["total_quantity"] == 8
        for row in db.table("equipment_items")
        .select("*")
        .in_("id", [item["equipment_id"] for item in items])
        .execute()
        .data
    )


@pytest.mark.parametrize("quantity", [0, -1, 1.5, True, "1", None, 2147483648])
def test_api_and_database_reject_invalid_second_item_atomically(live_requests, quantity):
    db, users, event, items, _ = live_requests
    items[1]["quantity"] = quantity
    assert (
        users[2]
        .post("/equipment/requests", json={"event_id": event["id"], "items": items}, headers=ORIGIN)
        .status_code
        == 400
    )
    with pytest.raises(APIError):
        db.rpc(
            "record_equipment_request",
            {
                "p_event_id": event["id"],
                "p_items": items,
                "p_actor_id": 2,
            },
        ).execute()
    assert (
        db.table("equipment_requests").select("*").eq("event_id", event["id"]).execute().data == []
    )
    assert (
        db.table("equipment_request_items")
        .select("*")
        .eq("equipment_id", items[0]["equipment_id"])
        .execute()
        .data
        == []
    )


def test_event_ownership_roles_and_planning_are_enforced_in_database(live_requests):
    db, users, event, items, make_event = live_requests
    for actor in (1, 3, 4, 5, 7):
        assert (
            users[actor]
            .post(
                "/equipment/requests",
                json={"event_id": event["id"], "items": items},
                headers=ORIGIN,
            )
            .status_code
            == 403
        )
        with pytest.raises(APIError) as caught:
            db.rpc(
                "record_equipment_request",
                {
                    "p_event_id": event["id"],
                    "p_items": items,
                    "p_actor_id": actor,
                },
            ).execute()
        assert caught.value.code == "PT403"
    cancelled = make_event(status="Cancelled")
    assert (
        users[2]
        .post(
            "/equipment/requests",
            json={"event_id": cancelled["id"], "items": items},
            headers=ORIGIN,
        )
        .status_code
        == 409
    )
    assert users[7].get("/equipment/requests/events", headers=ORIGIN).json["events"] == []
    options = users[2].get("/equipment/requests/events", headers=ORIGIN).json["events"]
    assert event["id"] in [row["id"] for row in options]
    assert cancelled["id"] not in [row["id"] for row in options]


def test_duplicate_or_missing_equipment_cannot_leave_partial_request(live_requests):
    db, users, event, items, _ = live_requests
    for second in (items[0], {**items[1], "equipment_id": str(uuid4())}):
        with pytest.raises(APIError):
            db.rpc(
                "record_equipment_request",
                {
                    "p_event_id": event["id"],
                    "p_items": [items[0], second],
                    "p_actor_id": 2,
                },
            ).execute()
    assert users[4].get("/equipment/requests", headers=ORIGIN).json["requests"] == []


def test_queue_filters_before_pagination_and_preserves_item_snapshot(live_requests):
    db, users, event, items, make_event = live_requests
    own_ids = []
    for _ in range(7):
        response = users[2].post(
            "/equipment/requests", json={"event_id": event["id"], "items": items}, headers=ORIGIN
        )
        assert response.status_code == 201
        own_ids.append(response.json["request"]["id"])
    other = make_event(coordinator=7)
    response = users[7].post(
        "/equipment/requests", json={"event_id": other["id"], "items": items}, headers=ORIGIN
    )
    assert response.status_code == 201
    first = users[2].get("/equipment/requests?page=1", headers=ORIGIN).json
    second = users[2].get("/equipment/requests?page=2", headers=ORIGIN).json
    assert first["has_more"] is True and second["has_more"] is False
    assert [row["id"] for row in first["requests"] + second["requests"]] == own_ids[::-1]
    stock_id = items[0]["equipment_id"]
    original_type = first["requests"][0]["items"][0]["equipment_type"]
    assert users[4].put(f"/equipment/{stock_id}", json={
        **details(), "equipment_type": "Renamed after request", "revision": 1,
    }, headers=ORIGIN).status_code == 200
    reloaded = users[2].get("/equipment/requests", headers=ORIGIN).json["requests"][0]
    assert reloaded["items"][0]["equipment_type"] == original_type

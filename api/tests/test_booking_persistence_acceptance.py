"""SCRUM-126/31/39: real persisted arrangements survive edits, refusals and failures."""

import importlib
import os
from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from app import create_app

from .conftest import ORIGIN, select_user
from .test_equipment import details as equipment_details
from .test_venues import details

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"), reason="Disposable acceptance database required",
)


@pytest.fixture
def arrangements(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in ("http://127.0.0.1:55433", "http://localhost:55433")
    with SyncPostgrestClient(url) as db:
        for module in (
            "users", "auth", "rbac", "event_repository", "booking_repository",
            "venue_repository", "bookings", "equipment_request_repository", "equipment_repository",
        ):
            monkeypatch.setattr(importlib.import_module(f"app.{module}"),
                                "get_supabase_client", lambda: db)
        app = create_app({
            "TESTING": True, "APP_ENV": "development", "DEV_ROLE_SWITCHER_ENABLED": True,
            "SECRET_KEY": "acceptance-test-only", "FRONTEND_ORIGIN": ORIGIN["Origin"],
        })
        users = {number: app.test_client() for number in (1, 2, 3, 4, 5, 7)}
        for number, client in users.items():
            assert select_user(client, number).status_code == 200
        event = db.table("events").insert({
            "title": f"Independent arrangements {uuid4()}", "description": "Workshop",
            "purpose": "Learn", "category": "Workshop", "status": "Planning",
            "event_datetime": "2099-10-20T06:00:00Z", "expected_attendance": 40,
            "organiser_id": 1, "coordinator_id": 2,
            "submitted_at": datetime.now(UTC).isoformat(),
        }).execute().data[0]
        venues = []
        try:
            for _ in range(2):
                response = users[3].post("/venues", headers=ORIGIN, json={
                    **details(), "name": f"Independent arrangements {uuid4()}",
                })
                assert response.status_code == 201, response.json
                venues.append(response.json["venue"])
            bookings = []
            for venue in venues:
                response = users[2].post("/venues/bookings", headers=ORIGIN, json={
                    "event_id": event["id"], "venue_id": venue["id"],
                    "start_at": "2099-10-20T06:00:00Z", "end_at": "2099-10-20T07:00:00Z",
                    "expected_attendance": 40, "layout": "Classroom",
                })
                assert response.status_code == 201, response.json
                bookings.append(response.json["booking"])
            yield db, users, event, bookings, venues
        finally:
            db.table("venue_bookings").delete().eq("event_id", event["id"]).execute()
            db.table("equipment_reservations").delete().eq("event_id", event["id"]).execute()
            db.table("equipment_requests").delete().eq("event_id", event["id"]).execute()
            db.table("equipment_items").delete().eq(
                "equipment_type", f"Confirmation equipment {event['id']}",
            ).execute()
            db.table("events").delete().eq("id", event["id"]).execute()
            for venue in venues:
                db.table("venues").delete().eq("id", venue["id"]).execute()


def snapshot(db, event):
    return {
        "event": db.table("events").select("*").eq("id", event["id"]).execute().data[0],
        "bookings": db.table("venue_bookings").select("*").eq(
            "event_id", event["id"],
        ).order("id").execute().data,
    }


@pytest.mark.parametrize("action", ["edit", "cancel"])
def test_one_booking_changes_without_touching_its_sibling_or_parent(arrangements, action):
    db, users, event, bookings, _ = arrangements
    before = snapshot(db, event)
    first, sibling = bookings
    path = f"/venues/bookings/{first['id']}"
    if action == "edit":
        response = users[2].patch(path, headers=ORIGIN, json={
            "start_at": "2099-10-20T08:00:00Z", "end_at": "2099-10-20T09:00:00Z",
            "layout": "Theatre", "special_requirements": "Extra chairs",
        })
    else:
        response = users[2].post(path + "/cancel", headers=ORIGIN)
    assert response.status_code == 200, response.json
    after = snapshot(db, event)
    old_rows = {row["id"]: row for row in before["bookings"]}
    new_rows = {row["id"]: row for row in after["bookings"]}
    assert new_rows[sibling["id"]] == old_rows[sibling["id"]]
    assert after["event"] == before["event"]
    saved = new_rows[first["id"]]
    assert saved["last_changed_by"] == 2 and saved["last_changed_at"]
    if action == "edit":
        assert saved["layout"] == "Theatre"
        assert saved["special_requirements"] == "Extra chairs"
        assert saved["start_at"].startswith("2099-10-20T08:00:00")
    else:
        assert saved["status"] == "Cancelled"
    listed = users[2].get(f"/venues/bookings/event/{event['id']}", headers=ORIGIN)
    assert listed.status_code == 200
    assert {row["id"] for row in listed.json["bookings"]} == set(old_rows)


@pytest.mark.parametrize("actor", [1, 3, 4, 5])
@pytest.mark.parametrize("action", ["edit", "cancel"])
def test_wrong_role_is_denied_without_mutating_any_arrangement(arrangements, actor, action):
    db, users, event, bookings, _ = arrangements
    before = snapshot(db, event)
    prior_denials = db.table("access_denied_log").select("id").eq(
        "actor_id", actor,
    ).execute().data
    path = f"/venues/bookings/{bookings[0]['id']}"
    if action == "edit":
        response = users[actor].patch(path, json={"layout": "Theatre"}, headers=ORIGIN)
    else:
        response = users[actor].post(path + "/cancel", headers=ORIGIN)
    assert response.status_code == 403
    assert snapshot(db, event) == before
    denied = db.table("access_denied_log").select("id,actor_id,action").eq(
        "actor_id", actor,
    ).execute().data
    expected_action = "change_venue_booking" if action == "edit" else "cancel_venue_booking"
    previous_ids = {row["id"] for row in prior_denials}
    new_denials = [row for row in denied if row["id"] not in previous_ids]
    assert len(new_denials) == 1
    assert new_denials[0]["action"] == expected_action


@pytest.mark.parametrize("action", ["edit", "cancel"])
def test_another_coordinator_cannot_mutate_the_owners_booking(arrangements, action):
    db, users, event, bookings, _ = arrangements
    before = snapshot(db, event)
    path = f"/venues/bookings/{bookings[0]['id']}"
    if action == "edit":
        response = users[7].patch(path, json={"layout": "Theatre"}, headers=ORIGIN)
    else:
        response = users[7].post(path + "/cancel", headers=ORIGIN)
    assert response.status_code == 409
    assert snapshot(db, event) == before


@pytest.mark.parametrize("action", ["edit", "cancel"])
def test_failed_database_write_is_not_reported_as_success(arrangements, monkeypatch, action):
    db, users, event, bookings, _ = arrangements
    before = snapshot(db, event)
    # Keep real reads/validation; fail only the actual persistence boundary.
    proxy = MagicMock()

    def table(name):
        query = db.table(name)
        if name != "venue_bookings":
            return query
        wrapper = MagicMock()
        wrapper.select.side_effect = query.select
        failed = MagicMock()
        failed.eq.return_value = failed
        failed.in_.return_value = failed
        failed.execute.side_effect = APIError({
            "code": "08006", "message": "private database connection details",
            "details": None, "hint": None,
        })
        wrapper.update.return_value = failed
        return wrapper

    proxy.table.side_effect = table
    monkeypatch.setattr("app.booking_repository.get_supabase_client", lambda: proxy)
    path = f"/venues/bookings/{bookings[0]['id']}"
    if action == "edit":
        response = users[2].patch(path, headers=ORIGIN, json={"layout": "Theatre"})
    else:
        response = users[2].post(path + "/cancel", headers=ORIGIN)
    assert response.status_code == 503
    assert "booking" not in response.json
    assert "private database" not in str(response.json)
    assert snapshot(db, event) == before


@pytest.mark.parametrize("status", ["Requested", "Partially fulfilled", "Unavailable"])
def test_confirm_refuses_an_unresolved_equipment_request(arrangements, status):
    """SCRUM-39: approval of all venues alone is insufficient for confirmation."""
    db, users, event, bookings, _ = arrangements
    for booking in bookings:
        response = users[3].post(f"/venues/bookings/{booking['id']}/decision",
                                json={"decision": "approve"}, headers=ORIGIN)
        assert response.status_code == 200, response.json
    stock = users[4].post("/equipment", headers=ORIGIN, json={
        **equipment_details(), "equipment_type": f"Confirmation equipment {event['id']}",
    })
    assert stock.status_code == 201, stock.json
    equipment_id = stock.json["equipment"]["id"]
    requested = users[2].post("/equipment/requests", headers=ORIGIN, json={
        "event_id": event["id"],
        "items": [{"equipment_id": equipment_id, "quantity": 2, "technical_notes": "AV"}],
    })
    assert requested.status_code == 201, requested.json
    request_row = requested.json["request"]
    if status == "Unavailable":
        result = users[4].patch(f"/equipment/requests/{request_row['id']}/status",
                                headers=ORIGIN, json={
                                    "status": status, "revision": request_row["revision"],
                                    "notes": "Not available for this event",
                                })
        assert result.status_code == 200, result.json
    elif status == "Partially fulfilled":
        result = users[4].put(f"/equipment/requests/{request_row['id']}/reservations",
                              headers=ORIGIN, json={
                                  "start_at": "2099-10-20T06:00:00Z",
                                  "end_at": "2099-10-20T07:00:00Z",
                                  "revision": request_row["revision"], "notes": "One of two",
                                  "items": [{"equipment_id": equipment_id, "quantity": 1}],
                              })
        assert result.status_code == 200, result.json
    before = snapshot(db, event)
    history_before = db.table("event_status_history").select("*").eq(
        "event_id", event["id"],
    ).execute().data
    response = users[2].post(f"/events/{event['id']}/confirm", headers=ORIGIN)
    assert response.status_code == 409, response.json
    assert "technical" in response.json["error"].lower()
    assert snapshot(db, event) == before
    assert db.table("equipment_requests").select("status").eq(
        "id", request_row["id"],
    ).execute().data == [{"status": status}]
    assert db.table("event_status_history").select("*").eq(
        "event_id", event["id"],
    ).execute().data == history_before

    # Resolving the same request must unblock confirmation, without a new event.
    current = users[4].get(f"/equipment/requests/{request_row['id']}", headers=ORIGIN)
    assert current.status_code == 200, current.json
    reserved = users[4].put(f"/equipment/requests/{request_row['id']}/reservations",
                            headers=ORIGIN, json={
                                "start_at": "2099-10-20T06:00:00Z",
                                "end_at": "2099-10-20T07:00:00Z",
                                "revision": current.json["request"]["revision"],
                                "notes": "All required equipment now arranged",
                                "items": [{"equipment_id": equipment_id, "quantity": 2}],
                            })
    assert reserved.status_code == 200, reserved.json
    assert reserved.json["request"]["status"] == "Reserved"
    confirmed = users[2].post(f"/events/{event['id']}/confirm", headers=ORIGIN)
    assert confirmed.status_code == 200, confirmed.json
    assert snapshot(db, event)["event"]["status"] == "Confirmed"
    assert snapshot(db, event)["bookings"] == before["bookings"]
    history = db.table("event_status_history").select("*").eq(
        "event_id", event["id"],
    ).execute().data
    assert len(history) == len(history_before) + 1
    latest = next(row for row in history if row["new_status"] == "Confirmed")
    assert latest["old_status"] == "Planning"
    assert latest["changed_by"] == 2 and latest["changed_at"]


def test_event_with_no_equipment_requests_can_confirm(arrangements):
    db, users, event, bookings, _ = arrangements
    for booking in bookings:
        response = users[3].post(f"/venues/bookings/{booking['id']}/decision",
                                json={"decision": "approve"}, headers=ORIGIN)
        assert response.status_code == 200, response.json
    assert db.table("equipment_requests").select("id").eq(
        "event_id", event["id"],
    ).execute().data == []
    response = users[2].post(f"/events/{event['id']}/confirm", headers=ORIGIN)
    assert response.status_code == 200, response.json
    assert snapshot(db, event)["event"]["status"] == "Confirmed"


def test_equipment_lookup_failure_leaves_event_and_history_unchanged(arrangements, monkeypatch):
    db, users, event, bookings, _ = arrangements
    for booking in bookings:
        response = users[3].post(f"/venues/bookings/{booking['id']}/decision",
                                json={"decision": "approve"}, headers=ORIGIN)
        assert response.status_code == 200, response.json
    before = snapshot(db, event)
    history = db.table("event_status_history").select("*").eq(
        "event_id", event["id"],
    ).execute().data
    unavailable = MagicMock()
    query = unavailable.table.return_value.select.return_value.eq.return_value
    query.execute.side_effect = RuntimeError("private connection details")
    monkeypatch.setattr("app.equipment_request_repository.get_supabase_client", lambda: unavailable)
    response = users[2].post(f"/events/{event['id']}/confirm", headers=ORIGIN)
    assert response.status_code == 503
    assert "private" not in str(response.json)
    assert snapshot(db, event) == before
    assert db.table("event_status_history").select("*").eq(
        "event_id", event["id"],
    ).execute().data == history

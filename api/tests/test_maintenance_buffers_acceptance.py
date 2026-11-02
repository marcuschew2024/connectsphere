"""SCRUM-169/R5: customer buffer/maintenance rules against real Postgres + API."""

import importlib
import os
import pkgutil
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

import app as application

from .conftest import ORIGIN, select_user
from .test_venues import details

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"), reason="Disposable database required",
)
START, END = "2099-10-20T02:00:00Z", "2099-10-20T04:00:00Z"


@pytest.fixture
def maintenance(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1")
                   for port in (55433, 55434)}
    with SyncPostgrestClient(url) as db:
        for info in pkgutil.iter_modules(application.__path__):
            module = importlib.import_module(f"app.{info.name}")
            if hasattr(module, "get_supabase_client"):
                monkeypatch.setattr(module, "get_supabase_client", lambda: db)
        flask = application.create_app({
            "TESTING": True, "APP_ENV": "development", "DEV_ROLE_SWITCHER_ENABLED": True,
            "SECRET_KEY": "r5-disposable-only", "FRONTEND_ORIGIN": ORIGIN["Origin"],
        })
        users = {number: flask.test_client() for number in (1, 2, 3, 4, 5, 7)}
        for number, client in users.items():
            assert select_user(client, number).status_code == 200
        venue = db.table("venues").insert({
            **details(), "name": f"R5 {uuid4()}", "created_by": 3,
            "setup_time_minutes": 30, "turnaround_time_minutes": 45,
        }).execute().data[0]
        events = []

        def event():
            saved = db.table("events").insert({
                "title": f"R5 event {uuid4()}", "description": "Keep original information",
                "purpose": "Learning", "category": "Workshop", "status": "Planning",
                "event_datetime": START, "event_end_datetime": END,
                "expected_attendance": 10, "organiser_id": 1, "coordinator_id": 2,
                "submitted_at": "2099-10-01T00:00:00Z",
            }).execute().data[0]
            events.append(saved["id"])
            return saved

        try:
            yield db, users, venue, event
        finally:
            db.table("venue_unavailability").delete().eq("venue_id", venue["id"]).execute()
            for eid in events:
                db.table("access_denied_log").delete().eq("event_id", eid).execute()
                db.table("events").delete().eq("id", eid).execute()
            db.table("venues").delete().eq("id", venue["id"]).execute()


def payload(venue, event, **changes):
    return {"venue_id": venue["id"], "event_id": event["id"], "start_at": START,
            "end_at": END, "expected_attendance": 10, "layout": "Classroom", **changes}


def block(users, venue, start, end):
    response = users[3].post(f"/venues/{venue['id']}/unavailability", headers=ORIGIN,
                             json={"start_at": start, "end_at": end, "reason": "Maintenance"})
    assert response.status_code == 201, response.json
    return response.json


@pytest.mark.parametrize("start,end,blocked", [
    ("01:45", "02:00", True),  # setup only
    ("04:00", "04:30", True),  # turnaround only
    ("01:00", "01:30", False),  # ends exactly at occupied start
    ("04:45", "05:00", False),  # starts exactly at occupied end
    ("02:00", "03:00", True),  # published time regression
])
def test_search_and_new_booking_agree_on_maintenance_window(maintenance, start, end, blocked):
    db, users, venue, event = maintenance
    row = event()
    block(users, venue, f"2099-10-20T{start}:00Z", f"2099-10-20T{end}:00Z")
    response = users[2].get("/venues", headers=ORIGIN, query_string={
        "date": "2099-10-20", "start_time": "10:00", "end_time": "12:00",
        "location": venue["location"],
    })
    assert response.status_code == 200, response.json
    match = next(v for v in response.json["venues"] if v["id"] == venue["id"])
    assert match["search_availability"] == ("blocked" if blocked else "available")
    response = users[2].post("/venues/bookings", headers=ORIGIN, json=payload(venue, row))
    assert response.status_code == (409 if blocked else 201), response.json
    saved = db.table("venue_bookings").select("id").eq("event_id", row["id"]).execute().data
    assert len(saved) == (0 if blocked else 1)


@pytest.mark.parametrize("start,end", [("01:45", "02:00"), ("04:00", "04:30")])
@pytest.mark.parametrize("status", ["Requested", "Pending", "Held", "Confirmed"])
def test_database_itself_refuses_buffer_only_maintenance(maintenance, start, end, status):
    db, users, venue, event = maintenance
    row = event()
    block(users, venue, f"2099-10-20T{start}:00Z", f"2099-10-20T{end}:00Z")
    with pytest.raises(APIError) as failure:
        db.table("venue_bookings").insert({
            **payload(venue, row), "requested_by": 2, "status": status,
        }).execute()
    assert failure.value.code == "23P01"
    assert not db.table("venue_bookings").select("id").eq("event_id", row["id"]).execute().data


@pytest.mark.parametrize("start,end", [("01:45", "02:00"), ("04:00", "04:30")])
def test_new_block_flags_existing_booking_notifies_and_preserves_event(maintenance, start, end):
    db, users, venue, event = maintenance
    row = event()
    booked = db.table("venue_bookings").insert({
        **payload(venue, row), "requested_by": 2, "status": "Confirmed",
    }).execute().data[0]
    result = block(users, venue, f"2099-10-20T{start}:00Z", f"2099-10-20T{end}:00Z")
    assert result["affected_booking_ids"] == [booked["id"]]
    notices = db.table("notifications").select("*").eq("event_id", row["id"]).execute().data
    assert len(notices) == 1
    assert notices[0]["recipient_id"] == 2
    assert notices[0]["notification_type"] == "venue_unavailable"
    assert row["title"] in notices[0]["message"] and "alternative" in notices[0]["message"]
    assert db.table("events").select("*").eq("id", row["id"]).execute().data == [row]
    assert db.table("venue_bookings").select("*").eq("id", booked["id"]).execute().data == [booked]
    response = users[2].post(f"/venues/bookings/{booked['id']}/cancel", headers=ORIGIN)
    assert response.status_code == 200, response.json


def test_unblocking_restores_requestability_and_keeps_audit(maintenance):
    db, users, venue, event = maintenance
    result = block(users, venue, "2099-10-20T01:45:00Z", START)
    response = users[3].delete(
        f"/venues/{venue['id']}/unavailability/{result['block']['id']}", headers=ORIGIN,
    )
    assert response.status_code == 200
    assert response.json["block"]["unblocked_by"] == 3
    assert response.json["block"]["unblocked_at"]
    assert users[2].post("/venues/bookings", headers=ORIGIN,
                         json=payload(venue, event())).status_code == 201


def test_edit_into_buffer_only_maintenance_is_atomic(maintenance):
    db, users, venue, event = maintenance
    row = event()
    saved = db.table("venue_bookings").insert({
        **payload(venue, row, start_at="2099-10-21T02:00:00Z",
                  end_at="2099-10-21T04:00:00Z"), "requested_by": 2,
    }).execute().data[0]
    block(users, venue, "2099-10-20T01:45:00Z", START)
    response = users[2].patch(f"/venues/bookings/{saved['id']}", headers=ORIGIN,
                              json={"start_at": START, "end_at": END})
    assert response.status_code == 409, response.json
    assert db.table("venue_bookings").select("*").eq("id", saved["id"]).execute().data == [saved]


def test_each_affected_event_is_named_in_coordinators_summary(maintenance):
    db, users, venue, event = maintenance
    first, second = event(), event()
    for row, start, end in [(first, START, END), (second, "2099-10-20T06:00:00Z",
                                               "2099-10-20T07:00:00Z")]:
        db.table("venue_bookings").insert({
            **payload(venue, row, start_at=start, end_at=end),
            "requested_by": 2, "status": "Confirmed",
        }).execute()
    result = block(users, venue, "2099-10-20T01:45:00Z", "2099-10-20T07:30:00Z")
    assert len(result["affected_booking_ids"]) == 2
    notices = db.table("notifications").select("*").in_(
        "event_id", [first["id"], second["id"]],
    ).execute().data
    assert len(notices) == 1 and notices[0]["recipient_id"] == 2
    assert first["title"] in notices[0]["message"]
    assert second["title"] in notices[0]["message"]


@pytest.mark.parametrize("status", ["Cancelled", "Rejected", "Expired", "Held"])
def test_inactive_or_expired_hold_is_not_reported_as_affected(maintenance, status):
    db, users, venue, event = maintenance
    row = event()
    db.table("venue_bookings").insert({
        **payload(venue, row), "requested_by": 2, "status": status,
        "expires_at": "2000-01-01T00:00:00Z",
    }).execute()
    result = block(users, venue, "2099-10-20T01:45:00Z", START)
    assert result["affected_booking_ids"] == []
    assert not db.table("notifications").select("id").eq("event_id", row["id"]).execute().data


def test_live_hold_is_reported_and_current_coordinator_is_notified(maintenance):
    db, users, venue, event = maintenance
    row = event()
    saved = db.table("venue_bookings").insert({
        **payload(venue, row), "requested_by": 2, "status": "Held",
        "expires_at": "2099-10-19T00:00:00Z",
    }).execute().data[0]
    db.table("events").update({"coordinator_id": 7}).eq("id", row["id"]).execute()
    result = block(users, venue, "2099-10-20T01:45:00Z", START)
    assert result["affected_booking_ids"] == [saved["id"]]
    notices = db.table("notifications").select("*").eq("event_id", row["id"]).execute().data
    assert len(notices) == 1 and notices[0]["recipient_id"] == 7


def test_zero_buffers_do_not_expand_maintenance(maintenance):
    db, users, venue, event = maintenance
    changed = users[3].put(f"/venues/{venue['id']}", headers=ORIGIN, json={
        "revision": venue["revision"], "setup_time_minutes": 0, "turnaround_time_minutes": 0,
        **{key: venue[key] for key in (
            "capacity", "facilities", "accessibility", "supported_layouts", "operating_hours",
        )},
    })
    assert changed.status_code == 200, changed.json
    block(users, venue, "2099-10-20T01:45:00Z", START)
    response = users[2].post("/venues/bookings", headers=ORIGIN,
                              json=payload(venue, event()))
    assert response.status_code == 201, response.json


@pytest.mark.parametrize("actor", [1, 2, 4, 5, 7])
def test_nonstaff_cannot_create_or_clear_maintenance(maintenance, actor):
    db, users, venue, event = maintenance
    response = users[actor].post(f"/venues/{venue['id']}/unavailability", headers=ORIGIN,
                                 json={"start_at": START, "end_at": END, "reason": "Safety"})
    assert response.status_code == 403
    result = block(users, venue, "2099-10-20T01:45:00Z", START)
    response = users[actor].delete(
        f"/venues/{venue['id']}/unavailability/{result['block']['id']}", headers=ORIGIN,
    )
    assert response.status_code == 403

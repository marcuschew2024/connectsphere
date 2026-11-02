"""R1 / SCRUM-137: real DB and HTTP evidence for Week 7 buffer changes."""

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


@pytest.fixture
def buffers(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1")
                   for port in (55433, 55435)}
    with SyncPostgrestClient(url) as db:
        for info in pkgutil.iter_modules(application.__path__):
            module = importlib.import_module(f"app.{info.name}")
            if hasattr(module, "get_supabase_client"):
                monkeypatch.setattr(module, "get_supabase_client", lambda: db)
        flask = application.create_app({
            "TESTING": True, "APP_ENV": "development", "DEV_ROLE_SWITCHER_ENABLED": True,
            "SECRET_KEY": "r1-disposable-only", "FRONTEND_ORIGIN": ORIGIN["Origin"],
        })
        users = {number: flask.test_client() for number in (1, 2, 3)}
        for number, client in users.items():
            assert select_user(client, number).status_code == 200
        venue = db.table("venues").insert({
            **details(), "name": f"R1 {uuid4()}", "location": str(uuid4()), "created_by": 3,
            "setup_time_minutes": 15, "turnaround_time_minutes": 30,
        }).execute().data[0]
        events = []

        def booking(start="04:00", end="05:00", status="Confirmed", **fields):
            event = db.table("events").insert({
                "title": f"R1 event {uuid4()}", "description": "Preserve original details",
                "purpose": "Learning", "category": "Workshop", "status": "Planning",
                "event_datetime": f"2099-10-20T{start}:00Z",
                "event_end_datetime": f"2099-10-20T{end}:00Z",
                "expected_attendance": 10, "organiser_id": 1, "coordinator_id": 2,
                "submitted_at": "2099-10-01T00:00:00Z",
            }).execute().data[0]
            events.append(event["id"])
            return db.table("venue_bookings").insert({
                "venue_id": venue["id"], "event_id": event["id"],
                "start_at": event["event_datetime"], "end_at": event["event_end_datetime"],
                "expected_attendance": 10, "layout": "Classroom", "requested_by": 2,
                "status": status, **fields,
            }).execute().data[0]

        def change(setup=15, turnaround=60):
            current = db.table("venues").select("*").eq("id", venue["id"]).execute().data[0]
            return users[3].put(f"/venues/{venue['id']}", headers=ORIGIN, json={
                **{key: current[key] for key in ("capacity", "facilities", "accessibility",
                                               "supported_layouts", "operating_hours")},
                "revision": current["revision"], "setup_time_minutes": setup,
                "turnaround_time_minutes": turnaround,
            })

        try:
            yield db, users, venue, booking, change
        finally:
            for eid in events:
                db.table("events").delete().eq("id", eid).execute()
            db.table("venues").delete().eq("id", venue["id"]).execute()


def report_rows(db, venue):
    return db.table("problematic_venue_bookings").select("*").eq(
        "venue_id", venue["id"],
    ).execute().data


@pytest.mark.parametrize("setup,turnaround", [(15, 60), (45, 30)])
def test_buffer_increase_saves_flags_and_preserves_existing_bookings(buffers, setup, turnaround):
    db, users, venue, book, change = buffers
    first, second = book(), book("06:00", "07:00")
    response = change(setup, turnaround)
    assert response.status_code == 200, response.json
    findings = response.json["buffer_conflicts"]
    assert {row["booking_id"] for row in findings} == {first["id"], second["id"]}
    assert len(report_rows(db, venue)) == 1
    for previous in (first, second):
        current = db.table("venue_bookings").select("*").eq("id", previous["id"]).execute().data[0]
        for key in ("status", "event_id", "start_at", "end_at", "layout", "requested_by"):
            assert current[key] == previous[key]
        assert current["setup_minutes"] == setup
        assert current["turnaround_minutes"] == turnaround
    persisted = users[3].get(f"/venues/{venue['id']}/buffer-conflicts", headers=ORIGIN)
    assert persisted.status_code == 200
    assert len(persisted.json["buffer_conflicts"]) == 2
    reduced = change(turnaround=30)
    assert reduced.status_code == 200, reduced.json
    assert reduced.json["buffer_conflicts"] == []
    assert report_rows(db, venue) == []


@pytest.mark.parametrize("status", ["Confirmed", "Blocked", "Requested", "Pending", "Held"])
def test_new_writes_use_latest_buffers_after_existing_pair_is_flagged(buffers, status):
    db, _, venue, book, change = buffers
    book(status=status)
    book("06:00", "07:00", status=status)
    assert change().status_code == 200
    with pytest.raises(APIError) as failure:
        book("08:00", "09:00", status=status)  # setup starts 07:45, existing ends 08:00
    assert failure.value.code == "23P01"
    touching = book("08:15", "09:15", status=status)
    assert touching["occupied_start"].startswith("2099-10-20T08:00:00")
    assert len(report_rows(db, venue)) == 1


def test_conflict_resolution_cancellation_clears_report_but_preserves_history(buffers):
    db, users, venue, book, change = buffers
    first, second = book(), book("06:00", "07:00")
    assert change().status_code == 200
    response = users[2].post(f"/venues/bookings/{second['id']}/cancel", headers=ORIGIN)
    assert response.status_code == 200, response.json
    assert report_rows(db, venue) == []
    rows = db.table("venue_bookings").select("id,status").eq("venue_id", venue["id"]).execute().data
    assert {row["id"]: row["status"] for row in rows} == {
        first["id"]: "Confirmed", second["id"]: "Cancelled",
    }


def test_conflicting_time_edit_rolls_back_and_cannot_forge_occupied_columns(buffers):
    db, _, _, book, change = buffers
    book()
    second = book("06:00", "07:00")
    assert change().status_code == 200
    with pytest.raises(APIError) as failure:
        db.table("venue_bookings").update({
            "start_at": "2099-10-20T05:45:00Z", "occupied_start": "2099-10-21T05:45:00Z",
            "occupied_end": "2099-10-21T07:00:00Z", "setup_minutes": 0, "turnaround_minutes": 0,
        }).eq("id", second["id"]).execute()
    assert failure.value.code == "23P01"
    current = db.table("venue_bookings").select("*").eq("id", second["id"]).execute().data[0]
    assert current["start_at"] == second["start_at"]
    db.table("venue_bookings").update({"occupied_start": None, "occupied_end": None,
                                      "setup_minutes": 0}).eq("id", second["id"]).execute()
    current = db.table("venue_bookings").select("*").eq("id", second["id"]).execute().data[0]
    assert current["occupied_start"].startswith("2099-10-20T05:45:00")
    assert current["occupied_end"].startswith("2099-10-20T08:00:00")


@pytest.mark.parametrize("status", ["Cancelled", "Rejected", "Expired"])
def test_inactive_bookings_never_appear_in_report_or_block_new_slots(buffers, status):
    db, _, venue, book, change = buffers
    book(status=status)
    book("06:00", "07:00")
    result = change()
    assert result.status_code == 200, result.json
    assert result.json["buffer_conflicts"] == []
    assert report_rows(db, venue) == []
    book("04:00", "04:30")


def test_expired_hold_is_excluded_and_cannot_be_revived_into_conflict(buffers):
    db, _, venue, book, change = buffers
    book(status="Held", expires_at="2000-01-01T00:00:00Z")
    second = book("06:00", "07:00", status="Held", expires_at="2100-01-01T00:00:00Z")
    assert change().status_code == 200
    assert report_rows(db, venue) == []
    third = book("04:00", "04:30", status="Held", expires_at="2100-01-01T00:00:00Z")
    assert third["status"] == "Held"
    assert second["status"] == "Held"


def test_direct_multirow_insert_cannot_bypass_buffer_guard(buffers):
    db, _, venue, book, _ = buffers
    prototype = book("09:00", "10:00", status="Cancelled")
    rows = [{"event_id": prototype["event_id"], "venue_id": venue["id"],
             "requested_by": 2, "status": "Confirmed", "expected_attendance": 10,
             "layout": "Classroom", "start_at": f"2099-10-20T{start}:00Z",
             "end_at": f"2099-10-20T{end}:00Z"}
            for start, end in [("04:00", "05:00"), ("05:30", "06:30")]]
    with pytest.raises(APIError) as failure:
        db.table("venue_bookings").insert(rows).execute()
    assert failure.value.code == "23P01"
    assert db.table("venue_bookings").select("id").eq("venue_id", venue["id"]).execute().data == [
        {"id": prototype["id"]},
    ]


def test_search_calendar_and_api_request_agree_after_buffer_change(buffers):
    _, users, venue, book, change = buffers
    first, second = book(), book("06:00", "07:00")
    assert change().status_code == 200
    calendar = users[2].get(f"/venues/{venue['id']}/bookings", headers=ORIGIN, query_string={
        "from": "2099-10-20T07:45:00Z", "to": "2099-10-20T08:00:00Z",
    })
    assert calendar.status_code == 200, calendar.json
    saved = next(row for row in calendar.json["bookings"] if row["id"] == second["id"])
    assert saved["occupied_start"].startswith("2099-10-20T05:45:00")
    assert saved["occupied_end"].startswith("2099-10-20T08:00:00")
    for start, end, availability, status in [
        ("16:00", "17:00", "booked", 409), ("16:15", "17:15", "available", 201),
    ]:
        result = users[2].get("/venues", headers=ORIGIN, query_string={
            "date": "2099-10-20", "start_time": start, "end_time": end,
            "location": venue["location"],
        })
        assert result.status_code == 200, result.json
        assert result.json["venues"][0]["search_availability"] == availability
        response = users[2].post("/venues/bookings", headers=ORIGIN, json={
            "venue_id": venue["id"], "event_id": first["event_id"],
            "start_at": f"2099-10-20T{start}:00+08:00",
            "end_at": f"2099-10-20T{end}:00+08:00", "layout": "Classroom",
            "expected_attendance": 10,
        })
        assert response.status_code == status, response.json

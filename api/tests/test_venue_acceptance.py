"""SCRUM-24 acceptance checks against the disposable PostgreSQL/PostgREST stack."""

import importlib
import os
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from app import create_app

from .conftest import ORIGIN, select_user
from .test_venues import details

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


@pytest.fixture
def live_venues(monkeypatch):
    assert os.environ["POSTGREST_TEST_URL"] in (
        "http://127.0.0.1:55433", "http://localhost:55433",
    ), "Venue acceptance tests only run against the disposable local stack."
    with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as db:
        # Only the disposable test role has DELETE; production migration grants do not.
        db.table("venues").delete().ilike("name", "Venue acceptance %").execute()
        for name in ("users", "venue_repository", "rbac", "auth"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        app = create_app({
            "TESTING": True, "APP_ENV": "development", "DEV_ROLE_SWITCHER_ENABLED": True,
            "SECRET_KEY": "acceptance-test-only", "FRONTEND_ORIGIN": ORIGIN["Origin"],
        })
        users = {}
        for number in (1, 2, 3, 4, 5):
            users[number] = app.test_client()
            assert select_user(users[number], number).status_code == 200
        try:
            yield db, users
        finally:
            db.table("venues").delete().ilike("name", "Venue acceptance %").execute()


def unique_venue():
    return {**details(), "name": f"Venue acceptance {uuid4()}"}


def test_created_venue_is_persisted_and_immediately_in_coordinator_catalogue(live_venues):
    db, users = live_venues
    values = unique_venue()
    response = users[3].post("/venues", json=values, headers=ORIGIN)
    assert response.status_code == 201, response.json
    venue = response.json["venue"]
    stored = db.table("venues").select("*").eq("id", venue["id"]).execute().data[0]
    for field, value in values.items():
        assert stored[field] == value
    assert stored["created_by"] == 3 and stored["created_at"]
    assert stored["timezone"] == "Asia/Singapore"
    catalogue = users[2].get("/venues", headers=ORIGIN)
    assert catalogue.status_code == 200
    matching = next(row for row in catalogue.json["venues"] if row["id"] == venue["id"])
    assert matching["creator"]["display_name"] == "Demo Venue Staff"


def test_duplicate_name_and_location_are_blocked_case_and_whitespace_insensitively(live_venues):
    db, users = live_venues
    values = unique_venue()
    first = users[3].post("/venues", json=values, headers=ORIGIN)
    assert first.status_code == 201
    duplicate = {**values, "name": values["name"].upper().replace(" ", "  "),
                 "location": "  " + values["location"].upper() + " "}
    assert users[3].post("/venues", json=duplicate, headers=ORIGIN).status_code == 409
    # A direct insert also hits the unique index: the guard is not just a pre-check.
    with pytest.raises(APIError) as error:
        db.table("venues").insert({**duplicate, "created_by": 3}).execute()
    assert error.value.code == "23505"
    # Separate physical locations can legitimately use the same room name.
    assert users[3].post("/venues", json={**values, "location": "Another building"},
                         headers=ORIGIN).status_code == 201


@pytest.mark.parametrize("field,value", [
    ("capacity", 0), ("capacity", -1), ("name", ""), ("supported_layouts", []),
    ("facilities", [None]), ("operating_hours", {}),
])
def test_database_rejects_invalid_records_even_without_api_validation(live_venues, field, value):
    db, _ = live_venues
    with pytest.raises(APIError) as error:
        db.table("venues").insert({
            **unique_venue(), field: value, "created_by": 3,
        }).execute()
    assert error.value.code == "23514"


def test_catalogue_pages_have_no_missing_or_repeated_new_records(live_venues):
    db, users = live_venues
    records = []
    for index in range(7):
        records.append({**unique_venue(), "created_by": 3,
                        "created_at": f"2099-01-01T00:00:{index:02d}Z"})
    stored = db.table("venues").insert(records).execute().data
    first = users[2].get("/venues?page=1", headers=ORIGIN).json
    second = users[2].get("/venues?page=2", headers=ORIGIN).json
    assert first["has_more"] is True
    assert len(first["venues"]) == 6
    assert [row["id"] for row in first["venues"]] == [
        row["id"] for row in reversed(stored[1:])
    ]
    assert second["venues"][0]["id"] == stored[0]["id"]


def test_rejected_payload_has_no_partial_record(live_venues):
    db, users = live_venues
    values = unique_venue()
    response = users[3].post("/venues", json={**values, "capacity": 0}, headers=ORIGIN)
    assert response.status_code == 400
    assert db.table("venues").select("id").eq("name", values["name"]).execute().data == []


def test_search_filters_across_database_pages_and_flags_retirement(live_venues):
    db, users = live_venues
    location = f"Search location {uuid4()}"
    rows = [{**unique_venue(), "location": location, "created_by": 3,
             "capacity": 100 if index < 8 else 10,
             "is_retired": index == 0, "created_at": f"2099-01-01T00:00:{index:02d}Z"}
            for index in range(15)]
    stored = db.table("venues").insert(rows).execute().data
    query = {"location": location.lower(), "attendance": "100", "layout": "classroom",
             "facilities": "projector, wi-fi", "accessibility": "step-free access"}
    first = users[2].get("/venues", query_string=query, headers=ORIGIN).json
    second = users[2].get("/venues", query_string={**query, "page": "2"}, headers=ORIGIN).json
    matches = first["venues"] + second["venues"]
    assert [row["id"] for row in matches] == [row["id"] for row in reversed(stored[:8])]
    assert first["has_more"] is True and second["has_more"] is False
    assert matches[-1]["search_availability"] == "retired"
    assert all(row["search_availability"] == "not_checked" for row in matches[:-1])


@pytest.mark.parametrize("status,start,end,expected", [
    ("Confirmed", "09:00", "10:00", "booked"),
    ("Blocked", "09:00", "10:00", "blocked"),
    ("Requested", "09:00", "10:00", "available"),
    ("Rejected", "09:00", "10:00", "available"),
    ("Cancelled", "09:00", "10:00", "available"),
    ("Confirmed", "08:00", "09:00", "available"),
    ("Confirmed", "10:00", "11:00", "available"),
])
def test_search_availability_with_real_bookings(
    live_venues, monkeypatch, status, start, end, expected,
):
    db, users = live_venues
    monkeypatch.setattr("app.booking_repository.get_supabase_client", lambda: db)
    location = f"Search time {uuid4()}"
    venue = db.table("venues").insert({
        **unique_venue(), "location": location, "created_by": 3,
    }).execute().data[0]
    assert venue["is_retired"] is False
    event = db.table("events").insert({"title": "Search test", "organiser_id": 1}).execute().data[0]
    booking = db.table("venue_bookings").insert({
        "venue_id": venue["id"], "event_id": event["id"], "requested_by": 2,
        "start_at": f"2026-10-05T{start}:00+08:00", "end_at": f"2026-10-05T{end}:00+08:00",
        "expected_attendance": 50, "layout": "Classroom", "status": status,
    }).execute().data[0]
    try:
        response = users[2].get("/venues", headers=ORIGIN, query_string={
            "location": location, "date": "2026-10-05", "start_time": "09:00",
            "end_time": "10:00",
        })
        assert response.status_code == 200, response.json
        assert response.json["venues"][0]["search_availability"] == expected
        available = users[2].get("/venues", headers=ORIGIN, query_string={
            "location": location, "date": "2026-10-05", "start_time": "09:00",
            "end_time": "10:00", "available_only": "true",
        })
        assert available.status_code == 200, available.json
        assert len(available.json["venues"]) == (1 if expected == "available" else 0)
        stored = db.table("venue_bookings").select("*").eq("id", booking["id"]).execute().data[0]
        assert stored["status"] == status  # Search never changes booking state.
    finally:
        db.table("venue_bookings").delete().eq("id", booking["id"]).execute()

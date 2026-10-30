"""SCRUM-26 venue retirement against real PostgreSQL and PostgREST.

Start compose.acceptance.yml and run supabase/tests/run.sh first. These tests use
only disposable local records, never hosted data.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from .conftest import ORIGIN
from .test_event_completion_acceptance import (  # noqa: F401
    add_booking,
    live,
    live_requests,
    row,
)
from .test_venue_acceptance import unique_venue
from .test_venue_updates import changes

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


@pytest.fixture
def retire_db(live, monkeypatch):  # noqa: F811
    """The shared live fixture, with the venue catalogue on the disposable database too."""
    db, users, _, make_event, venue = live
    monkeypatch.setattr("app.venue_repository.get_supabase_client", lambda: db)
    return db, users, make_event, venue


def _retire(db, venue_id, actor_id=3):
    return db.rpc("retire_venue", {"p_venue_id": venue_id, "p_actor_id": actor_id}).execute()


def _later(hours):
    return (datetime.now(UTC) + timedelta(hours=hours)).isoformat()


# AC2 + AC3: confirmed bookings are untouched; actor and time are recorded.
def test_retiring_records_who_and_when_and_keeps_every_booking(retire_db):
    db, users, make_event, venue = retire_db
    event = make_event()
    past = add_booking(db, event, venue, "Confirmed", -50, -48)
    upcoming = add_booking(db, event, venue, "Confirmed", 48, 50)
    later = add_booking(db, event, venue, "Confirmed", 96, 98)
    rejected = add_booking(db, event, venue, "Rejected", 72, 74)
    before = {booking["id"]: row(db, "venue_bookings", booking["id"])
              for booking in (past, upcoming, later, rejected)}

    response = users[3].post(f"/venues/{venue['id']}/retire", json={}, headers=ORIGIN)

    assert response.status_code == 200, response.json
    assert response.json["kept_confirmed_bookings"] == 2
    stored = row(db, "venues", venue["id"])
    assert stored["is_retired"] is True
    assert stored["retired_by"] == 3
    retired_at = datetime.fromisoformat(stored["retired_at"])
    assert abs(datetime.now(UTC) - retired_at) < timedelta(minutes=1)
    assert stored["revision"] == venue["revision"] + 1
    for field in ("name", "location", "capacity", "facilities", "operating_hours"):
        assert stored[field] == venue[field]
    for booking_id, original in before.items():
        assert row(db, "venue_bookings", booking_id) == original
    assert response.json["venue"]["retired_by_name"] == "Demo Venue Staff"
    detail = users[2].get(f"/venues/{venue['id']}", headers=ORIGIN).json["venue"]
    assert detail["is_retired"] is True
    assert detail["retired_by_name"] == "Demo Venue Staff"


@pytest.mark.parametrize("status", ["Requested", "Held"])
def test_outstanding_requests_must_be_decided_first(retire_db, status):
    db, users, make_event, venue = retire_db
    waiting = add_booking(db, make_event(), venue, status, 48, 50)

    response = users[3].post(f"/venues/{venue['id']}/retire", json={}, headers=ORIGIN)

    assert response.status_code == 409
    assert response.json["error"] == (
        "Decide the 1 outstanding booking request for this venue before retiring it."
    )
    stored = row(db, "venues", venue["id"])
    assert (stored["is_retired"], stored["retired_at"], stored["retired_by"]) == (False, None, None)
    assert stored["revision"] == venue["revision"]

    db.table("venue_bookings").update({"status": "Rejected"}).eq("id", waiting["id"]).execute()
    assert users[3].post(
        f"/venues/{venue['id']}/retire", json={}, headers=ORIGIN
    ).status_code == 200


def test_a_venue_is_retired_only_once(retire_db):
    db, users, _, venue = retire_db
    url = f"/venues/{venue['id']}/retire"
    assert users[3].post(url, json={}, headers=ORIGIN).status_code == 200
    first = row(db, "venues", venue["id"])

    again = users[3].post(f"/venues/{venue['id']}/retire", json={}, headers=ORIGIN)

    assert again.status_code == 409
    assert again.json["error"] == "This venue is already retired."
    with pytest.raises(APIError) as error:
        _retire(db, venue["id"])
    assert (error.value.code, error.value.message) == ("PT409", "already_retired")
    assert row(db, "venues", venue["id"]) == first


@pytest.mark.parametrize("actor_id", [1, 2, 4, 5, 999999])
def test_the_database_function_requires_venue_staff(retire_db, actor_id):
    db, _, _, venue = retire_db
    with pytest.raises(APIError) as error:
        _retire(db, venue["id"], actor_id)
    assert error.value.code == "PT403"
    assert row(db, "venues", venue["id"])["is_retired"] is False


def test_the_database_function_reports_an_unknown_venue(retire_db):
    db, _, _, _ = retire_db
    with pytest.raises(APIError) as error:
        _retire(db, "00000000-0000-4000-8000-000000000000")
    assert error.value.code == "PT404"


def test_the_audit_columns_must_agree(retire_db):
    db, _, _, _ = retire_db
    for bad in ({"retired_at": _later(0)}, {"retired_by": 3},
                {"retired_at": _later(0), "retired_by": 3, "is_retired": False}):
        with pytest.raises(APIError) as error:
            db.table("venues").insert({**unique_venue(), "created_by": 3, **bad}).execute()
        assert error.value.code == "23514"


# AC1: no new or moved booking can take a retired venue, even bypassing Flask.
def test_a_retired_venue_takes_no_new_or_moved_bookings(retire_db):
    db, users, make_event, venue = retire_db
    event = make_event()
    kept = add_booking(db, event, venue, "Confirmed", 48, 50)
    other = db.table("venues").insert({**unique_venue(), "created_by": 3}).execute().data[0]
    elsewhere = add_booking(db, event, other, "Requested", 120, 122)
    try:
        _retire(db, venue["id"])

        api = users[2].post("/venues/bookings", json={
            "event_id": event["id"], "venue_id": venue["id"],
            "start_at": _later(200), "end_at": _later(202),
            "expected_attendance": 20, "layout": "Classroom",
        }, headers=ORIGIN)
        assert api.status_code == 409
        assert api.json["error"] == "This venue is retired and no longer accepts bookings."
        for status in ("Requested", "Held", "Confirmed"):
            with pytest.raises(APIError) as error:
                add_booking(db, event, venue, status, 300, 302)
            assert error.value.code == "23P01"
        with pytest.raises(APIError) as error:
            db.table("venue_bookings").update({"venue_id": venue["id"]}).eq(
                "id", elsewhere["id"]).execute()
        assert error.value.code == "23P01"

        # Existing bookings keep their normal lifecycle: a Confirmed one can be cancelled.
        cancelled = users[2].post(f"/venues/bookings/{kept['id']}/cancel", headers=ORIGIN)
        assert cancelled.status_code == 200, cancelled.json
        assert row(db, "venue_bookings", kept["id"])["status"] == "Cancelled"
    finally:
        db.table("venue_bookings").delete().eq("venue_id", other["id"]).execute()
        db.table("venues").delete().eq("id", other["id"]).execute()


# AC1: excluded from Coordinators' booking searches, preserved for Venue Staff.
def test_coordinators_no_longer_find_a_retired_venue(retire_db):
    db, users, _, venue = retire_db
    query = {"location": venue["location"]}
    assert [r["id"] for r in users[2].get("/venues", query_string=query, headers=ORIGIN)
            .json["venues"]] == [venue["id"]]

    _retire(db, venue["id"])

    assert users[2].get("/venues", query_string=query, headers=ORIGIN).json["venues"] == []
    staff = users[3].get("/venues", query_string=query, headers=ORIGIN).json["venues"]
    assert [(r["id"], r["is_retired"], r["search_availability"]) for r in staff] == [
        (venue["id"], True, "retired"),
    ]
    page, seen = 1, []
    while True:
        result = users[2].get(f"/venues?page={page}", headers=ORIGIN).json
        seen += [r["id"] for r in result["venues"]]
        if not result["has_more"]:
            break
        page += 1
    assert venue["id"] not in seen
    assert any(r["id"] == venue["id"] for r in
               users[3].get("/venues?page=1", headers=ORIGIN).json["venues"])


def test_a_retired_venue_cannot_be_edited(retire_db):
    db, users, _, venue = retire_db
    _retire(db, venue["id"])
    revision = row(db, "venues", venue["id"])["revision"]
    response = users[3].put(
        f"/venues/{venue['id']}", json={**changes(), "revision": revision}, headers=ORIGIN,
    )
    assert response.status_code == 409
    assert "cannot be edited" in response.json["error"]
    assert row(db, "venues", venue["id"])["revision"] == revision


def test_retirement_and_a_new_request_cannot_both_succeed(retire_db):
    """Racing a retirement against a new request leaves either a retired venue with no
    waiting request, or an active venue with one - never a request on a retired venue."""
    db, _, make_event, _ = retire_db
    event = make_event()
    created = []
    try:
        for _ in range(6):
            venue = db.table("venues").insert(
                {**unique_venue(), "created_by": 3}).execute().data[0]
            created.append(venue["id"])
            barrier = Barrier(2)

            def retire(venue_id=venue["id"], barrier=barrier):
                with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as own:
                    barrier.wait()
                    try:
                        _retire(own, venue_id)
                        return True
                    except APIError as error:
                        assert (error.code, error.message) == ("PT409", "outstanding_requests")
                        return False

            def request(venue=venue, barrier=barrier):
                with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as own:
                    barrier.wait()
                    try:
                        add_booking(own, event, venue, "Requested", 48, 50)
                        return True
                    except APIError as error:
                        assert error.code == "23P01"
                        return False

            with ThreadPoolExecutor(max_workers=2) as pool:
                retired, requested = (f.result() for f in
                                      (pool.submit(retire), pool.submit(request)))

            assert retired != requested
            stored = row(db, "venues", venue["id"])
            waiting = db.table("venue_bookings").select("id").eq(
                "venue_id", venue["id"]).execute().data
            assert stored["is_retired"] is retired
            assert len(waiting) == (0 if retired else 1)
    finally:
        for venue_id in created:
            db.table("venue_bookings").delete().eq("venue_id", venue_id).execute()
            db.table("venues").delete().eq("id", venue_id).execute()

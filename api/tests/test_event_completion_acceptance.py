"""SCRUM-132 completion against real PostgreSQL and PostgREST.

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

from . import test_equipment_request_acceptance as request_acceptance
from .conftest import ORIGIN
from .test_venue_acceptance import unique_venue

live_requests = request_acceptance.live_requests

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


@pytest.fixture
def live(live_requests, monkeypatch):
    """Point the event and booking modules at the disposable database as well."""
    db, users, _, items, make_event = live_requests
    for target in (
        "app.event_repository.get_supabase_client",
        "app.booking_repository.get_supabase_client",
        "app.bookings.get_supabase_client",
    ):
        monkeypatch.setattr(target, lambda: db)
    venue = db.table("venues").insert({**unique_venue(), "created_by": 3}).execute().data[0]
    try:
        yield db, users, items, make_event, venue
    finally:
        db.table("venue_bookings").delete().eq("venue_id", venue["id"]).execute()
        db.table("venues").delete().eq("id", venue["id"]).execute()


def _at(hours: float) -> str:
    return (datetime.now(UTC) + timedelta(hours=hours)).isoformat()


def add_booking(db, event, venue, status, start_hours, end_hours):
    return db.table("venue_bookings").insert({
        "venue_id": venue["id"], "event_id": event["id"], "requested_by": 2,
        "start_at": _at(start_hours), "end_at": _at(end_hours),
        "expected_attendance": 20, "layout": "Classroom", "status": status,
    }).execute().data[0]


def add_reservation(db, event, items, quantity=1):
    return db.table("equipment_reservations").insert({
        "equipment_id": items[0]["equipment_id"], "event_id": event["id"],
        "quantity": quantity, "start_at": _at(-3), "end_at": _at(-1),
        "status": "Reserved", "created_by": 4,
    }).execute().data[0]


def row(db, table, row_id):
    return db.table(table).select("*").eq("id", row_id).execute().data[0]


def test_completion_closes_the_event_audits_it_and_releases_holds(live):
    db, users, items, make_event, venue = live
    event = make_event(status="Preparation")
    delivered = add_booking(db, event, venue, "Confirmed", -4, -2)
    future = add_booking(db, event, venue, "Confirmed", 48, 50)
    rejected = add_booking(db, event, venue, "Rejected", 72, 74)
    reservation = add_reservation(db, event, items)

    response = users[2].post(
        f"/events/{event['id']}/complete",
        json={"note": "  Ran 15 minutes late; mic replaced.  "},
        headers=ORIGIN,
    )

    assert response.status_code == 200, response.json
    assert response.json["event"]["status"] == "Completed"
    assert response.json["released"] == {"equipment_reservations": 1, "venue_bookings": 1}
    stored = row(db, "events", event["id"])
    assert stored["status"] == "Completed"
    assert stored["last_status_changed_by"] == 2 and stored["last_status_changed_at"]
    history = users[1].get(f"/events/{event['id']}/history", headers=ORIGIN).json["history"]
    closing = history[-1]
    assert closing["action"] == "event_completed"
    assert (closing["old_status"], closing["new_status"]) == ("Preparation", "Completed")
    assert closing["changed_by"] == 2
    assert closing["changed_at"] == stored["last_status_changed_at"]
    assert closing["note"] == "Ran 15 minutes late; mic replaced."
    assert row(db, "equipment_reservations", reservation["id"])["status"] == "Released"
    assert row(db, "venue_bookings", delivered["id"])["status"] == "Confirmed"
    released = row(db, "venue_bookings", future["id"])
    assert released["status"] == "Cancelled" and released["last_changed_by"] == 2
    assert row(db, "venue_bookings", rejected["id"])["status"] == "Rejected"


def test_incomplete_arrangements_block_and_change_nothing(live):
    db, users, items, make_event, venue = live
    event = make_event()
    request = users[2].post(
        "/equipment/requests", json={"event_id": event["id"], "items": items}, headers=ORIGIN,
    )
    assert request.status_code == 201, request.json
    db.table("events").update({"status": "Preparation"}).eq("id", event["id"]).execute()
    pending = add_booking(db, event, venue, "Requested", 24, 26)
    reservation = add_reservation(db, event, items)

    response = users[2].post(f"/events/{event['id']}/complete", headers=ORIGIN)

    assert response.status_code == 409
    assert "1 venue booking(s) still awaiting approval." in response.json["error"]
    assert "1 equipment request(s) still awaiting Tech Support." in response.json["error"]
    assert row(db, "events", event["id"])["status"] == "Preparation"
    assert row(db, "venue_bookings", pending["id"])["status"] == "Requested"
    assert row(db, "equipment_reservations", reservation["id"])["status"] == "Reserved"


def test_database_function_rechecks_the_rules(live):
    db, _, _, make_event, venue = live
    planning = make_event()
    other_coordinator = make_event(coordinator=7, status="Preparation")
    with_pending = make_event(status="Preparation")
    add_booking(db, with_pending, venue, "Requested", 24, 26)

    def complete(event, actor=2, note=None):
        return db.rpc(
            "complete_event", {"p_event_id": event["id"], "p_actor_id": actor, "p_note": note},
        ).execute()

    expectations = [
        (lambda: complete(planning), "PT409", "not_in_preparation"),
        (lambda: complete(other_coordinator), "PT403", "Assigned coordinator required"),
        (lambda: complete(with_pending), "PT409", "pending_bookings"),
        (lambda: complete(with_pending, actor=1), "PT403", "Coordinator required"),
        (lambda: complete(planning, note="x" * 2001), "22023", "Invalid completion note"),
    ]
    for call, code, message in expectations:
        with pytest.raises(APIError) as refused:
            call()
        assert (refused.value.code, refused.value.message) == (code, message)
    assert row(db, "events", planning["id"])["status"] == "Planning"
    assert row(db, "events", with_pending["id"])["status"] == "Preparation"


def test_concurrent_completions_close_the_event_exactly_once(live):
    db, _, items, make_event, _ = live
    event = make_event(status="Preparation")
    add_reservation(db, event, items)
    barrier = Barrier(2)

    def attempt(_):
        with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as client:
            barrier.wait()
            try:
                return client.rpc("complete_event", {
                    "p_event_id": event["id"], "p_actor_id": 2, "p_note": None,
                }).execute().data
            except APIError as error:
                return error.message

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))

    successes = [result for result in results if isinstance(result, dict)]
    assert len(successes) == 1 and "already_completed" in results
    assert successes[0]["released_equipment_reservations"] == 1
    history = db.table("event_status_history").select("action").eq(
        "event_id", event["id"]
    ).execute().data
    assert [entry["action"] for entry in history].count("event_completed") == 1


def test_completed_event_leaves_active_queues_and_is_read_only(live):
    db, users, items, make_event, venue = live
    event = make_event(status="Preparation")
    booking = add_booking(db, event, venue, "Confirmed", -4, -2)
    assert users[2].post(f"/events/{event['id']}/complete", headers=ORIGIN).status_code == 200

    open_for_requests = users[2].get("/equipment/requests/events", headers=ORIGIN).json["events"]
    assert all(entry["id"] != event["id"] for entry in open_for_requests)
    listing = users[2].get("/events", headers=ORIGIN).json["events"]
    assert any(entry["id"] == event["id"] and entry["status"] == "Completed" for entry in listing)
    assert users[1].get(f"/events/{event['id']}", headers=ORIGIN).status_code == 200

    reserve = users[4].post(
        f"/equipment/{items[0]['equipment_id']}/reservations",
        json={"event_id": event["id"], "quantity": 1, "start_at": _at(24), "end_at": _at(26)},
        headers=ORIGIN,
    )
    change = users[1].post(
        f"/events/{event['id']}/change-requests",
        json={"description": "Add another session"}, headers=ORIGIN,
    )
    cancel = users[2].post(f"/venues/bookings/{booking['id']}/cancel", headers=ORIGIN)
    reopen = users[2].patch(
        f"/events/{event['id']}/status", json={"status": "Planning"}, headers=ORIGIN,
    )
    assert [reserve.status_code, change.status_code, cancel.status_code, reopen.status_code] == [
        409, 409, 409, 409,
    ]
    assert row(db, "events", event["id"])["status"] == "Completed"
    assert row(db, "venue_bookings", booking["id"])["status"] == "Confirmed"
    reservations = db.table("equipment_reservations").select("id").eq(
        "event_id", event["id"]
    ).execute().data
    assert reservations == []


def test_completion_without_a_body_or_holds_still_succeeds(live):
    _, users, _, make_event, _ = live
    event = make_event(status="Preparation")

    response = users[2].post(f"/events/{event['id']}/complete", headers=ORIGIN)

    assert response.status_code == 200, response.json
    assert response.json["released"] == {"equipment_reservations": 0, "venue_bookings": 0}

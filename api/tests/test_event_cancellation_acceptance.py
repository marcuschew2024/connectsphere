"""SCRUM-69 cancellation against real PostgreSQL and PostgREST.

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

from . import test_event_completion_acceptance as completion_acceptance
from .conftest import ORIGIN

live_requests = completion_acceptance.live_requests
live = completion_acceptance.live
add_booking = completion_acceptance.add_booking
add_reservation = completion_acceptance.add_reservation
row = completion_acceptance.row

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)

ATTENDEE, OTHER_ATTENDEE = 41001, 41002
REASON = "Keynote speaker withdrew; the event cannot go ahead."


@pytest.fixture
def cancel_db(live, monkeypatch):
    """The completion fixture, plus registrations, attendee sessions and the Lead."""
    db, users, items, make_event, venue = live
    monkeypatch.setattr(
        "app.registration_repository.get_supabase_client", lambda: db,
    )
    app = users[1].application
    lead_id = db.table("app_users").select("id").eq(
        "role", "Event Coordinator Lead"
    ).execute().data[0]["id"]
    for user_id in (lead_id, ATTENDEE, OTHER_ATTENDEE):
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = user_id
        users[user_id] = client

    def make_registrable_event(**overrides):
        event = make_event(status="Confirmed")
        return db.table("events").update({
            "registration_capacity": 5, **overrides,
        }).eq("id", event["id"]).execute().data[0]

    yield db, users, items, make_event, make_registrable_event, venue, lead_id


def register(db, event, attendee, withdrawn=False):
    saved = db.table("event_registrations").insert({
        "event_id": event["id"], "attendee_id": attendee,
    }).execute().data[0]
    if withdrawn:
        saved = db.table("event_registrations").update({
            "status": "Withdrawn", "withdrawn_at": datetime.now(UTC).isoformat(),
        }).eq("id", saved["id"]).execute().data[0]
    return saved


def cancel(client, event, reason=REASON):
    return client.post(f"/events/{event['id']}/cancel", json={"reason": reason}, headers=ORIGIN)


def notes(db, event, recipient):
    return db.table("notifications").select("notification_type,message").eq(
        "event_id", event["id"]
    ).eq("recipient_id", recipient).eq("notification_type", "event_cancelled").execute().data


def test_cancelling_releases_resources_and_notifies_registered_attendees(cancel_db):
    db, users, items, _, make_registrable_event, venue, _ = cancel_db
    event = make_registrable_event()
    registered = register(db, event, ATTENDEE)
    withdrawn = register(db, event, OTHER_ATTENDEE, withdrawn=True)
    confirmed = add_booking(db, event, venue, "Confirmed", 48, 50)
    requested = add_booking(db, event, venue, "Requested", 72, 74)
    held = add_booking(db, event, venue, "Held", 96, 98)
    rejected = add_booking(db, event, venue, "Rejected", 120, 122)
    reservation = add_reservation(db, event, items)

    response = cancel(users[2], event, f"  {REASON}  ")

    assert response.status_code == 200, response.json
    assert response.json["event"]["status"] == "Cancelled"
    assert response.json["released"] == {"equipment_reservations": 1, "venue_bookings": 3}
    assert response.json["notified_attendees"] == 1
    stored = row(db, "events", event["id"])
    assert stored["status"] == "Cancelled" and stored["last_status_changed_by"] == 2
    history = users[1].get(f"/events/{event['id']}/history", headers=ORIGIN).json["history"]
    closing = history[-1]
    assert closing["action"] == "event_cancelled" and closing["note"] == REASON
    assert (closing["old_status"], closing["new_status"], closing["changed_by"]) == (
        "Confirmed", "Cancelled", 2,
    )
    assert closing["changed_at"] == stored["last_status_changed_at"]
    for booking in (confirmed, requested, held):
        released = row(db, "venue_bookings", booking["id"])
        assert released["status"] == "Cancelled" and released["last_changed_by"] == 2
    assert row(db, "venue_bookings", rejected["id"])["status"] == "Rejected"
    assert row(db, "equipment_reservations", reservation["id"])["status"] == "Released"

    # Registrations are not withdrawn by a cancellation (D31); only notified.
    assert row(db, "event_registrations", registered["id"])["status"] == "Registered"
    assert row(db, "event_registrations", withdrawn["id"])["status"] == "Withdrawn"
    attendee_note = notes(db, event, ATTENDEE)
    assert attendee_note == [{
        "notification_type": "event_cancelled",
        "message": f'The event "{event["title"]}" you registered for has been cancelled.',
    }]
    assert REASON not in attendee_note[0]["message"]
    assert notes(db, event, OTHER_ATTENDEE) == []
    feed = users[ATTENDEE].get("/notifications", headers=ORIGIN).json["notifications"]
    assert any(n["event_id"] == event["id"] and n["notification_type"] == "event_cancelled"
               for n in feed)
    organiser_note = notes(db, event, 1)
    assert len(organiser_note) == 1 and REASON in organiser_note[0]["message"]
    assert notes(db, event, 2) == []  # the Coordinator cancelled it themselves


def test_lead_cancels_any_event_and_tells_the_assigned_coordinator(cancel_db):
    db, users, _, make_event, _, _, lead_id = cancel_db
    others = make_event(coordinator=7, status="Planning")
    unassigned = db.table("events").update({
        "status": "Submitted", "coordinator_id": None, "coordinator_assigned_at": None,
    }).eq("id", make_event(status="Submitted")["id"]).execute().data[0]

    assert cancel(users[lead_id], others).status_code == 200
    assert cancel(users[lead_id], unassigned).status_code == 200

    assert row(db, "events", others["id"])["status"] == "Cancelled"
    assert row(db, "events", unassigned["id"])["status"] == "Cancelled"
    coordinator_note = notes(db, others, 7)
    assert len(coordinator_note) == 1
    assert "cancelled by the Event Coordinator Lead" in coordinator_note[0]["message"]
    assert notes(db, unassigned, 1)  # the Organiser still hears about it


@pytest.mark.parametrize("user_id", [1, 3, 4, 7, ATTENDEE])
def test_unauthorised_users_cannot_cancel(cancel_db, user_id):
    db, users, _, _, make_registrable_event, _, _ = cancel_db
    event = make_registrable_event()
    register(db, event, ATTENDEE)
    try:
        assert cancel(users[user_id], event).status_code in (403, 404)
        assert row(db, "events", event["id"])["status"] == "Confirmed"
        assert db.table("notifications").select("id").eq("event_id", event["id"]).eq(
            "notification_type", "event_cancelled").execute().data == []
        denials = db.table("access_denied_log").select("actor_id,action").eq(
            "actor_id", user_id).order("occurred_at", desc=True).limit(1).execute().data
        assert denials and denials[0]["action"] in ("cancel_event", "view_event")
    finally:
        # The audit row references the event, so remove it before the fixture's cleanup.
        db.table("access_denied_log").delete().eq("event_id", event["id"]).execute()


def test_database_function_rechecks_the_rules(cancel_db):
    db, _, _, make_event, _, _, lead_id = cancel_db
    planning = make_event(status="Planning")
    completed = make_event(status="Completed")
    already = make_event(status="Cancelled")
    draft = db.table("events").insert({
        "title": "Private draft", "organiser_id": 1, "status": "Draft",
    }).execute().data[0]

    def call(event_id, actor=2, reason=REASON):
        return db.rpc("cancel_event", {
            "p_event_id": event_id, "p_actor_id": actor, "p_reason": reason,
        }).execute()

    expectations = [
        (lambda: call(planning["id"], actor=7), "PT403", "Assigned coordinator required"),
        (lambda: call(planning["id"], actor=1), "PT403", "Coordinator or Lead required"),
        (lambda: call(planning["id"], reason="   "), "22023", "Invalid cancellation reason"),
        (lambda: call(planning["id"], reason="x" * 2001), "22023", "Invalid cancellation reason"),
        (lambda: call(completed["id"]), "PT409", "closed_event"),
        (lambda: call(already["id"], actor=lead_id), "PT409", "already_cancelled"),
        (lambda: call(draft["id"], actor=lead_id), "PT404", "Event not found"),
        (lambda: call("00000000-0000-4000-8000-000000000000"), "PT404", "Event not found"),
    ]
    try:
        for attempt, code, message in expectations:
            with pytest.raises(APIError) as refused:
                attempt()
            assert (refused.value.code, refused.value.message) == (code, message)
        assert row(db, "events", planning["id"])["status"] == "Planning"
        assert row(db, "events", completed["id"])["status"] == "Completed"
    finally:
        db.table("events").delete().eq("id", draft["id"]).execute()


def test_concurrent_cancellations_cancel_once_and_notify_once(cancel_db):
    db, _, items, _, make_registrable_event, _, lead_id = cancel_db
    event = make_registrable_event()
    register(db, event, ATTENDEE)
    add_reservation(db, event, items)
    barrier = Barrier(2)

    def attempt(actor):
        with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as client:
            barrier.wait()
            try:
                return client.rpc("cancel_event", {
                    "p_event_id": event["id"], "p_actor_id": actor, "p_reason": REASON,
                }).execute().data
            except APIError as error:
                return error.message

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, [2, lead_id]))

    successes = [result for result in results if isinstance(result, dict)]
    assert len(successes) == 1 and "already_cancelled" in results
    assert successes[0]["released_equipment_reservations"] == 1
    history = db.table("event_status_history").select("action").eq(
        "event_id", event["id"]).eq("action", "event_cancelled").execute().data
    assert len(history) == 1
    assert len(notes(db, event, ATTENDEE)) == 1


def test_a_cancelled_event_is_read_only_but_still_visible(cancel_db):
    db, users, items, _, make_registrable_event, venue, _ = cancel_db
    event = make_registrable_event()
    register(db, event, ATTENDEE)
    assert cancel(users[2], event).status_code == 200

    start, end = (datetime.now(UTC) + timedelta(days=9)).isoformat(), (
        datetime.now(UTC) + timedelta(days=9, hours=2)).isoformat()
    attempts = {
        "reopen": users[2].patch(
            f"/events/{event['id']}/status", json={"status": "Planning"}, headers=ORIGIN),
        "cancel again": cancel(users[2], event),
        "change request": users[1].post(
            f"/events/{event['id']}/change-requests",
            json={"description": "Bring it back"}, headers=ORIGIN),
        "reserve equipment": users[4].post(
            f"/equipment/{items[0]['equipment_id']}/reservations",
            json={"event_id": event["id"], "quantity": 1, "start_at": start, "end_at": end},
            headers=ORIGIN),
        "new signup": users[OTHER_ATTENDEE].post(
            f"/events/{event['id']}/registrations", json={}, headers=ORIGIN),
    }
    assert {name: response.status_code for name, response in attempts.items()} == {
        name: 409 for name in attempts
    }
    assert "cancelled" in attempts["reopen"].json["error"]
    assert attempts["cancel again"].json["error"] == "This event is already cancelled."
    assert attempts["change request"].json["error"] == (
        "This event is cancelled. Its record is read-only."
    )
    assert "confirmed events" in attempts["new signup"].json["error"]
    assert row(db, "events", event["id"])["status"] == "Cancelled"
    assert db.table("equipment_reservations").select("id").eq(
        "event_id", event["id"]).execute().data == []

    assert users[1].get(f"/events/{event['id']}", headers=ORIGIN).json["event"][
        "status"] == "Cancelled"
    own = users[ATTENDEE].get("/events/registrations", headers=ORIGIN).json["registrations"]
    mine = next(entry for entry in own if entry["event_id"] == event["id"])
    assert mine["status"] == "Registered" and mine["event"]["status"] == "Cancelled"
    assert venue["id"]  # the venue fixture is cleaned up after the test

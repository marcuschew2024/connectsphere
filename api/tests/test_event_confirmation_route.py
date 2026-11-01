"""API integration tests for POST /events/<id>/confirm (SCRUM-39).

The pure gate rule is unit-tested in test_event_confirmation.py. These tests cover
the endpoint wiring: Coordinator-only, Planning-only, the all-venues gate, the status
transition to Confirmed, and the audited history entry. The event's venue bookings are
supplied by monkeypatching the repository lookup, since the shared event DB fixture does
not model the venue_bookings table.
"""

from datetime import datetime, timedelta

import pytest

from .conftest import ORIGIN, select_user
from .test_events import _seed_planning_event

pytest_plugins = ("tests.test_events",)


@pytest.fixture
def bookings(monkeypatch):
    """Control what list_bookings_for_event returns for the confirm endpoint."""
    # These venue-gate cases have no equipment requests. The real readiness
    # lookup is exercised separately by the database acceptance regressions.
    monkeypatch.setattr("app.events.list_confirmation_requests", lambda event_id: [])

    def _set(statuses):
        monkeypatch.setattr(
            "app.events.list_bookings_for_event",
            lambda event_id: [{"status": status} for status in statuses],
        )

    return _set


# Happy path: a Coordinator confirms when every venue booking is approved (AC1).
def test_coordinator_confirms_when_all_bookings_approved(app, event_database, bookings):
    bookings(["Confirmed", "Confirmed"])
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Planning")

    response = client.post(f"/events/{event['id']}/confirm", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Confirmed"


# The confirmation is recorded in the status history with old/new states (AC3 handoff).
def test_confirmation_is_added_to_history(app, event_database, bookings):
    bookings(["Confirmed"])
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Planning")

    client.post(f"/events/{event['id']}/confirm", headers=ORIGIN)
    history = client.get(f"/events/{event['id']}/history", headers=ORIGIN)

    assert history.json["history"][0]["old_status"] == "Planning"
    assert history.json["history"][0]["new_status"] == "Confirmed"


# A still-pending booking blocks confirmation with a clear message; status is unchanged (AC4).
def test_confirm_blocked_when_a_booking_is_pending(app, event_database, bookings):
    bookings(["Confirmed", "Requested"])
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Planning")

    response = client.post(f"/events/{event['id']}/confirm", headers=ORIGIN)

    assert response.status_code == 409
    assert "awaiting approval" in response.json["error"]
    assert event["status"] == "Planning"


# An event with no venue booked cannot be confirmed (PO decision).
def test_confirm_blocked_when_no_venue_booked(app, event_database, bookings):
    bookings([])
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Planning")

    response = client.post(f"/events/{event['id']}/confirm", headers=ORIGIN)

    assert response.status_code == 409
    assert "No venue" in response.json["error"]


# Only a Coordinator may confirm (AC: the actor is a Coordinator).
def test_non_coordinator_cannot_confirm(app, event_database, bookings):
    bookings(["Confirmed"])
    client = app.test_client()
    select_user(client, 1)  # Organiser
    event = _seed_planning_event(event_database, status="Planning")

    response = client.post(f"/events/{event['id']}/confirm", headers=ORIGIN)

    assert response.status_code == 403
    assert event["status"] == "Planning"


# An event not in Planning cannot be confirmed (AC: confirm follows Planning).
def test_confirm_rejected_when_not_in_planning(app, event_database, bookings):
    bookings(["Confirmed"])
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Submitted")

    response = client.post(f"/events/{event['id']}/confirm", headers=ORIGIN)

    assert response.status_code == 409
    assert event["status"] == "Submitted"


def _confirmed_booking_at(start, end):
    return [{"status": "Confirmed", "start_at": start.isoformat(), "end_at": end.isoformat()}]


# SCRUM-159: a reschedule that leaves an approved booking on its old slot blocks confirm (NFR-d).
def test_confirm_blocked_when_booking_slot_no_longer_covers_event_datetime(
    app, event_database, monkeypatch
):
    monkeypatch.setattr("app.events.list_confirmation_requests", lambda event_id: [])
    event = _seed_planning_event(event_database, status="Planning")
    event_dt = datetime.fromisoformat(event["event_datetime"])
    # The approved booking still sits a day before the (rescheduled) event -> orphaned.
    stale_start = event_dt - timedelta(days=1)
    monkeypatch.setattr(
        "app.events.list_bookings_for_event",
        lambda event_id: _confirmed_booking_at(stale_start, stale_start + timedelta(hours=1)),
    )
    client = app.test_client()
    select_user(client, 2)

    response = client.post(f"/events/{event['id']}/confirm", headers=ORIGIN)

    assert response.status_code == 409
    assert "no longer match" in response.json["error"]
    assert event["status"] == "Planning"


# The approved booking still covers the event's date/time -> confirm succeeds.
def test_confirm_allowed_when_booking_slot_covers_event_datetime(
    app, event_database, monkeypatch
):
    monkeypatch.setattr("app.events.list_confirmation_requests", lambda event_id: [])
    event = _seed_planning_event(event_database, status="Planning")
    event_dt = datetime.fromisoformat(event["event_datetime"])
    monkeypatch.setattr(
        "app.events.list_bookings_for_event",
        lambda event_id: _confirmed_booking_at(event_dt, event_dt + timedelta(hours=2)),
    )
    client = app.test_client()
    select_user(client, 2)

    response = client.post(f"/events/{event['id']}/confirm", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Confirmed"

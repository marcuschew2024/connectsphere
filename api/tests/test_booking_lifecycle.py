"""SCRUM-126 independent multi-venue booking lifecycle tests.

Also covers SCRUM-21/130: booking management follows the event's current Coordinator, so
a reassignment moves the venue arrangements with the event.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from .conftest import ORIGIN, select_user


def booking(status="Requested", booking_id="booking-a", requested_by=2):
    return {
        "id": booking_id,
        "event_id": "event-1",
        "venue_id": "venue-1",
        "status": status,
        "requested_by": requested_by,
        "start_at": "2099-10-20T06:00:00Z",
        "end_at": "2099-10-20T08:00:00Z",
        "expected_attendance": 50,
        "layout": "Theatre",
        "special_requirements": None,
    }


def event():
    now = datetime.now(UTC).isoformat()
    return {"id": "event-1", "status": "Planning", "organiser_id": 1,
            "coordinator_id": 2, "title": "Multi-space event", "created_at": now,
            "updated_at": now}


def test_event_booking_list_returns_all_siblings_for_related_coordinator(app, monkeypatch):
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: event())
    monkeypatch.setattr(
        "app.bookings.list_bookings_for_event_detail",
        lambda event_id: [booking(booking_id="booking-a"), booking(booking_id="booking-b")],
    )
    client = app.test_client()
    select_user(client, 2)

    response = client.get("/venues/bookings/event/event-1", headers=ORIGIN)

    assert response.status_code == 200
    assert [row["id"] for row in response.json["bookings"]] == ["booking-a", "booking-b"]


def test_changing_one_booking_does_not_touch_sibling(app, monkeypatch):
    first = booking(booking_id="booking-a")
    sibling = booking(booking_id="booking-b", requested_by=2)
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: first)
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: event())
    monkeypatch.setattr("app.bookings._validated_booking_fields", lambda *args: {
        "venue_id": "venue-2", "start_at": "2099-10-20T09:00:00+00:00",
        "end_at": "2099-10-20T10:00:00+00:00", "expected_attendance": 50,
        "layout": "Classroom", "special_requirements": None,
    })
    monkeypatch.setattr(
        "app.bookings.update_requested_booking",
        lambda booking_id, fields, user_id: {**first, **fields},
    )
    client = app.test_client()
    select_user(client, 2)

    response = client.patch(
        "/venues/bookings/booking-a", json={"venue_id": "venue-2"}, headers=ORIGIN
    )

    assert response.status_code == 200
    assert response.json["booking"]["venue_id"] == "venue-2"
    assert sibling["venue_id"] == "venue-1"


def test_cancelling_one_booking_preserves_sibling(app, monkeypatch):
    first = booking(booking_id="booking-a")
    sibling = booking(booking_id="booking-b")
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: first)
    # coordinator_id names the acting Coordinator: cancelling is now authorised against
    # the event's current assignment, not the booking's original requester (SCRUM-21/130).
    monkeypatch.setattr(
        "app.bookings.get_event_by_id",
        lambda event_id: {"id": "event-1", "status": "Planning", "coordinator_id": 2},
    )
    monkeypatch.setattr("app.bookings.cancel_booking", lambda booking_id, user_id: {
        **first, "status": "Cancelled",
    })
    client = app.test_client()
    select_user(client, 2)

    response = client.post("/venues/bookings/booking-a/cancel", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["booking"]["status"] == "Cancelled"
    assert sibling["status"] == "Requested"


# SCRUM-132: bookings of a completed event belong to its closed record.
def test_bookings_of_a_completed_event_cannot_be_cancelled(app, monkeypatch):
    first = booking(booking_id="booking-a", status="Confirmed")
    cancelled = []
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: first)
    monkeypatch.setattr(
        "app.bookings.get_event_by_id",
        lambda event_id: {"id": "event-1", "status": "Completed", "coordinator_id": 2},
    )
    monkeypatch.setattr(
        "app.bookings.cancel_booking",
        lambda booking_id, user_id: cancelled.append(booking_id),
    )
    client = app.test_client()
    select_user(client, 2)

    response = client.post("/venues/bookings/booking-a/cancel", headers=ORIGIN)

    assert response.status_code == 409
    assert "read-only" in response.json["error"]
    assert cancelled == []


def test_non_owner_cannot_change_or_cancel_booking(app, monkeypatch):
    first = booking(booking_id="booking-a", requested_by=2)
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: first)
    client = app.test_client()
    select_user(client, 1)

    assert client.patch("/venues/bookings/booking-a", json={}, headers=ORIGIN).status_code == 403
    assert client.post("/venues/bookings/booking-a/cancel", headers=ORIGIN).status_code == 403


# ==============================================================================
# SCRUM-21 / SCRUM-130: booking management follows the event's current Coordinator
# ==============================================================================

def reassigned_event(coordinator_id=7):
    """The event after the Lead moved it from Coordinator 2 to Coordinator 7."""
    now = datetime.now(UTC).isoformat()
    return {"id": "event-1", "status": "Planning", "organiser_id": 1,
            "coordinator_id": coordinator_id, "title": "Multi-space event",
            "created_at": now, "updated_at": now}


@pytest.fixture
def denial_log(monkeypatch):
    """Capture access_denied_log inserts so a refusal can be asserted, not assumed."""
    rows = []
    client = MagicMock()

    def table(name):
        assert name == "access_denied_log"
        query = MagicMock()

        def insert(fields):
            rows.append(fields)
            return query

        query.insert.side_effect = insert
        query.execute.return_value = SimpleNamespace(data=rows[-1:])
        return query

    client.table.side_effect = table
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: client)
    monkeypatch.setattr("app.rbac.is_event_participant", lambda event_id, user_id: False)
    return rows


@pytest.fixture
def after_reassignment(app, monkeypatch, denial_log):
    """Booking requested by Coordinator 2 on an event now assigned to Coordinator 7."""
    record = booking(booking_id="booking-a", requested_by=2)
    changed = []
    cancelled = []
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: record)
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: reassigned_event())
    monkeypatch.setattr("app.bookings._validated_booking_fields", lambda *args: {
        "venue_id": "venue-2", "start_at": "2099-10-20T09:00:00+00:00",
        "end_at": "2099-10-20T10:00:00+00:00", "expected_attendance": 50,
        "layout": "Classroom", "special_requirements": None,
    })
    monkeypatch.setattr(
        "app.bookings.update_requested_booking",
        lambda booking_id, fields, user_id: changed.append(booking_id) or {**record, **fields},
    )
    monkeypatch.setattr(
        "app.bookings.cancel_booking",
        lambda booking_id, user_id: cancelled.append(booking_id) or {
            **record, "status": "Cancelled",
        },
    )
    return app, changed, cancelled, denial_log


def test_a_former_coordinator_cannot_change_a_booking_through_the_api(after_reassignment):
    """AC4 (SCRUM-130): a reassigned Coordinator loses the event's venue arrangements.

    Hiding the control is not the guard -- this calls the endpoint directly, the way
    someone holding the booking's URL would.
    """
    app, changed, _, _ = after_reassignment
    client = app.test_client()
    select_user(client, 2)  # requested the booking, no longer holds the event

    response = client.patch("/venues/bookings/booking-a", json={}, headers=ORIGIN)

    assert response.status_code == 403
    assert changed == [], "the booking must not be written"


def test_a_former_coordinator_cannot_cancel_a_booking_through_the_api(after_reassignment):
    app, _, cancelled, _ = after_reassignment
    client = app.test_client()
    select_user(client, 2)

    response = client.post("/venues/bookings/booking-a/cancel", headers=ORIGIN)

    assert response.status_code == 403
    assert cancelled == []


def test_a_denied_booking_mutation_is_recorded(after_reassignment):
    """SCRUM-21 AC4: denied attempts are recorded.

    The refusal used to be a 409 'only your booking' with nothing written to the audit
    log, so an unauthorised attempt on someone else's arrangements left no trace.
    """
    app, _, _, denials = after_reassignment
    client = app.test_client()
    select_user(client, 2)

    client.patch("/venues/bookings/booking-a", json={}, headers=ORIGIN)

    assert len(denials) == 1
    assert denials[0]["action"] == "change_venue_booking"
    assert denials[0]["actor_id"] == 2
    assert denials[0]["event_id"] == "event-1"


@pytest.fixture
def inherited(app, monkeypatch, denial_log):
    """The mirror case: Coordinator 2 holds the event but did not request the booking.

    This is what a reassignment leaves behind for the receiving Coordinator, and it is
    the case the old `requested_by` check refused.
    """
    record = booking(booking_id="booking-a", requested_by=99)
    changed = []
    cancelled = []
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: record)
    monkeypatch.setattr(
        "app.bookings.get_event_by_id", lambda event_id: reassigned_event(coordinator_id=2),
    )
    monkeypatch.setattr("app.bookings._validated_booking_fields", lambda *args: {
        "venue_id": "venue-2", "start_at": "2099-10-20T09:00:00+00:00",
        "end_at": "2099-10-20T10:00:00+00:00", "expected_attendance": 50,
        "layout": "Classroom", "special_requirements": None,
    })
    monkeypatch.setattr(
        "app.bookings.update_requested_booking",
        lambda booking_id, fields, user_id: changed.append(user_id) or {**record, **fields},
    )
    monkeypatch.setattr(
        "app.bookings.cancel_booking",
        lambda booking_id, user_id: cancelled.append(user_id) or {
            **record, "status": "Cancelled",
        },
    )
    return app, changed, cancelled


def test_the_receiving_coordinator_inherits_the_booking(inherited):
    """AC4: the arrangements move with the event, whoever originally requested them."""
    app, changed, cancelled = inherited
    client = app.test_client()
    select_user(client, 2)

    assert client.patch(
        "/venues/bookings/booking-a", json={"venue_id": "venue-2"}, headers=ORIGIN,
    ).status_code == 200
    assert client.post("/venues/bookings/booking-a/cancel", headers=ORIGIN).status_code == 200
    # The change is attributed to whoever made it, not to the original requester (99).
    assert changed == [2]
    assert cancelled == [2]


def test_the_detail_response_tells_the_ui_who_may_manage_the_booking(inherited):
    """D52: the server decides, so the screen cannot offer an edit the API would refuse."""
    app, _, _ = inherited
    client = app.test_client()
    select_user(client, 2)

    booking_body = client.get("/venues/bookings/booking-a", headers=ORIGIN).json["booking"]

    assert booking_body["can_manage"] is True
    assert booking_body["requested_by"] == 99, "authority is the event's, not the requester's"


def test_a_former_coordinator_cannot_even_read_the_booking(after_reassignment):
    """The record-level read guard already followed the event; this pins it down."""
    app, _, _, _ = after_reassignment
    client = app.test_client()
    select_user(client, 2)

    assert client.get("/venues/bookings/booking-a", headers=ORIGIN).status_code == 403


def test_a_decided_booking_cannot_be_changed_even_by_its_coordinator(inherited, monkeypatch):
    """State, not authority: once approved a booking is changed through its own flow."""
    app, changed, _ = inherited
    monkeypatch.setattr(
        "app.bookings.get_booking",
        lambda booking_id: booking(booking_id="booking-a", status="Confirmed"),
    )
    client = app.test_client()
    select_user(client, 2)

    response = client.patch("/venues/bookings/booking-a", json={}, headers=ORIGIN)

    assert response.status_code == 409
    assert "Requested booking" in response.json["error"]
    assert changed == []


def test_a_booking_whose_event_is_gone_cannot_be_cancelled(inherited, monkeypatch):
    """Without an event there is no assignment to authorise against, so refuse."""
    app, _, cancelled = inherited
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: None)
    client = app.test_client()
    select_user(client, 2)

    assert client.post(
        "/venues/bookings/booking-a/cancel", headers=ORIGIN,
    ).status_code == 404
    assert cancelled == []

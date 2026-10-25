"""SCRUM-126 independent multi-venue booking lifecycle tests."""

from datetime import UTC, datetime

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
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: {"status": "Planning"})
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
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: {"status": "Completed"})
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

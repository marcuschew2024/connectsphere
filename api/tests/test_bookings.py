"""SCRUM-31: venue booking request API acceptance and boundary tests."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from .conftest import ORIGIN, select_user


def event_record():
    now = datetime.now(UTC).isoformat()
    return {
        "id": "event-1", "title": "Campus workshop", "status": "Planning",
        "organiser_id": 1, "coordinator_id": 2, "expected_attendance": 80,
        "created_at": now, "updated_at": now,
    }


def payload(**overrides):
    start = datetime.now(UTC) + timedelta(days=3)
    values = {
        "event_id": "event-1", "venue_id": "venue-1",
        "start_at": start.isoformat(),
        "end_at": (start + timedelta(hours=2)).isoformat(),
        "expected_attendance": 80, "layout": "Classroom",
        "special_requirements": "Step-free access and projector",
    }
    values.update(overrides)
    return values


@pytest.fixture
def booking_api(app, monkeypatch):
    event = event_record()
    created = []
    notifications = []
    monkeypatch.setattr(
        "app.bookings.get_event_by_id",
        lambda event_id: event if event_id == event["id"] else None,
    )
    monkeypatch.setattr(
        "app.bookings.get_venue", lambda venue_id: {"id": venue_id, "capacity": 300}
    )
    monkeypatch.setattr("app.bookings.find_overlapping_bookings", lambda *args: [])
    monkeypatch.setattr("app.bookings._venue_staff_ids", lambda: [3])
    monkeypatch.setattr(
        "app.bookings.create_notification", lambda *args: notifications.append(args)
    )

    def save(fields, actor):
        row = {**fields, "id": str(uuid4()), "status": "Requested", "requested_by": actor,
               "requested_at": datetime.now(UTC).isoformat()}
        created.append(row)
        return row

    monkeypatch.setattr("app.bookings.create_booking", save)
    client = app.test_client()
    select_user(client, 2)
    return client, created, notifications, event


def test_coordinator_submission_records_requested_actor_and_notifies_staff(booking_api):
    client, created, notifications, _ = booking_api

    response = client.post("/venues/bookings", json=payload(), headers=ORIGIN)

    assert response.status_code == 201
    booking = response.json["booking"]
    assert booking["status"] == "Requested"
    assert booking["requested_by"] == 2
    assert booking["requested_at"]
    assert booking["expected_attendance"] == 80
    assert booking["layout"] == "Classroom"
    assert created == [booking]
    assert notifications == [(
        3, "event-1", "venue_booking_requested",
        "Venue booking requested for Campus workshop.",
    )]


def test_non_coordinator_cannot_submit_booking(booking_api):
    client, created, _, _ = booking_api
    select_user(client, 1)

    response = client.post("/venues/bookings", json=payload(), headers=ORIGIN)

    assert response.status_code == 403
    assert created == []


@pytest.mark.parametrize("overrides", [
    {"start_at": "not-a-date"},
    {"end_at": (datetime.now(UTC) - timedelta(days=1)).isoformat()},
    {"expected_attendance": 0},
    {"expected_attendance": 2_147_483_648},
    {"expected_attendance": True},
    {"layout": ""},
    {"layout": "x" * 101},
    {"special_requirements": "x" * 2001},
])
def test_invalid_booking_values_are_rejected(booking_api, overrides):
    client, created, _, _ = booking_api

    response = client.post("/venues/bookings", json=payload(**overrides), headers=ORIGIN)

    assert response.status_code == 400
    assert created == []


def test_end_before_start_is_rejected(booking_api):
    client, created, _, _ = booking_api
    start = datetime.now(UTC) + timedelta(days=3)

    response = client.post("/venues/bookings", json=payload(
        start_at=(start + timedelta(hours=2)).isoformat(), end_at=start.isoformat()
    ), headers=ORIGIN)

    assert response.status_code == 400
    assert created == []


def test_attendance_over_venue_capacity_is_rejected(booking_api, monkeypatch):
    client, created, _, _ = booking_api
    monkeypatch.setattr(
        "app.bookings.get_venue", lambda venue_id: {"id": venue_id, "capacity": 50}
    )

    response = client.post(
        "/venues/bookings", json=payload(expected_attendance=51), headers=ORIGIN
    )

    assert response.status_code == 400
    assert "capacity" in response.json["error"]
    assert created == []


def test_confirmed_or_blocked_overlap_is_rejected(booking_api, monkeypatch):
    client, created, _, _ = booking_api
    monkeypatch.setattr(
        "app.bookings.find_overlapping_bookings",
        lambda *args: [{
            "id": "existing", "venue_id": "venue-1",
            "start_at": payload()["start_at"], "end_at": payload()["end_at"],
            "status": "Confirmed",
        }],
    )

    response = client.post("/venues/bookings", json=payload(), headers=ORIGIN)

    assert response.status_code == 409
    assert created == []


def test_existing_tentative_hold_is_rejected(booking_api, monkeypatch):
    client, created, _, _ = booking_api
    requested = payload()
    monkeypatch.setattr(
        "app.bookings.find_overlapping_bookings",
        lambda *args: [{
            "id": "existing", "venue_id": "venue-1",
            "start_at": requested["start_at"], "end_at": requested["end_at"],
            "status": "Requested",
        }],
    )

    response = client.post("/venues/bookings", json=requested, headers=ORIGIN)

    assert response.status_code == 409
    assert "tentative" in response.json["error"]
    assert created == []


def test_event_must_be_in_planning(booking_api, monkeypatch):
    client, created, _, event = booking_api
    event["status"] = "Submitted"

    response = client.post("/venues/bookings", json=payload(), headers=ORIGIN)

    assert response.status_code == 409
    assert created == []


def test_queue_is_venue_staff_only(app, monkeypatch):
    monkeypatch.setattr("app.bookings.list_requested_bookings", lambda: [])
    client = app.test_client()
    select_user(client, 2)

    assert client.get("/venues/bookings", headers=ORIGIN).status_code == 403


def test_booking_detail_is_available_to_assigned_coordinator(app, monkeypatch):
    booking = {"id": "booking-1", "event_id": "event-1", "venue_id": "venue-1"}
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: booking)
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: event_record())
    client = app.test_client()
    select_user(client, 2)

    response = client.get("/venues/bookings/booking-1", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["booking"]["id"] == "booking-1"

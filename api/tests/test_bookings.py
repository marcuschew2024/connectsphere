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
    # SCRUM-157: anchor to 09:00 SGT (01:00 UTC) so the 2-hour slot never crosses midnight
    # in Singapore and trips the same-day rule (D40), whatever time the suite runs.
    start = (datetime.now(UTC) + timedelta(days=3)).replace(
        hour=1, minute=0, second=0, microsecond=0
    )
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
    monkeypatch.setattr("app.bookings.find_overlapping_bookings", lambda *args, **kwargs: [])
    monkeypatch.setattr(
        "app.bookings.create_notification",
        lambda *args, **kwargs: notifications.append((args, kwargs)),
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


def test_coordinator_submission_records_requested_actor_and_notifies_venue_staff_pool(booking_api):
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
    # SCRUM-49 / R07: one notification to the Venue Staff pool (recipient_role),
    # not one per staff id.
    assert notifications == [(
        (None, "event-1", "venue_booking_requested",
         "Venue booking requested for Campus workshop."),
        # SCRUM-155: the notice names the booking, so its link opens that booking.
        {"recipient_role": "Venue Staff", "subject_id": booking["id"]},
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
        lambda *args, **kwargs: [{
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
        lambda *args, **kwargs: [{
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


def test_tc_129_02_integration_back_to_back_bookings_conflict_due_to_buffers(
    booking_api, monkeypatch
):
    """TC-129-02 (Integration): Back-to-back bookings now conflict due to venue buffers."""
    client, created, _, _ = booking_api

    # Venue configured with 30-min setup and 30-min turnaround
    monkeypatch.setattr(
        "app.bookings.get_venue",
        lambda venue_id: {
            "id": venue_id,
            "capacity": 300,
            "setup_time_minutes": 30,
            "turnaround_time_minutes": 30,
        },
    )

    # Anchor to 09:00 SGT (01:00 UTC) so T+1h to T+5h stay on the same Singapore day (D40)
    base = (datetime.now(UTC) + timedelta(days=3)).replace(
        hour=1, minute=0, second=0, microsecond=0
    )
    existing_start = (base + timedelta(hours=1)).isoformat()
    existing_end = (base + timedelta(hours=3)).isoformat()

    # An existing Confirmed booking runs from T+1h to T+3h (with turnaround, occupied until T+3.5h)
    monkeypatch.setattr(
        "app.bookings.find_overlapping_bookings",
        lambda venue_id, s, e, **_buffers: [{
            "id": "existing-confirmed",
            "venue_id": venue_id,
            "start_at": existing_start,
            "end_at": existing_end,
            "status": "Confirmed",
        }],
    )

    # Coordinator requests a back-to-back slot: T+3h to T+5h
    # Under old logic (zero buffer), [1..3) and [3..5) touch at 3 and do not conflict.
    # Under SCRUM-129, existing turnaround (to 3:30) conflicts with new setup (from 2:30).
    response = client.post(
        "/venues/bookings",
        json=payload(
            start_at=existing_end,
            end_at=(base + timedelta(hours=5)).isoformat(),
        ),
        headers=ORIGIN,
    )

    assert response.status_code == 409
    assert "already confirmed or blocked" in response.json["error"]
    assert created == []

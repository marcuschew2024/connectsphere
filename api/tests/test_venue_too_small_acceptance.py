"""SCRUM-152 (SCRUM-47 AC4, SCRUM-62) against real PostgreSQL and PostgREST.

Raising expected attendance above a booked venue's capacity flags that venue on the
re-review notice, the approval response and the event's bookings. Flag only: nothing
is blocked, cancelled or un-booked (owner decision, D36).
"""

import os

import pytest

from .conftest import ORIGIN
from .test_equipment_request_acceptance import live_requests  # noqa: F401
from .test_event_completion_acceptance import live  # noqa: F401

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)

DAYS = iter(range(1, 28))


def booking(db, event, venue, status="Confirmed"):
    day = next(DAYS)
    return db.table("venue_bookings").insert({
        "venue_id": venue["id"], "event_id": event["id"], "requested_by": 2,
        "start_at": f"2098-02-{day:02d}T06:00:00Z", "end_at": f"2098-02-{day:02d}T07:00:00Z",
        "expected_attendance": 20, "layout": "Classroom", "status": status,
    }).execute().data[0]


def approve_attendance(users, event, attendance):
    request = users[1].post(f"/events/{event['id']}/change-requests", json={
        "description": "Attendance changed", "changes": {"expected_attendance": attendance},
    }, headers=ORIGIN)
    assert request.status_code == 201, request.json
    response = users[2].patch(
        f"/events/{event['id']}/change-requests/{request.json['change_request']['id']}",
        json={"status": "Approved"}, headers=ORIGIN)
    assert response.status_code == 200, response.json
    return response.json


def re_review_notice(db, event):
    [note] = db.table("notifications").select("message").eq("event_id", event["id"]).eq(
        "notification_type", "event_re_review_required").execute().data
    return note["message"]


def event_bookings(users, event):
    response = users[2].get(f"/venues/bookings/event/{event['id']}", headers=ORIGIN)
    assert response.status_code == 200, response.json
    return response.json["bookings"]


def capacity_of(db, venue):
    return db.table("venues").select("capacity").eq("id", venue["id"]).execute().data[0]["capacity"]


def test_attendance_above_a_booked_venue_capacity_is_flagged_everywhere(live):  # noqa: F811
    db, users, _, make_event, venue = live
    capacity = capacity_of(db, venue)
    event = make_event()
    held = booking(db, event, venue)

    result = approve_attendance(users, event, capacity + 50)

    assert result["affected"]["over_capacity"] == [
        {"booking_id": held["id"], "venue_name": venue["name"], "capacity": capacity}]
    assert (f"Venue too small for {capacity + 50} attendees: {venue['name']} "
            f"(capacity {capacity}).") in re_review_notice(db, event)
    bookings = event_bookings(users, event)
    assert bookings[0]["capacity_warning"] == (
        f"Expected attendance ({capacity + 50} pax) exceeds venue capacity ({capacity} pax) "
        "by 50 pax.")
    # Flag only: the booking and the event are untouched.
    stored = db.table("venue_bookings").select("status").eq("id", held["id"]).execute().data[0]
    assert stored["status"] == "Confirmed"
    assert db.table("events").select("status").eq("id", event["id"]).execute().data[0][
        "status"] == "Planning"


def test_attendance_within_capacity_is_not_flagged(live):  # noqa: F811
    db, users, _, make_event, venue = live
    event = make_event()
    booking(db, event, venue)

    result = approve_attendance(users, event, capacity_of(db, venue))

    assert result["affected"]["over_capacity"] == []
    assert "too small" not in re_review_notice(db, event)
    bookings = event_bookings(users, event)
    assert bookings[0]["capacity_warning"] is None


def test_a_cancelled_booking_is_not_flagged(live):  # noqa: F811
    db, users, _, make_event, venue = live
    event = make_event()
    booking(db, event, venue, status="Cancelled")

    result = approve_attendance(users, event, capacity_of(db, venue) + 1)

    assert result["affected"]["over_capacity"] == []
    bookings = event_bookings(users, event)
    assert bookings[0]["capacity_warning"] is None

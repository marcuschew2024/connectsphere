"""SCRUM-31 / SCRUM-126 booking input boundaries and refusals (release v1 audit).

The happy paths and lifecycle rules are covered in test_bookings.py,
test_booking_lifecycle.py and test_booking_persistence_acceptance.py. These tests pin
every refusal of a new or changed booking request, and the read/cancel guards, so a
plausible regression (for example accepting a past slot or an empty layout) fails.
"""

from datetime import UTC, datetime, timedelta

import pytest

from .conftest import ORIGIN, select_user
from .test_booking_lifecycle import booking, event
from .test_bookings import booking_api, payload  # noqa: F401


def _soon(hours):
    return (datetime.now(UTC) + timedelta(hours=hours)).isoformat()


def _past(hours):
    """SCRUM-157: yesterday 09:00 SGT (01:00 UTC) plus ``hours`` - always in the past and
    never crossing midnight in Singapore (D40), whatever time the suite runs."""
    base = (datetime.now(UTC) - timedelta(days=1)).replace(
        hour=1, minute=0, second=0, microsecond=0
    )
    return (base + timedelta(hours=hours)).isoformat()


def _anchored(hours):
    """SCRUM-157: 09:00 SGT (01:00 UTC) three days ahead, plus ``hours`` - never crosses
    midnight in Singapore (D40), whatever time the suite runs."""
    base = (datetime.now(UTC) + timedelta(days=3)).replace(
        hour=1, minute=0, second=0, microsecond=0
    )
    return (base + timedelta(hours=hours)).isoformat()


# One timestamp for "end equals start": two separate calls would differ by microseconds.
SAME_TIME = _soon(72)


def _conflict(status, venue_id="venue-1"):
    # SCRUM-157: same 09:00 SGT anchor as payload(), so the conflict overlaps it at any hour.
    start = (datetime.now(UTC) + timedelta(days=3)).replace(
        hour=1, minute=0, second=0, microsecond=0
    )
    return {"id": f"existing-{status}", "venue_id": venue_id, "status": status,
            "start_at": start.isoformat(), "end_at": (start + timedelta(hours=2)).isoformat()}


# --- Submitting a request (SCRUM-31 AC1, AC3) ---

@pytest.mark.parametrize(("body", "status", "message"), [
    (["not", "an", "object"], 400, "JSON object"),
    ({**payload(), "status": "Confirmed"}, 400, "unsupported fields"),
    ({**payload(), "requested_by": 1}, 400, "unsupported fields"),
    (payload(event_id="missing-event"), 400, "valid event"),
    (payload(event_id=7), 400, "valid event"),
    (payload(venue_id=""), 400, "Choose a venue."),
    (payload(venue_id="   "), 400, "Choose a venue."),
    (payload(venue_id=5), 400, "Choose a venue."),
    (payload(start_at="tomorrow"), 400, "valid start and end times"),
    (payload(end_at=None), 400, "valid start and end times"),
    (payload(start_at=SAME_TIME, end_at=SAME_TIME), 400, "end time must be after"),
    (payload(start_at=_soon(73), end_at=_soon(72)), 400, "end time must be after"),
    (payload(start_at=_past(0), end_at=_past(2)), 400, "cannot start in the past"),
    (payload(expected_attendance=0), 400, "positive whole-number"),
    (payload(expected_attendance=True), 400, "positive whole-number"),
    (payload(expected_attendance="80"), 400, "positive whole-number"),
    (payload(expected_attendance=301), 400, "capacity of 300"),
    (payload(layout=""), 400, "layout of 1 to 100"),
    (payload(layout="x" * 101), 400, "layout of 1 to 100"),
    (payload(layout=3), 400, "layout of 1 to 100"),
    (payload(special_requirements="x" * 2001), 400, "2000 characters"),
    (payload(special_requirements=["x"]), 400, "2000 characters"),
])
def test_invalid_submissions_are_refused_and_nothing_is_saved(booking_api, body, status, message):  # noqa: F811
    client, created, notifications, _ = booking_api
    response = client.post("/venues/bookings", json=body, headers=ORIGIN)
    assert response.status_code == status
    assert message in response.json["error"]
    assert created == [] and notifications == []


@pytest.mark.parametrize("attendance", [1, 300])
def test_attendance_boundaries_are_accepted(booking_api, attendance):  # noqa: F811
    client, created, _, _ = booking_api
    response = client.post("/venues/bookings", json=payload(expected_attendance=attendance),
                           headers=ORIGIN)
    assert response.status_code == 201
    assert created[0]["expected_attendance"] == attendance


# --- Single-day rule (D40): a booking stays within one Singapore day, server-side ---

def test_a_cross_day_booking_is_refused(booking_api):  # noqa: F811
    client, created, notifications, _ = booking_api
    response = client.post("/venues/bookings", json=payload(
        start_at="2099-10-20T23:00:00+08:00", end_at="2099-10-21T01:00:00+08:00",
    ), headers=ORIGIN)
    assert response.status_code == 400
    assert "same day" in response.json["error"]
    assert created == [] and notifications == []


def test_an_evening_slot_within_one_singapore_day_is_accepted(booking_api):  # noqa: F811
    # 06:00-09:00 SGT crosses a UTC day (22:00-01:00Z) but stays within one Singapore day.
    # A UTC-based check would wrongly reject it; the Singapore-day rule (D40) accepts it.
    client, created, _, _ = booking_api
    response = client.post("/venues/bookings", json=payload(
        start_at="2099-10-20T06:00:00+08:00", end_at="2099-10-20T09:00:00+08:00",
    ), headers=ORIGIN)
    assert response.status_code == 201
    assert len(created) == 1


def test_boundary_text_lengths_are_accepted_and_trimmed(booking_api):  # noqa: F811
    client, created, _, _ = booking_api
    response = client.post("/venues/bookings", json=payload(
        layout="  " + "L" * 100 + "  ", special_requirements="  " + "s" * 2000 + "  ",
    ), headers=ORIGIN)
    assert response.status_code == 201
    assert created[0]["layout"] == "L" * 100
    assert created[0]["special_requirements"] == "s" * 2000


def test_blank_special_requirements_are_stored_as_none(booking_api):  # noqa: F811
    client, created, _, _ = booking_api
    assert client.post("/venues/bookings", json=payload(special_requirements="   "),
                       headers=ORIGIN).status_code == 201
    assert created[0]["special_requirements"] is None


@pytest.mark.parametrize(("status", "message"), [
    ("Confirmed", "already confirmed or blocked"),
    ("Blocked", "already confirmed or blocked"),
    ("Requested", "tentative booking hold"),
])
def test_overlapping_slots_are_refused(booking_api, monkeypatch, status, message):  # noqa: F811
    client, created, _, _ = booking_api
    monkeypatch.setattr("app.bookings.find_overlapping_bookings",
                        lambda *args, **kwargs: [_conflict(status)])
    response = client.post("/venues/bookings", json=payload(), headers=ORIGIN)
    assert response.status_code == 409
    assert message in response.json["error"]
    assert created == []


def test_a_booking_on_another_venue_is_not_a_conflict(booking_api, monkeypatch):  # noqa: F811
    client, created, _, _ = booking_api
    monkeypatch.setattr("app.bookings.find_overlapping_bookings",
                        lambda *args, **kwargs: [_conflict("Confirmed", venue_id="venue-2")])
    assert client.post("/venues/bookings", json=payload(), headers=ORIGIN).status_code == 201
    assert len(created) == 1


def test_submission_requires_the_trusted_origin(booking_api):  # noqa: F811
    client, created, _, _ = booking_api
    response = client.post("/venues/bookings", json=payload(),
                           headers={"Origin": "https://attacker.example"})
    assert response.status_code == 403
    assert created == []


# --- Changing one request (SCRUM-126: each booking validated independently) ---

@pytest.fixture
def changing(app, monkeypatch):
    saved = []
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: {
        **booking(), "start_at": _anchored(0), "end_at": _anchored(2),
    } if booking_id == "booking-a" else None)
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: event())
    monkeypatch.setattr("app.bookings.get_venue", lambda venue_id: (
        {"id": venue_id, "capacity": 100} if venue_id in {"venue-1", "venue-2"} else None))
    monkeypatch.setattr("app.bookings.find_overlapping_bookings", lambda *args, **kwargs: [])
    monkeypatch.setattr("app.bookings.update_requested_booking",
                        lambda booking_id, fields, user_id: saved.append(fields) or fields)
    client = app.test_client()
    select_user(client, 2)
    return client, saved


@pytest.mark.parametrize(("body", "message"), [
    ("text", "JSON object"),
    ({"venue_id": "venue-unknown"}, "valid venue"),
    ({"venue_id": 9}, "valid venue"),
    ({"start_at": "soon"}, "valid start and end times"),
    ({"start_at": _soon(80), "end_at": _soon(79)}, "end time must be after"),
    ({"start_at": _past(0), "end_at": _past(2)}, "cannot start in the past"),
    ({"expected_attendance": 0}, "positive whole-number"),
    ({"expected_attendance": 101}, "capacity of 100"),
    ({"layout": " "}, "layout of 1 to 100"),
    ({"special_requirements": "x" * 2001}, "2000 characters"),
])
def test_invalid_changes_are_refused_and_nothing_is_saved(changing, body, message):
    client, saved = changing
    response = client.patch("/venues/bookings/booking-a", json=body, headers=ORIGIN)
    assert response.status_code == 400
    assert message in response.json["error"]
    assert saved == []


def test_unchanged_details_are_kept_when_only_some_fields_change(changing):
    client, saved = changing
    response = client.patch("/venues/bookings/booking-a", json={"layout": "  Classroom "},
                            headers=ORIGIN)
    assert response.status_code == 200
    assert saved[0]["layout"] == "Classroom"
    assert saved[0]["venue_id"] == "venue-1" and saved[0]["expected_attendance"] == 50


@pytest.mark.parametrize(("status", "message"), [
    ("Confirmed", "already confirmed or blocked"), ("Held", "tentative booking hold"),
])
def test_a_change_into_an_occupied_slot_is_refused(changing, monkeypatch, status, message):
    client, saved = changing
    monkeypatch.setattr("app.bookings.find_overlapping_bookings",
                        lambda *args, **kwargs: [_conflict(status)])
    response = client.patch("/venues/bookings/booking-a",
                            json={"start_at": _anchored(0), "end_at": _anchored(2)},
                            headers=ORIGIN)
    assert response.status_code == 409
    assert message in response.json["error"]
    assert saved == []


def test_the_booking_itself_is_not_its_own_conflict(changing, monkeypatch):
    client, saved = changing
    monkeypatch.setattr("app.bookings.find_overlapping_bookings", lambda *args, **kwargs: [
        {**_conflict("Requested"), "id": "booking-a"},
    ])
    assert client.patch("/venues/bookings/booking-a", json={"layout": "Theatre"},
                        headers=ORIGIN).status_code == 200


def test_changing_needs_an_existing_booking_and_event(changing, monkeypatch):
    client, saved = changing
    assert client.patch("/venues/bookings/booking-z", json={}, headers=ORIGIN).status_code == 404
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: None)
    assert client.patch("/venues/bookings/booking-a", json={}, headers=ORIGIN).status_code == 404
    assert saved == []


# --- Reading and cancelling ---

def test_reading_and_cancelling_unknown_records_returns_404(app, monkeypatch):
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: None)
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: None)
    client = app.test_client()
    select_user(client, 2)
    assert client.get("/venues/bookings/missing", headers=ORIGIN).status_code == 404
    assert client.get("/venues/bookings/event/missing", headers=ORIGIN).status_code == 404
    assert client.post("/venues/bookings/missing/cancel", headers=ORIGIN).status_code == 404


def test_venue_staff_read_the_queue_bookings_and_event_arrangements(app, monkeypatch):
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: booking())
    monkeypatch.setattr("app.bookings.get_event_by_id", lambda event_id: event())
    monkeypatch.setattr("app.bookings.list_requested_bookings", lambda: [booking()])
    monkeypatch.setattr("app.bookings.list_bookings_for_event_detail",
                        lambda event_id: [booking(), booking(booking_id="booking-b")])
    client = app.test_client()
    select_user(client, 3)
    assert client.get("/venues/bookings", headers=ORIGIN).json["bookings"][0]["id"] == "booking-a"
    assert client.get("/venues/bookings/booking-a", headers=ORIGIN).status_code == 200
    siblings = client.get("/venues/bookings/event/event-1", headers=ORIGIN).json["bookings"]
    assert [row["id"] for row in siblings] == ["booking-a", "booking-b"]


@pytest.mark.parametrize("user_id", [1, 4, 5])
def test_other_roles_cannot_read_the_queue(app, monkeypatch, user_id):
    monkeypatch.setattr("app.bookings.list_requested_bookings", lambda: [booking()])
    client = app.test_client()
    select_user(client, user_id)
    assert client.get("/venues/bookings", headers=ORIGIN).status_code == 403


def test_a_venue_that_does_not_exist_is_refused(booking_api, monkeypatch):  # noqa: F811
    client, created, _, _ = booking_api
    monkeypatch.setattr("app.bookings.get_venue", lambda venue_id: None)
    response = client.post("/venues/bookings", json=payload(venue_id="venue-gone"), headers=ORIGIN)
    assert response.status_code == 400
    assert response.json["error"] == "Choose a valid venue."
    assert created == []

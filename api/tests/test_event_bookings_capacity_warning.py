"""SCRUM-152 unit tests: which of an event's bookings the capacity re-check flags.

The route compares the event's current expected attendance with each active booking's
venue capacity (CapacityRule). Boundaries: at capacity / one over / missing capacity,
and every booking status (only bookings that still hold the venue are flagged).
"""

import pytest

from .conftest import ORIGIN, select_user

EVENT_ID = "15200000-0000-4000-8000-0000000000aa"


@pytest.fixture
def event_bookings(app, monkeypatch):
    state = {"event": {"id": EVENT_ID, "organiser_id": 1, "coordinator_id": 2,
                       "status": "Planning", "expected_attendance": 101},
             "bookings": []}
    monkeypatch.setattr("app.bookings.get_event_by_id",
                        lambda event_id: state["event"] if event_id == EVENT_ID else None)
    monkeypatch.setattr("app.bookings.require_related_user", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.bookings.list_bookings_for_event_detail",
                        lambda event_id: [dict(row) for row in state["bookings"]])
    client = app.test_client()
    select_user(client, 2)

    def read(attendance, bookings):
        state["event"]["expected_attendance"] = attendance
        state["bookings"] = bookings
        response = client.get(f"/venues/bookings/event/{EVENT_ID}", headers=ORIGIN)
        assert response.status_code == 200, response.json
        return [row["capacity_warning"] for row in response.json["bookings"]]

    return read


def booking(status="Confirmed", capacity=100):
    return {"id": f"b-{status}", "status": status, "venue": {"name": "Hall", "capacity": capacity}}


@pytest.mark.parametrize(("attendance", "flagged"), [(99, False), (100, False), (101, True)])
def test_capacity_boundary(event_bookings, attendance, flagged):
    [warning] = event_bookings(attendance, [booking()])
    assert (warning is not None) is flagged
    if flagged:
        assert warning == ("Expected attendance (101 pax) exceeds venue capacity (100 pax) "
                           "by 1 pax.")


@pytest.mark.parametrize("status", ["Requested", "Pending", "Held", "Confirmed"])
def test_every_booking_that_holds_the_venue_is_rechecked(event_bookings, status):
    assert event_bookings(150, [booking(status)])[0] is not None


@pytest.mark.parametrize("status", ["Rejected", "Cancelled", "Released"])
def test_bookings_that_no_longer_hold_the_venue_are_not_flagged(event_bookings, status):
    assert event_bookings(150, [booking(status)]) == [None]


def test_missing_capacity_or_attendance_is_never_flagged(event_bookings):
    assert event_bookings(150, [booking(capacity=None)]) == [None]
    assert event_bookings(None, [booking()]) == [None]


def test_each_booking_is_judged_on_its_own_venue(event_bookings):
    small, large = booking(capacity=60), {**booking(capacity=500), "id": "b-large"}
    warnings = event_bookings(80, [small, large])
    assert warnings[0] is not None and warnings[1] is None

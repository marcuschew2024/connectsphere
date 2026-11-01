"""SCRUM-161: booking time boundaries and confirmation's legacy-time inputs."""

from datetime import UTC, datetime, timedelta

import pytest

from app.event_confirmation import EventConfirmation
from app.venue_search import availability

from .conftest import ORIGIN
from .test_booking_decision_route import booking_db as decision_db  # noqa: F401
from .test_booking_decision_route import decide, seed
from .test_booking_decision_route import venue_staff as staff_client  # noqa: F401
from .test_bookings import booking_api as booking_api  # noqa: F401
from .test_venue_search import slot
from .test_venues import details


@pytest.mark.parametrize(
    "expiry,message",
    [
        ("not-a-date", "Invalid expiry"),
        ("2000-01-01T00:00:00Z", "in the future"),
        ("2099-10-20T06:00:00Z", "before the event"),
    ],
)
def test_invalid_hold_expiry_leaves_booking_and_notifications_unchanged(request, expiry, message):
    db, staff = request.getfixturevalue("decision_db"), request.getfixturevalue("staff_client")
    booking = seed(db)
    response = decide(staff, booking["id"], "hold", expires_at=expiry)
    assert response.status_code == 400
    assert message in response.json["error"]
    assert booking["status"] == "Requested" and db.notifications == []


def test_default_hold_for_an_imminent_booking_expires_before_it_starts(request, monkeypatch):
    now = datetime(2099, 10, 20, 5, 15, tzinfo=UTC)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz)

    monkeypatch.setattr("app.bookings.datetime", Clock)
    db, staff = request.getfixturevalue("decision_db"), request.getfixturevalue("staff_client")
    booking = seed(db)
    response = decide(staff, booking["id"], "hold")
    assert response.status_code == 200
    expiry = datetime.fromisoformat(response.json["booking"]["expires_at"])
    assert expiry == now + timedelta(minutes=30)
    assert expiry < datetime.fromisoformat(booking["start_at"])
    assert [n["notification_type"] for n in db.notifications] == ["booking_held"]


def test_rejection_without_an_alternative_still_notifies_the_requester(request):
    db, staff = request.getfixturevalue("decision_db"), request.getfixturevalue("staff_client")
    booking = seed(db)
    response = decide(staff, booking["id"], "reject", reason="Maintenance")
    assert response.status_code == 200
    assert len(db.notifications) == 1
    assert db.notifications[0]["message"] == "Your venue booking was rejected: Maintenance"
    assert db.notifications[0]["recipient_id"] == booking["requested_by"]


@pytest.mark.parametrize(
    "event_time",
    [
        datetime(2099, 10, 20, tzinfo=UTC),
        "unreadable",
        "2099-10-20T00:00:00",
        "2099-10-20T00:00:00Z",
    ],
)
def test_legacy_time_representation_cannot_bypass_an_unresolved_booking(event_time):
    gate = EventConfirmation.from_bookings([{"status": "Requested"}], event_datetime=event_time)
    assert not gate.can_confirm
    assert any("awaiting approval" in message for message in gate.outstanding)


@pytest.mark.parametrize(
    "candidates",
    [
        [
            {
                "id": "adjacent",
                "venue_id": "venue",
                "status": "Confirmed",
                "start_at": "2026-10-05T10:00:00+00:00",
                "end_at": "2026-10-05T11:00:00+00:00",
            }
        ],
        [{"status": "Requested"}],
    ],
)
def test_search_does_not_treat_a_nonblocking_candidate_as_a_confirmed_conflict(
    monkeypatch, candidates
):
    monkeypatch.setattr(
        "app.venue_search.find_overlapping_bookings", lambda *args, **kwargs: candidates
    )
    monkeypatch.setattr("app.venue_search.list_unavailability", lambda *args: [])
    assert availability({**details(), "id": "venue"}, slot()) == "available"


def test_changing_a_booking_cannot_cross_midnight_in_singapore(request, monkeypatch):
    from .test_bookings import payload

    client, created, notifications, _ = request.getfixturevalue("booking_api")
    booking = {**payload(), "id": "booking", "requested_by": 2, "status": "Requested"}
    monkeypatch.setattr("app.bookings.get_booking", lambda _: booking)
    response = client.patch(
        "/venues/bookings/booking",
        json={
            "start_at": "2099-10-20T23:00:00+08:00",
            "end_at": "2099-10-21T01:00:00+08:00",
        },
        headers=ORIGIN,
    )
    assert response.status_code == 400
    assert "same day" in response.json["error"]
    assert created == [] and notifications == []


@pytest.mark.parametrize("text", ["projectar projectur projecter", "projecter projectur projectar"])
def test_multiple_near_misses_produce_one_stable_canonical_hint(text):
    from app.venue_suitability import find_requested

    assert find_requested("Projector", text) == (False, "Did you mean 'Projector'?")

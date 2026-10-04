"""SCRUM-33 unit tests for the reusable overlap policy."""

from datetime import UTC, datetime, timedelta

from app.venue_overlap import OverlapEngine

START = datetime(2099, 10, 20, 6, tzinfo=UTC)


def booking(status, start=START, hours=2, booking_id=None):
    return {
        "id": booking_id or status,
        "venue_id": "venue-1",
        "start_at": start.isoformat(),
        "end_at": (start + timedelta(hours=hours)).isoformat(),
        "status": status,
    }


def test_confirmed_overlap_is_hard_blocked():
    result = OverlapEngine().evaluate(
        "venue-1", START, START + timedelta(hours=1), [booking("Confirmed")]
    )

    assert result.can_request is False
    assert result.can_confirm is False
    assert result.hard_conflict.status == "Confirmed"


def test_blocked_overlap_is_hard_blocked():
    result = OverlapEngine().evaluate(
        "venue-1", START, START + timedelta(hours=1), [booking("Blocked")]
    )

    assert result.can_request is False
    assert result.can_confirm is False
    assert result.hard_conflict.status == "Blocked"


def test_one_tentative_hold_blocks_another_request():
    result = OverlapEngine().evaluate(
        "venue-1", START, START + timedelta(hours=1), [booking("Requested")]
    )

    assert result.can_request is False
    assert result.can_confirm is True
    assert result.tentative_conflict.status == "Requested"


def test_confirmed_booking_beats_tentative_hold():
    result = OverlapEngine().evaluate(
        "venue-1", START, START + timedelta(hours=1),
        [booking("Requested"), booking("Confirmed", booking_id="confirmed")],
    )

    assert result.hard_conflict.status == "Confirmed"
    assert result.can_confirm is False


def test_touching_slots_do_not_overlap():
    result = OverlapEngine().evaluate(
        "venue-1", START + timedelta(hours=2), START + timedelta(hours=4), [booking("Confirmed")]
    )

    assert result.can_request is True


def test_different_venue_does_not_conflict():
    result = OverlapEngine().evaluate(
        "venue-2", START, START + timedelta(hours=1), [booking("Confirmed")]
    )

    assert result.can_request is True


def test_excluded_booking_is_ignored_when_confirming_itself():
    result = OverlapEngine().evaluate(
        "venue-1", START, START + timedelta(hours=1), [booking("Requested", booking_id="current")],
        exclude_booking_id="current",
    )

    assert result.can_confirm is True

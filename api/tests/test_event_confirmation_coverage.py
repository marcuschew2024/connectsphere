"""SCRUM-166 (audit R4) unit tests: the confirmation gate judges the event's whole time.

Venue bookings must together cover [start, end) with no gap; an approved booking that
does not touch the event at all is an orphan; a Reserved equipment request's window must
cover the event. Events without an end time keep the start-instant rule (SCRUM-159).
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.event_confirmation import EventConfirmation

START = datetime(2099, 10, 20, 6, 0, tzinfo=UTC)  # 14:00 SGT
END = START + timedelta(hours=3)                   # 17:00 SGT


def at(hours):
    return (START + timedelta(hours=hours)).isoformat()


def booking(start_h, end_h, status="Confirmed"):
    return {"status": status, "start_at": at(start_h), "end_at": at(end_h)}


def gate(bookings, equipment=(), end=END):
    return EventConfirmation.from_arrangements(
        list(bookings), list(equipment),
        event_datetime=START.isoformat(), event_end=end.isoformat() if end else None)


# --- Venue coverage ------------------------------------------------------------

@pytest.mark.parametrize("bookings", [
    [booking(0, 3)],                      # exactly the event
    [booking(-1, 4)],                     # wider than the event
    [booking(0, 1.5), booking(1.5, 3)],   # two adjacent bookings meet exactly
    [booking(0, 2), booking(1, 3)],       # two overlapping bookings
    [booking(0, 3), booking(1, 2)],       # main hall + shorter breakout room
    [booking(1.5, 3), booking(0, 1.5)],   # order does not matter
])
def test_bookings_that_together_cover_the_event_allow_confirmation(bookings):
    result = gate(bookings)
    assert result.can_confirm, result.outstanding
    assert result.outstanding == []


@pytest.mark.parametrize(("bookings", "why"), [
    ([booking(0, 1)], "1-hour booking for a 3-hour event"),
    ([booking(0.5, 3)], "the first half hour is uncovered"),
    ([booking(0, 2.99)], "a minute short at the end"),
    ([booking(0, 1), booking(2, 3)], "an hour's gap in the middle"),
    ([booking(0, 1), booking(1, 2)], "adjacent but stop an hour early"),
])
def test_any_uncovered_part_of_the_event_blocks_confirmation(bookings, why):
    result = gate(bookings)
    assert not result.can_confirm, why
    assert any("do not cover the event's full time" in reason for reason in result.outstanding)


def test_only_approved_bookings_count_towards_coverage():
    # A rejected booking that would fill the gap does not count.
    result = gate([booking(0, 1), booking(1, 3, status="Rejected")])
    assert not result.can_confirm


def test_an_approved_booking_that_misses_the_event_is_an_orphan():
    # Full coverage exists, but an old booking for another time is still approved.
    result = gate([booking(0, 3), booking(24, 26)])
    assert not result.can_confirm
    assert any("no longer match" in reason for reason in result.outstanding)
    assert not any("full time" in reason for reason in result.outstanding)


def test_a_booking_touching_only_the_event_end_is_an_orphan():
    # Half-open: a booking starting exactly at the event's end does not overlap it.
    result = gate([booking(0, 3), booking(3, 4)])
    assert not result.can_confirm
    assert any("no longer match" in reason for reason in result.outstanding)


def test_an_approved_booking_with_unreadable_times_never_invents_a_conflict():
    unreadable = {"status": "Confirmed", "start_at": "not a time", "end_at": None}
    assert gate([booking(0, 3), unreadable]).can_confirm


# --- Events without an end time (unchanged SCRUM-159 behaviour) ------------------

@pytest.mark.parametrize("end", [None, START, START - timedelta(hours=1)])
def test_without_a_usable_end_the_start_instant_rule_applies(end):
    # A 1-hour booking covering the start is enough when the event's length is unknown.
    assert gate([booking(0, 1)], end=end).can_confirm
    # ... and a booking that misses the start still blocks.
    assert not gate([booking(1, 2)], end=end).can_confirm


# --- Equipment timing ------------------------------------------------------------

def reservation(start_h, end_h, status="Reserved"):
    return {"id": "r", "status": status,
            "reservation_start_at": at(start_h), "reservation_end_at": at(end_h)}


@pytest.mark.parametrize("window", [(0, 3), (-0.5, 3.5)])
def test_a_reservation_covering_the_event_is_ready(window):
    assert gate([booking(0, 3)], [reservation(*window)]).can_confirm


@pytest.mark.parametrize("window", [(0, 1), (0.5, 3), (0, 2.99), (24, 27)])
def test_a_reservation_missing_any_part_of_the_event_blocks(window):
    result = gate([booking(0, 3)], [reservation(*window)])
    assert not result.can_confirm
    assert any("equipment reservation(s) do not cover" in r for r in result.outstanding)


def test_a_reservation_without_a_recorded_window_is_not_counted_as_mistimed():
    assert gate([booking(0, 3)], [{"id": "r", "status": "Reserved"}]).can_confirm


def test_an_unreserved_request_still_blocks_through_technical_readiness():
    result = gate([booking(0, 3)], [reservation(0, 3, status="Requested")])
    assert not result.can_confirm
    assert "Technical arrangements are not yet resolved." in result.outstanding
    assert not any("do not cover" in r for r in result.outstanding)


def test_without_an_end_a_reservation_must_cover_the_start_instant():
    assert gate([booking(0, 1)], [reservation(0, 1)], end=None).can_confirm
    assert not gate([booking(0, 1)], [reservation(1, 2)], end=None).can_confirm


def test_every_blocking_reason_is_reported_together():
    result = gate([booking(0, 1)], [reservation(0, 1)])
    assert len(result.outstanding) == 2


def test_without_any_event_time_a_reservation_window_cannot_be_judged():
    # No date at all: there is nothing to compare the window with, so it is not mistimed.
    result = EventConfirmation.from_arrangements(
        [{"status": "Confirmed", "start_at": at(0), "end_at": at(1)}], [reservation(0, 1)],
        event_datetime=None, event_end=None)
    assert result.can_confirm, result.outstanding

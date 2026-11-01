"""Unit tests for EventConfirmation (SCRUM-39).

Pure domain-logic tests - no database, no Flask. They encode the confirmation
gate from the story's acceptance criteria (Week 7 change #3, multi-venue):
an event may be confirmed only when every venue booking is approved and the
technical arrangements are resolved. Endpoint-level ACs (Coordinator role,
Planning-only, status history, the 409 response body) are covered by the
acceptance suite once POST /events/<id>/confirm lands.

Each test traces to an acceptance criterion and is written to fail for a
plausible wrong implementation (Week 6 five-question review), not merely to
accept the current code.
"""

from app.event_confirmation import EventConfirmation

# --- AC1 happy path: all venue bookings approved -> confirm allowed ---

def test_all_bookings_confirmed_allows_confirmation():
    gate = EventConfirmation(["Confirmed", "Confirmed"])
    assert gate.can_confirm is True
    assert gate.outstanding == []


def test_single_confirmed_booking_allows_confirmation():
    gate = EventConfirmation(["Confirmed"])
    assert gate.can_confirm is True


# --- AC4 negative: a still-pending booking blocks confirmation ---

def test_requested_booking_blocks_confirmation():
    gate = EventConfirmation(["Confirmed", "Requested"])
    assert gate.can_confirm is False
    assert any("awaiting approval" in reason for reason in gate.outstanding)


def test_pending_booking_blocks_confirmation():
    gate = EventConfirmation(["Pending"])
    assert gate.can_confirm is False


def test_unknown_status_blocks_confirmation():
    # Defensive: a status we do not recognise is treated as unsettled so it
    # blocks, rather than being silently allowed through the gate.
    gate = EventConfirmation(["Confirmed", "Tentative"])
    assert gate.can_confirm is False


# --- Boundary: an event with no venue booked cannot be confirmed (PO decision) ---

def test_no_bookings_blocks_confirmation():
    gate = EventConfirmation([])
    assert gate.can_confirm is False
    assert any("No venue" in reason for reason in gate.outstanding)


# --- Rejected bookings are settled history, not a block (PO decision) ---

def test_rejected_booking_does_not_block_when_a_venue_is_confirmed():
    gate = EventConfirmation(["Confirmed", "Rejected"])
    assert gate.can_confirm is True
    assert gate.outstanding == []


def test_only_rejected_bookings_blocks_for_no_approved_venue():
    gate = EventConfirmation(["Rejected"])
    assert gate.can_confirm is False
    assert any("No venue" in reason for reason in gate.outstanding)


def test_cancelled_booking_does_not_block_remaining_approved_venue():
    gate = EventConfirmation.from_bookings([
        {"status": "Confirmed"}, {"status": "Cancelled"},
    ])
    assert gate.can_confirm is True
    assert gate.outstanding == []


def test_only_cancelled_bookings_still_requires_an_approved_venue():
    gate = EventConfirmation(["Cancelled"])
    assert gate.can_confirm is False
    assert gate.outstanding == ["No venue has been booked and approved yet."]


# --- AC1 technical-arrangements seam (equipment, SCRUM-37, plugs in here) ---

def test_unresolved_technical_arrangements_block_confirmation():
    gate = EventConfirmation(["Confirmed"], technical_resolved=False)
    assert gate.can_confirm is False
    assert any("Technical" in reason for reason in gate.outstanding)


def test_outstanding_lists_every_blocking_reason():
    gate = EventConfirmation(["Requested"], technical_resolved=False)
    reasons = gate.outstanding
    assert any("awaiting approval" in reason for reason in reasons)
    assert any("Technical" in reason for reason in reasons)


# --- from_bookings maps real venue-booking rows to the gate ---

def test_from_bookings_reads_the_status_field():
    bookings = [{"status": "Confirmed"}, {"status": "Requested"}]
    gate = EventConfirmation.from_bookings(bookings)
    assert gate.can_confirm is False


def test_from_bookings_all_confirmed_allows_confirmation():
    gate = EventConfirmation.from_bookings([{"status": "Confirmed"}])
    assert gate.can_confirm is True


# --- SCRUM-159: an approved booking whose slot drifted from the event blocks confirm (NFR-d) ---
# Slots anchored to a fixed Singapore hour so the window never crosses midnight (SCRUM-157).

_EVENT_AT = "2026-11-15T14:00:00+08:00"


def _booking(status, start, end):
    return {"status": status, "start_at": start, "end_at": end}


def test_confirmed_booking_covering_event_datetime_allows_confirmation():
    # Booking slot 14:00-16:00 SGT contains the event instant -> no drift.
    gate = EventConfirmation.from_bookings(
        [_booking("Confirmed", "2026-11-15T14:00:00+08:00", "2026-11-15T16:00:00+08:00")],
        event_datetime=_EVENT_AT,
    )
    assert gate.can_confirm is True


def test_confirmed_booking_not_covering_event_datetime_blocks_confirmation():
    # Event moved to 14:00 but the approved booking still sits at 09:00-11:00 -> orphaned.
    gate = EventConfirmation.from_bookings(
        [_booking("Confirmed", "2026-11-15T09:00:00+08:00", "2026-11-15T11:00:00+08:00")],
        event_datetime=_EVENT_AT,
    )
    assert gate.can_confirm is False
    assert any("no longer match" in reason for reason in gate.outstanding)


def test_missing_event_datetime_keeps_original_behaviour():
    # Backward compatible: without an event datetime the slot is never inspected.
    gate = EventConfirmation.from_bookings(
        [_booking("Confirmed", "2026-11-15T09:00:00+08:00", "2026-11-15T11:00:00+08:00")],
    )
    assert gate.can_confirm is True


def test_event_at_booking_start_is_covered_but_at_booking_end_is_not():
    # Half-open window [start, end): the start instant is in, the end instant is out.
    covers_start = EventConfirmation.from_bookings(
        [_booking("Confirmed", "2026-11-15T14:00:00+08:00", "2026-11-15T16:00:00+08:00")],
        event_datetime="2026-11-15T14:00:00+08:00",
    )
    at_end = EventConfirmation.from_bookings(
        [_booking("Confirmed", "2026-11-15T12:00:00+08:00", "2026-11-15T14:00:00+08:00")],
        event_datetime="2026-11-15T14:00:00+08:00",
    )
    assert covers_start.can_confirm is True
    assert at_end.can_confirm is False


def test_one_covering_and_one_drifted_booking_still_blocks():
    gate = EventConfirmation.from_bookings(
        [
            _booking("Confirmed", "2026-11-15T14:00:00+08:00", "2026-11-15T16:00:00+08:00"),
            _booking("Confirmed", "2026-11-15T08:00:00+08:00", "2026-11-15T09:00:00+08:00"),
        ],
        event_datetime=_EVENT_AT,
    )
    assert gate.can_confirm is False
    assert any("1 approved venue booking" in reason for reason in gate.outstanding)


def test_unreadable_or_timezone_naive_slot_does_not_block():
    # Cannot judge the slot -> treat as not drifted; the status checks still apply.
    gate = EventConfirmation.from_bookings(
        [_booking("Confirmed", "not-a-date", None)],
        event_datetime=_EVENT_AT,
    )
    assert gate.can_confirm is True


def test_a_drifted_but_rejected_booking_does_not_block():
    # Only approved (Confirmed) bookings are checked for drift; a settled one is ignored.
    gate = EventConfirmation.from_bookings(
        [
            _booking("Confirmed", "2026-11-15T14:00:00+08:00", "2026-11-15T16:00:00+08:00"),
            _booking("Rejected", "2026-11-15T01:00:00+08:00", "2026-11-15T02:00:00+08:00"),
        ],
        event_datetime=_EVENT_AT,
    )
    assert gate.can_confirm is True


def test_from_arrangements_forwards_event_datetime_to_the_slot_check():
    gate = EventConfirmation.from_arrangements(
        [_booking("Confirmed", "2026-11-15T09:00:00+08:00", "2026-11-15T11:00:00+08:00")],
        [],
        event_datetime=_EVENT_AT,
    )
    assert gate.can_confirm is False
    assert any("no longer match" in reason for reason in gate.outstanding)

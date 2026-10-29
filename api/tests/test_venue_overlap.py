"""SCRUM-33 + SCRUM-129 unit tests for the reusable overlap and buffer policy.

Test Register Traceability:
- TC-129-01: Booking reserves start - setup ... end + turnaround (buffer math + overlap)
- TC-129-02: Back-to-back bookings now conflict (buffer) + boundary cases
- Acceptance Criterion 3: Existing bookings that become conflicting under new rule are identified
"""

from datetime import UTC, datetime, timedelta

from app.venue_overlap import BookingInterval, OverlapEngine

START = datetime(2099, 10, 20, 10, 0, tzinfo=UTC)


def booking(status, start=START, hours=2, booking_id=None, setup=0, turnaround=0):
    return {
        "id": booking_id or status,
        "venue_id": "venue-1",
        "start_at": start.isoformat(),
        "end_at": (start + timedelta(hours=hours)).isoformat(),
        "status": status,
        "setup_minutes": setup,
        "turnaround_minutes": turnaround,
    }


# ==============================================================================
# TC-129-01: Buffer Math and Effective Occupied Window
# ==============================================================================
def test_tc_129_01_booking_reserves_start_minus_setup_to_end_plus_turnaround():
    """AC1 & AC2: 10:00-12:00 with 30 min setup and 45 min turnaround occupies 09:30-12:45."""
    start = datetime(2099, 10, 20, 10, 0, tzinfo=UTC)
    end = datetime(2099, 10, 20, 12, 0, tzinfo=UTC)

    interval = BookingInterval(
        booking_id="b-1",
        venue_id="venue-1",
        start_at=start,
        end_at=end,
        status="Confirmed",
        setup_minutes=30,
        turnaround_minutes=45,
    )

    expected_start = datetime(2099, 10, 20, 9, 30, tzinfo=UTC)
    expected_end = datetime(2099, 10, 20, 12, 45, tzinfo=UTC)

    assert interval.occupied_start == expected_start
    assert interval.occupied_end == expected_end


def test_tc_129_01_overlap_inside_setup_buffer_conflicts():
    """An event requesting 09:15 to 09:45 overlaps with the 09:30 setup period."""
    engine = OverlapEngine()
    existing = [booking("Confirmed", start=START, hours=2)]  # 10:00 to 12:00

    # Query 08:30 to 09:45 (published) with 0 buffers: touches 09:30-12:45 occupied window
    query_start = datetime(2099, 10, 20, 8, 30, tzinfo=UTC)
    query_end = datetime(2099, 10, 20, 9, 45, tzinfo=UTC)

    result = engine.evaluate(
        "venue-1",
        query_start,
        query_end,
        existing,
        setup_minutes=30,  # existing occupied starts at 09:30
        turnaround_minutes=45,
    )

    assert result.can_request is False
    assert result.hard_conflict is not None


def test_tc_129_01_overlap_inside_turnaround_buffer_conflicts():
    """An event requesting 12:15 to 13:00 overlaps with the 12:00-12:45 turnaround buffer."""
    engine = OverlapEngine()
    existing = [booking("Confirmed", start=START, hours=2)]  # 10:00 to 12:00

    query_start = datetime(2099, 10, 20, 12, 15, tzinfo=UTC)
    query_end = datetime(2099, 10, 20, 13, 15, tzinfo=UTC)

    result = engine.evaluate(
        "venue-1",
        query_start,
        query_end,
        existing,
        setup_minutes=30,
        turnaround_minutes=45,  # existing occupied ends at 12:45
    )

    assert result.can_request is False
    assert result.hard_conflict is not None


# ==============================================================================
# TC-129-02: Back-to-Back Bookings Conflict with Buffers
# ==============================================================================
def test_tc_129_02_back_to_back_bookings_now_conflict_due_to_buffers():
    """Under SCRUM-33, 10:00-12:00 and 12:00-14:00 were allowed.
    Under SCRUM-129, 30m setup + 45m turnaround means 10:00-12:00 occupies up to 12:45,
    and 12:00-14:00 needs setup from 11:30 -> They CONFLICT.
    """
    engine = OverlapEngine()
    # Existing booking: 10:00 - 12:00 Confirmed
    existing = [booking("Confirmed", start=START, hours=2)]

    # New request: 12:00 - 14:00 (back-to-back published times)
    req_start = START + timedelta(hours=2)  # 12:00
    req_end = req_start + timedelta(hours=2)  # 14:00

    # With 30m setup and 45m turnaround:
    result = engine.evaluate(
        "venue-1",
        req_start,
        req_end,
        existing,
        setup_minutes=30,
        turnaround_minutes=45,
    )

    assert result.can_request is False
    assert result.can_confirm is False
    assert result.hard_conflict is not None
    assert result.hard_conflict.status == "Confirmed"


def test_tc_129_02_touching_occupied_boundaries_do_not_conflict():
    """Boundary case: occupied_start == previous occupied_end does not conflict.

    Booking 1: 10:00-12:00 with 45m turnaround -> occupied until 12:45.
    Booking 2: 13:15-15:00 with 30m setup -> occupied starts at 12:45.
    Touching at 12:45 does NOT conflict (half-open intervals).
    """
    engine = OverlapEngine()
    existing = [booking("Confirmed", start=START, hours=2)]  # occupied 09:30 - 12:45

    # Booking 2 starts at 13:15, with 30m setup -> occupied starts at 12:45
    b2_start = datetime(2099, 10, 20, 13, 15, tzinfo=UTC)
    b2_end = datetime(2099, 10, 20, 15, 15, tzinfo=UTC)

    result = engine.evaluate(
        "venue-1",
        b2_start,
        b2_end,
        existing,
        setup_minutes=30,
        turnaround_minutes=45,
    )

    assert result.can_request is True
    assert result.can_confirm is True


def test_tc_129_02_zero_buffers_backward_compatible():
    """When setup and turnaround are 0, back-to-back 10:00-12:00 and 12:00-14:00 do not conflict."""
    engine = OverlapEngine()
    existing = [booking("Confirmed", start=START, hours=2)]

    b2_start = START + timedelta(hours=2)
    b2_end = b2_start + timedelta(hours=2)

    result = engine.evaluate(
        "venue-1",
        b2_start,
        b2_end,
        existing,
        setup_minutes=0,
        turnaround_minutes=0,
    )

    assert result.can_request is True


# ==============================================================================
# Acceptance Criterion 3: Identify Problematic Existing Bookings
# ==============================================================================
def test_identify_problematic_existing_bookings_when_buffers_introduced():
    """Existing bookings that were valid under raw times become flagged under buffer rules."""
    engine = OverlapEngine()

    # Two existing back-to-back bookings already in database
    booking_1 = {
        "id": "b-1",
        "venue_id": "venue-1",
        "start_at": START.isoformat(),
        "end_at": (START + timedelta(hours=2)).isoformat(),  # 10:00 - 12:00
        "status": "Confirmed",
    }
    booking_2 = {
        "id": "b-2",
        "venue_id": "venue-1",
        "start_at": (START + timedelta(hours=2)).isoformat(),  # 12:00 - 14:00
        "end_at": (START + timedelta(hours=4)).isoformat(),
        "status": "Confirmed",
    }

    # Under new rule: 30m setup + 45m turnaround
    problematic = engine.identify_problematic_bookings(
        "venue-1",
        [booking_1, booking_2],
        setup_minutes=30,
        turnaround_minutes=45,
    )

    assert len(problematic) == 2
    flagged_ids = {p["booking"]["id"] for p in problematic}
    assert flagged_ids == {"b-1", "b-2"}
    assert "conflicting with 1 existing booking(s)" in problematic[0]["reason"]


# ==============================================================================
# Preserved SCRUM-33 Baseline Tests
# ==============================================================================
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

"""SCRUM-33 + SCRUM-129 unit tests for the reusable overlap and buffer policy.

Test Register Traceability:
- TC-129-01: Booking reserves start - setup ... end + turnaround (buffer math + overlap)
- TC-129-02: Back-to-back bookings now conflict (buffer) + boundary cases
- Acceptance Criterion 3: Existing bookings that become conflicting under new rule are identified
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.venue_overlap import BookingInterval, OverlapEngine, _as_utc, _highest_priority

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


# ==============================================================================
# SCRUM-79: Tentatively Hold a Venue (TC-79-01, TC-79-02, TC-79-03)
# ==============================================================================

def test_tc_79_01_confirmed_booking_overrides_tentative_hold():
    """AC2 (S1 Q3, Q17, Q31): A confirmed booking (FCFS) overrides a tentative hold."""
    engine = OverlapEngine()
    # Existing active hold on slot 10:00 - 12:00
    existing_hold = [
        {
            "id": "hold-1",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Held",
            "expires_at": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
        }
    ]

    result = engine.evaluate(
        "venue-1",
        START,
        START + timedelta(hours=2),
        existing_hold,
    )

    # An active hold produces a tentative_conflict, but NOT a hard_conflict
    assert result.tentative_conflict is not None
    assert result.tentative_conflict.status == "Held"
    assert result.hard_conflict is None
    # can_confirm is True: confirmed booking wins over tentative hold
    assert result.can_confirm is True
    # but a normal new request is blocked
    assert result.can_request is False


def test_tc_79_02_only_one_hold_per_venue_slot():
    """AC2: Only one hold per venue/slot; second tentative request is blocked."""
    engine = OverlapEngine()
    existing_hold = [
        {
            "id": "hold-1",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Held",
            "expires_at": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
        }
    ]

    # Another coordinator/staff tries to request or hold the same slot
    result = engine.evaluate(
        "venue-1",
        START,
        START + timedelta(hours=2),
        existing_hold,
    )

    assert result.can_request is False
    assert result.tentative_conflict.booking_id == "hold-1"


def test_tc_79_03_expired_hold_releases_slot_at_exact_expiry_boundary():
    """AC4 & AC6: Boundary test - hold blocks at 1:59pm, but releases at exactly 2:00pm."""
    engine = OverlapEngine()
    exact_expiry = datetime(2099, 10, 15, 14, 0, 0, tzinfo=UTC)  # 2:00pm

    interval = BookingInterval(
        booking_id="hold-boundary",
        venue_id="venue-1",
        start_at=START,
        end_at=START + timedelta(hours=2),
        status="Held",
        expires_at=exact_expiry,
    )

    # 1 second before expiry (1:59:59pm) -> hold is still active and MUST NOT be expired
    assert not interval.is_expired(as_of=exact_expiry - timedelta(seconds=1))

    # At the exact boundary second (2:00:00pm) -> hold is expired
    assert interval.is_expired(as_of=exact_expiry)

    # In engine evaluation: an expired hold does not block new requests
    expired_record = [
        {
            "id": "hold-boundary",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Held",
            "expires_at": (datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
        }
    ]
    result = engine.evaluate("venue-1", START, START + timedelta(hours=2), expired_record)
    assert result.can_request is True
    assert result.tentative_conflict is None


def test_tc_79_04_hold_interval_is_expired_method():
    """Unit test is_expired() on BookingInterval."""
    now = datetime.now(UTC)
    active_interval = BookingInterval(
        booking_id="b-act",
        venue_id="v-1",
        start_at=now + timedelta(days=3),
        end_at=now + timedelta(days=3, hours=2),
        status="Held",
        expires_at=now + timedelta(hours=24),
    )
    assert not active_interval.is_expired()
    assert not active_interval.is_expired(as_of=now + timedelta(hours=23))
    assert active_interval.is_expired(as_of=now + timedelta(hours=25))


# ==============================================================================
# SCRUM-120: Double-booking: tentative hold + FCFS (confirmed beats hold)
# ==============================================================================

def test_tc_120_01_only_one_tentative_hold_per_venue_slot():
    """AC1: Only one tentative hold allowed per slot; concurrent/subsequent hold is blocked."""
    engine = OverlapEngine()
    existing_hold = [
        {
            "id": "hold-first",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Held",
            "requested_at": (datetime.now(UTC) - timedelta(hours=2)).isoformat(),
        }
    ]
    # Another coordinator attempts to request/hold the exact same slot
    result = engine.evaluate(
        "venue-1",
        START,
        START + timedelta(hours=2),
        existing_hold,
    )
    assert result.can_request is False
    assert result.tentative_conflict is not None
    assert result.tentative_conflict.booking_id == "hold-first"


def test_tc_120_02_confirmed_booking_fcfs_beats_tentative_hold():
    """AC2: A confirmed booking (FCFS) beats a tentative hold (S1 Q3, Q17, Q31)."""
    engine = OverlapEngine()
    existing_hold = [
        {
            "id": "hold-existing",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Held",
            "requested_at": (datetime.now(UTC) - timedelta(hours=5)).isoformat(),
        }
    ]
    # When Venue Staff confirms a booking on this slot, it can proceed (can_confirm is True)
    result = engine.evaluate(
        "venue-1",
        START,
        START + timedelta(hours=2),
        existing_hold,
    )
    assert result.can_confirm is True
    assert result.hard_conflict is None
    assert result.tentative_conflict is not None


def test_tc_120_03_blocked_maintenance_period_counts_as_unavailable_for_request_and_confirmation():
    """AC3: Blocked/maintenance periods count as unavailable (hard conflict, no override)."""
    engine = OverlapEngine()
    maintenance_block = [
        {
            "id": "maint-1",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=4)).isoformat(),
            "status": "Blocked",
        }
    ]
    result = engine.evaluate(
        "venue-1",
        START + timedelta(hours=1),
        START + timedelta(hours=3),
        maintenance_block,
    )
    # Neither request nor confirmation is permitted during blocked maintenance
    assert result.can_request is False
    assert result.can_confirm is False
    assert result.hard_conflict is not None
    assert result.hard_conflict.status == "Blocked"
    assert result.hard_conflict.booking_id == "maint-1"


def test_tc_120_04_fcfs_tie_breaker_earliest_requested_at_wins():
    """FCFS ordering: when multiple unconfirmed requests compete, earliest requested_at wins."""
    engine = OverlapEngine()
    t0 = datetime.now(UTC) - timedelta(hours=10)
    t1 = datetime.now(UTC) - timedelta(hours=5)
    t2 = datetime.now(UTC) - timedelta(hours=1)

    # Three competing requests for the same slot
    competing_records = [
        {
            "id": "req-late",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Requested",
            "requested_at": t2.isoformat(),
        },
        {
            "id": "req-early",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Requested",
            "requested_at": t0.isoformat(),
        },
        {
            "id": "req-mid",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Requested",
            "requested_at": t1.isoformat(),
        },
    ]

    result = engine.evaluate(
        "venue-1",
        START,
        START + timedelta(hours=2),
        competing_records,
    )
    # The reported tentative conflict must be the earliest (FCFS winner: req-early)
    assert result.tentative_conflict is not None
    assert result.tentative_conflict.booking_id == "req-early"


def test_tc_120_05_held_status_takes_priority_over_unheld_requested_status():
    """Priority matrix: Confirmed/Blocked (0) > Held (1) > Requested (2)."""
    engine = OverlapEngine()
    t_early = datetime.now(UTC) - timedelta(hours=5)
    t_late = datetime.now(UTC) - timedelta(hours=1)

    # A Requested submitted earlier vs a Held decided later
    records = [
        {
            "id": "req-just-requested",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Requested",
            "requested_at": t_early.isoformat(),
        },
        {
            "id": "hold-promoted",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Held",
            "requested_at": t_late.isoformat(),
        },
    ]

    result = engine.evaluate("venue-1", START, START + timedelta(hours=2), records)
    assert result.tentative_conflict is not None
    assert result.tentative_conflict.booking_id == "hold-promoted"


def test_tc_120_06_confirmed_beats_both_held_and_requested():
    """A confirmed booking takes absolute precedence over all holds and requests."""
    engine = OverlapEngine()
    records = [
        {
            "id": "hold-1",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Held",
        },
        {
            "id": "req-1",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Requested",
        },
        {
            "id": "conf-1",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Confirmed",
        },
    ]

    result = engine.evaluate("venue-1", START, START + timedelta(hours=2), records)
    assert result.hard_conflict is not None
    assert result.hard_conflict.booking_id == "conf-1"
    assert result.can_confirm is False
    assert result.can_request is False


# ==============================================================================
# Full Coverage Boundary & Edge Cases (SCRUM-120 100% Coverage Target)
# ==============================================================================
def test_as_utc_iso_string_with_z_and_timezone_validation():
    """Verify ISO strings ending in Z and rejection of naive datetimes."""
    # String with Z
    dt_z = BookingInterval.from_record({
        "id": "b-z",
        "venue_id": "v-1",
        "start_at": "2099-10-20T10:00:00Z",
        "end_at": "2099-10-20T12:00:00Z",
        "status": "Confirmed",
    })
    assert dt_z.start_at == START

    # String without timezone raises ValueError
    with pytest.raises(ValueError, match="Booking times must include a time zone"):
        BookingInterval.from_record({
            "id": "b-naive",
            "venue_id": "v-1",
            "start_at": "2099-10-20T10:00:00",
            "end_at": "2099-10-20T12:00:00",
            "status": "Confirmed",
        })

    # Datetime without timezone raises ValueError in _as_utc
    with pytest.raises(ValueError, match="Booking times must include a time zone"):
        _as_utc(datetime(2099, 10, 20, 10, 0))


def test_evaluate_rejects_end_time_before_or_equal_start():
    """Booking end time must be strictly after start time."""
    engine = OverlapEngine()

    with pytest.raises(ValueError, match="Booking end time must be strictly after start time"):
        engine.evaluate("venue-1", START, START, [])

    with pytest.raises(ValueError, match="Booking end time must be strictly after start time"):
        engine.evaluate("venue-1", START, START - timedelta(hours=1), [])


def test_evaluate_filters_unrecognized_booking_status():
    """Bookings with unrecognized status (neither hard nor tentative) are ignored."""
    engine = OverlapEngine()
    records = [
        {
            "id": "ignored-1",
            "venue_id": "venue-1",
            "start_at": START.isoformat(),
            "end_at": (START + timedelta(hours=2)).isoformat(),
            "status": "Draft",  # Not in HARD_STATUSES or TENTATIVE_STATUSES
        }
    ]

    result = engine.evaluate("venue-1", START, START + timedelta(hours=2), records)
    assert result.can_request is True
    assert result.can_confirm is True
    assert result.hard_conflict is None
    assert result.tentative_conflict is None


def test_highest_priority_empty_list_returns_none():
    """_highest_priority returns None when given an empty list."""
    assert _highest_priority([]) is None


def test_identify_problematic_bookings_unconflicted_and_no_conflicts():
    """Branches where bookings already conflicted raw or where no conflicts exist."""
    engine = OverlapEngine()

    # Case 1: Already conflicted under raw times -> not flagged as new problem
    rec_overlapping_raw_1 = {
        "id": "raw-1",
        "venue_id": "v-1",
        "start_at": START.isoformat(),
        "end_at": (START + timedelta(hours=2)).isoformat(),
        "status": "Confirmed",
    }
    rec_overlapping_raw_2 = {
        "id": "raw-2",
        "venue_id": "v-1",
        "start_at": (START + timedelta(hours=1)).isoformat(),
        "end_at": (START + timedelta(hours=3)).isoformat(),
        "status": "Confirmed",
    }
    res_raw = engine.identify_problematic_bookings(
        "v-1",
        [rec_overlapping_raw_1, rec_overlapping_raw_2],
        setup_minutes=30,
        turnaround_minutes=30,
    )
    assert res_raw == []

    # Case 2: Far apart bookings -> does_conflict_buffered is False
    rec_far_1 = {
        "id": "far-1",
        "venue_id": "v-1",
        "start_at": START.isoformat(),
        "end_at": (START + timedelta(hours=2)).isoformat(),
        "status": "Confirmed",
    }
    rec_far_2 = {
        "id": "far-2",
        "venue_id": "v-1",
        "start_at": (START + timedelta(days=2)).isoformat(),
        "end_at": (START + timedelta(days=2, hours=2)).isoformat(),
        "status": "Confirmed",
    }
    res_far = engine.identify_problematic_bookings(
        "v-1", [rec_far_1, rec_far_2], setup_minutes=30, turnaround_minutes=30
    )
    assert res_far == []


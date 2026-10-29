"""Sprint 1–3 rule regressions: invalid input, independent resources and boundaries.

These exercise the real value objects without HTTP or persistence. Cross-layer
confirmation readiness and multi-booking writes still require acceptance tests.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.equipment_availability import EquipmentAvailabilityEngine
from app.event_confirmation import EventConfirmation
from app.safety_decision import SafetyDecision
from app.venue_overlap import OverlapEngine
from app.venue_suitability import (
    AccessibilityRule,
    FacilityRule,
    LayoutRule,
    find_requested,
    near_miss_hints,
)
from app.venue_validation import DAYS, validate_venue

START = datetime(2099, 10, 20, 10, tzinfo=UTC)
END = START + timedelta(hours=1)


@pytest.mark.parametrize("records", [None, {}, "Confirmed"])
def test_confirmation_requires_a_booking_collection(records):
    """SCRUM-39: malformed lookup data must not grant confirmation."""
    with pytest.raises(ValueError, match="list"):
        EventConfirmation.from_bookings(records)


@pytest.mark.parametrize("record", [{}, {"status": None}, {"status": "  "}, None])
def test_unreadable_booking_blocks_even_with_an_approved_venue(record):
    gate = EventConfirmation.from_bookings([{"status": "Confirmed"}, record])
    assert not gate.can_confirm
    assert any("awaiting approval" in reason for reason in gate.outstanding)


@pytest.mark.parametrize("action,expected", [
    ("approve", False), ("reject", True), ("request_changes", True),
])
def test_safety_send_back_classification_matches_the_decision(action, expected):
    """SCRUM-128: only approval permits proceeding instead of re-planning."""
    decision = SafetyDecision(action, reason="Emergency access needs review")
    assert decision.returns_to_planning is expected
    assert (decision.status == "Planning") is expected


def equipment():
    return {"id": "projector", "total_quantity": 5, "operational_status": "Operational"}


def test_equipment_edit_excludes_its_own_reservation_but_counts_other_events():
    """SCRUM-36/37: editing a reservation must not count its own units twice."""
    reservations = [
        {"id": name, "equipment_id": "projector", "quantity": quantity,
         "status": "Reserved", "start_at": START, "end_at": END}
        for name, quantity in [("self", 3), ("other", 2)]
    ]
    result = EquipmentAvailabilityEngine().check_availability(
        equipment(), START, END, reservations, requested_quantity=3,
        exclude_reservation_id="self",
    )
    assert result.is_operational
    assert result.reserved_quantity == 2
    assert result.available_quantity == 3
    assert result.overlapping_reservations_count == 1
    assert result.is_sufficient


def test_negative_equipment_query_quantity_is_rejected():
    with pytest.raises(ValueError, match="non-negative"):
        EquipmentAvailabilityEngine().check_availability(
            equipment(), START, END, [], requested_quantity=-1,
        )


@pytest.mark.parametrize("start,end", [
    (START, START), (END, START), (START.replace(tzinfo=None), END),
])
def test_invalid_venue_query_cannot_be_reported_as_available(start, end):
    """SCRUM-33: reject zero/reversed windows and ambiguous local times."""
    with pytest.raises(ValueError):
        OverlapEngine().evaluate("hall", start, end, [])


def test_venue_conflicts_ignore_self_other_venues_and_cancelled_bookings():
    records = [
        {"id": key, "venue_id": venue, "status": status,
         "start_at": START, "end_at": END}
        for key, venue, status in [
            ("self", "hall", "Confirmed"), ("other", "room", "Confirmed"),
            ("cancelled", "hall", "Cancelled"),
        ]
    ]
    result = OverlapEngine().evaluate(
        "hall", START, END, records, exclude_booking_id="self",
    )
    assert result.can_request
    assert result.hard_conflict is None
    assert result.tentative_conflict is None


@pytest.mark.parametrize("offset", [timedelta(minutes=30), timedelta(hours=5)])
def test_buffer_review_does_not_flag_existing_overlaps_or_distant_bookings(offset):
    """Only newly introduced buffer conflicts belong in the migration warning list."""
    records = [
        {"id": key, "venue_id": "hall", "status": "Confirmed",
         "start_at": START + shift, "end_at": END + shift}
        for key, shift in [("a", timedelta()), ("b", offset)]
    ]
    assert OverlapEngine().identify_problematic_bookings("hall", records, 10, 10) == []


@pytest.mark.parametrize("rule,field", [
    (LayoutRule, "venue_requirements"),
    (FacilityRule, "equipment_requirements"),
    (AccessibilityRule, "accessibility_requirements"),
])
def test_absent_requirements_do_not_invent_suitability_warnings(rule, field):
    assert rule().evaluate({field: "  "}, {}) is None


@pytest.mark.parametrize("canonical,request_text,expected", [
    ("", "projector", (False, None)),
    ("projector", "projectors", (True, None)),
    ("projector", "projrctor", (False, "Did you mean 'Projector'?")),
    ("projector", "a stage", (False, None)),
    ("sound system", "sound", (False, None)),
])
def test_requested_features_distinguish_variants_typos_and_unrelated_text(
    canonical, request_text, expected,
):
    """SCRUM-29: spelling hints must not silently become confirmed requirements."""
    assert find_requested(canonical, request_text) == expected


def test_suitability_hints_are_unique_and_ignore_short_or_multiword_candidates():
    assert near_miss_hints(
        "projrctor projrctor and sound", ["projector", "projector", "sound system", "wifi"],
    ) == ["'projrctor' -> Did you mean 'Projector'?"]


@pytest.mark.parametrize("value,valid,normalised", [
    (None, True, 0), (0, True, 0), (1440, True, 1440),
    (-1, False, None), (1441, False, None), (True, False, None), ("30", False, None),
])
@pytest.mark.parametrize("field", ["setup_time_minutes", "turnaround_time_minutes"])
def test_venue_buffer_validation_preserves_integer_bounds(field, value, valid, normalised):
    """Shared venue validation: explicit null defaults; invalid values are not coerced."""
    data = {
        "name": "Hall", "location": "Campus", "capacity": 100,
        "facilities": [], "accessibility": [], "supported_layouts": ["Theatre"],
        "operating_hours": {day: {"opens": "09:00", "closes": "18:00"} for day in DAYS},
        field: value,
    }
    clean, errors = validate_venue(data)
    if valid:
        assert errors == {}
        assert clean[field] == normalised
    else:
        assert field in errors
        assert field not in clean

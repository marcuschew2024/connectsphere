"""SCRUM-36 unit tests for Equipment Availability Engine and OOP policies.

Acceptance Criteria:
- AC1: For a given date/time and quantity, the system shows how many units are available
       (total minus reserved for overlapping events minus unavailable).
- AC2: Equipment committed to an overlapping incompatible event is not counted as available.
- AC3: Given 5 projectors all reserved for an overlapping event, availability shows 0.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.equipment_availability import EquipmentAvailabilityEngine

START = datetime(2099, 10, 20, 10, 0, tzinfo=UTC)
END = START + timedelta(hours=2)  # 10:00 to 12:00


def sample_equipment(
    equipment_id="eq-1",
    total_quantity=5,
    operational_status="Operational",
    equipment_type="Projector",
):
    return {
        "id": equipment_id,
        "equipment_type": equipment_type,
        "total_quantity": total_quantity,
        "operational_status": operational_status,
        "usable_quantity": total_quantity if operational_status == "Operational" else 0,
        "location": "Store Room A",
    }


def sample_reservation(
    equipment_id="eq-1",
    quantity=2,
    start_at=START,
    end_at=END,
    status="Reserved",
    reservation_id="res-1",
):
    return {
        "id": reservation_id,
        "equipment_id": equipment_id,
        "quantity": quantity,
        "start_at": start_at.isoformat(),
        "end_at": end_at.isoformat(),
        "status": status,
    }


# ==============================================================================
# Unit Tests: AC1 - Exact Stock & Available Calculation Formula
# ==============================================================================
def test_availability_calculation_formula_no_reservations():
    """Formula: Available = Total (5) - Overlapping (0) - Unavailable (0) = 5."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment(total_quantity=10)

    result = engine.check_availability(eq, START, END, [], requested_quantity=4)

    assert result.total_quantity == 10
    assert result.usable_quantity == 10
    assert result.reserved_quantity == 0
    assert result.available_quantity == 10
    assert result.is_sufficient is True
    assert result.overlapping_reservations_count == 0


def test_availability_calculation_with_overlapping_reservations():
    """Formula: Available = Total (10) - Reserved (3) = 7."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment(total_quantity=10)
    reservations = [sample_reservation(quantity=3)]

    result = engine.check_availability(eq, START, END, reservations, requested_quantity=7)

    assert result.total_quantity == 10
    assert result.reserved_quantity == 3
    assert result.available_quantity == 7
    assert result.is_sufficient is True


def test_availability_insufficient_quantity():
    """When requested exceeds available quantity, is_sufficient is False."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment(total_quantity=5)
    reservations = [sample_reservation(quantity=3)]

    result = engine.check_availability(eq, START, END, reservations, requested_quantity=3)

    assert result.available_quantity == 2
    assert result.is_sufficient is False


# ==============================================================================
# Unit Tests: AC2 - Overlap Rules & Incompatible Events
# ==============================================================================
def test_overlapping_incompatible_event_not_counted_as_available():
    """Reservations during an overlapping window commit stock."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment(total_quantity=8)
    # Event overlapping from 09:30 to 10:30 (overlaps with 10:00 - 12:00)
    overlap_res = sample_reservation(
        quantity=4,
        start_at=START - timedelta(minutes=30),
        end_at=START + timedelta(minutes=30),
    )

    result = engine.check_availability(eq, START, END, [overlap_res])

    assert result.reserved_quantity == 4
    assert result.available_quantity == 4


def test_touching_boundary_slots_do_not_overlap():
    """Half-open intervals [start, end): reservation touching endpoints is compatible."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment(total_quantity=5)
    # Adjacent earlier: 08:00 to 10:00
    earlier_res = sample_reservation(
        quantity=5,
        start_at=START - timedelta(hours=2),
        end_at=START,
        reservation_id="res-early",
    )
    # Adjacent later: 12:00 to 14:00
    later_res = sample_reservation(
        quantity=5,
        start_at=END,
        end_at=END + timedelta(hours=2),
        reservation_id="res-late",
    )

    result = engine.check_availability(eq, START, END, [earlier_res, later_res])

    assert result.reserved_quantity == 0
    assert result.available_quantity == 5
    assert result.overlapping_reservations_count == 0


def test_cancelled_or_released_reservations_do_not_commit_stock():
    """Released or Cancelled reservations should not reduce available stock."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment(total_quantity=5)
    cancelled_res = sample_reservation(quantity=3, status="Cancelled")
    released_res = sample_reservation(quantity=2, status="Released")

    result = engine.check_availability(eq, START, END, [cancelled_res, released_res])

    assert result.reserved_quantity == 0
    assert result.available_quantity == 5


def test_different_equipment_reservations_ignored():
    """Reservations for other equipment items are not counted."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment(equipment_id="eq-1", total_quantity=5)
    other_eq_res = sample_reservation(equipment_id="eq-other", quantity=5)

    result = engine.check_availability(eq, START, END, [other_eq_res])

    assert result.reserved_quantity == 0
    assert result.available_quantity == 5


# ==============================================================================
# Unit Tests: AC3 - Given 5 projectors all reserved, availability shows 0
# ==============================================================================
def test_ac3_given_5_projectors_all_reserved_availability_shows_zero():
    """AC3: 5 projectors total, 5 reserved for overlapping event -> 0 available."""
    engine = EquipmentAvailabilityEngine()
    projectors = sample_equipment(
        equipment_id="proj-1", equipment_type="Projector", total_quantity=5
    )
    overlapping_res = sample_reservation(
        equipment_id="proj-1",
        quantity=5,
        start_at=START,
        end_at=END,
        reservation_id="res-projectors",
    )

    result = engine.check_availability(
        projectors, START, END, [overlapping_res], requested_quantity=1
    )

    assert result.equipment_type == "Projector"
    assert result.total_quantity == 5
    assert result.reserved_quantity == 5
    assert result.available_quantity == 0
    assert result.is_sufficient is False
    assert result.overlapping_reservations_count == 1


# ==============================================================================
# Unit Tests: Operational Status / Unavailable Units
# ==============================================================================
def test_damaged_equipment_shows_zero_availability():
    """Damaged equipment has usable_quantity = 0 and available_quantity = 0."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment(total_quantity=5, operational_status="Damaged")

    result = engine.check_availability(eq, START, END, [])

    assert result.usable_quantity == 0
    assert result.available_quantity == 0
    assert result.is_sufficient is False


def test_under_maintenance_equipment_shows_zero_availability():
    """Under Maintenance equipment has usable_quantity = 0 and available_quantity = 0."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment(total_quantity=10, operational_status="Under Maintenance")

    result = engine.check_availability(eq, START, END, [])

    assert result.usable_quantity == 0
    assert result.available_quantity == 0
    assert result.is_sufficient is False


# ==============================================================================
# Unit Tests: Boundary & Error Handling
# ==============================================================================
def test_invalid_time_window_raises_value_error():
    """End time before or equal to start time raises ValueError."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment()

    with pytest.raises(ValueError, match="Query end time must be strictly after start time"):
        engine.check_availability(eq, END, START, [])


def test_naive_datetime_raises_value_error():
    """Time without timezone raises ValueError."""
    engine = EquipmentAvailabilityEngine()
    eq = sample_equipment()
    naive_dt = datetime(2099, 10, 20, 10, 0)

    with pytest.raises(ValueError, match="must include a time zone"):
        engine.check_availability(eq, naive_dt, END, [])


# ==============================================================================
# SCRUM-37 Unit Tests: Reservation Policy & Decisions (OOP)
# ==============================================================================
def test_scrum37_reserve_available_equipment_permitted():
    """AC1: Reserving available equipment within capacity succeeds."""
    from app.equipment_availability import EquipmentReservationEngine

    engine = EquipmentReservationEngine()
    eq = sample_equipment(total_quantity=10, operational_status="Operational")

    decision = engine.evaluate_reservation(
        equipment=eq,
        start_at=START,
        end_at=END,
        requested_quantity=4,
        existing_reservations=[],
    )

    assert decision.is_allowed is True
    assert decision.available_quantity == 10
    assert decision.reason is None


def test_scrum37_over_reservation_blocked():
    """AC2: Over-reservation beyond available stock is blocked."""
    from app.equipment_availability import EquipmentReservationEngine

    engine = EquipmentReservationEngine()
    eq = sample_equipment(total_quantity=5, operational_status="Operational")
    # 3 units already reserved in this slot
    existing = [sample_reservation(quantity=3)]

    # Trying to reserve 3 more when only 2 remain
    decision = engine.evaluate_reservation(
        equipment=eq,
        start_at=START,
        end_at=END,
        requested_quantity=3,
        existing_reservations=existing,
    )

    assert decision.is_allowed is False
    assert decision.available_quantity == 2
    assert "Cannot reserve 3 unit(s)" in decision.reason


def test_scrum37_damaged_or_maintenance_cannot_be_reserved():
    """AC1: Damaged or Under Maintenance equipment cannot be reserved."""
    from app.equipment_availability import EquipmentReservationEngine

    engine = EquipmentReservationEngine()
    damaged = sample_equipment(total_quantity=5, operational_status="Damaged")
    maintenance = sample_equipment(total_quantity=5, operational_status="Under Maintenance")

    d1 = engine.evaluate_reservation(damaged, START, END, 1, [])
    assert d1.is_allowed is False
    assert "currently Damaged" in d1.reason

    d2 = engine.evaluate_reservation(maintenance, START, END, 1, [])
    assert d2.is_allowed is False
    assert "currently Under Maintenance" in d2.reason


def test_scrum37_invalid_quantities_rejected():
    """Zero or negative requested quantities are denied."""
    from app.equipment_availability import EquipmentReservationEngine

    engine = EquipmentReservationEngine()
    eq = sample_equipment(total_quantity=5)

    d_zero = engine.evaluate_reservation(eq, START, END, 0, [])
    assert d_zero.is_allowed is False
    assert "at least 1" in d_zero.reason

    d_neg = engine.evaluate_reservation(eq, START, END, -2, [])
    assert d_neg.is_allowed is False


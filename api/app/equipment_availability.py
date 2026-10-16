"""SCRUM-36: OOP reusable equipment availability and overlap policy.

Adheres to:
1. Pure domain engine with zero database dependencies.
2. Reusable half-open interval overlap policy matching OverlapEngine (SCRUM-33).
3. Formula: Available = Total Quantity - Overlapping Reservations - Unavailable Units.
4. If an item is Damaged or Under Maintenance, usable stock is 0, so availability is 0.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


def _as_utc(value: str | datetime) -> datetime:
    """Ensure datetime has timezone and is converted to UTC."""
    if isinstance(value, str):
        # Support trailing 'Z' if present
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        value = datetime.fromisoformat(value)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Reservation and query times must include a time zone.")
    return value.astimezone(UTC)


@dataclass(frozen=True)
class EquipmentReservationInterval:
    """Value object representing an active equipment reservation window."""

    reservation_id: str | None
    equipment_id: str
    quantity: int
    start_at: datetime
    end_at: datetime
    status: str

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "EquipmentReservationInterval":
        return cls(
            reservation_id=record.get("id"),
            equipment_id=str(record["equipment_id"]),
            quantity=int(record.get("quantity", 0)),
            start_at=_as_utc(record["start_at"]),
            end_at=_as_utc(record["end_at"]),
            status=str(record.get("status", "Reserved")),
        )

    def overlaps(self, start_at: datetime, end_at: datetime) -> bool:
        """Half-open intervals [start, end): touching endpoints are compatible."""
        return self.start_at < end_at and start_at < self.end_at


@dataclass(frozen=True)
class EquipmentAvailabilityResult:
    """Availability calculation result for an equipment item over a time window."""

    equipment_id: str
    equipment_type: str
    total_quantity: int
    operational_status: str
    usable_quantity: int
    reserved_quantity: int
    available_quantity: int
    is_sufficient: bool
    overlapping_reservations_count: int

    @property
    def is_operational(self) -> bool:
        return self.operational_status == "Operational"


class AvailabilityCalculator(ABC):
    """Abstract strategy for computing resource availability."""

    @abstractmethod
    def check_availability(
        self,
        equipment: dict[str, Any],
        start_at: str | datetime,
        end_at: str | datetime,
        reservations: list[dict[str, Any]],
        *,
        requested_quantity: int = 1,
        exclude_reservation_id: str | None = None,
    ) -> EquipmentAvailabilityResult:
        """Compute available units for an item across the requested time window."""
        pass  # pragma: no cover


class EquipmentAvailabilityEngine(AvailabilityCalculator):
    """OOP availability engine reusing overlap mechanics.

    Rules:
    - Active statuses that commit stock: 'Reserved', 'Pending'.
      ('Released' and 'Cancelled' do not commit stock).
    - If operational_status != 'Operational', usable_quantity is 0,
      so available_quantity is 0 regardless of reservations.
    - Otherwise, total minus overlapping reserved quantity minus unavailable units (0).
    - Available quantity cannot drop below 0.
    - is_sufficient is True if available_quantity >= requested_quantity.
    """

    COMMITTED_STATUSES = frozenset({"Reserved", "Pending"})

    def check_availability(
        self,
        equipment: dict[str, Any],
        start_at: str | datetime,
        end_at: str | datetime,
        reservations: list[dict[str, Any]],
        *,
        requested_quantity: int = 1,
        exclude_reservation_id: str | None = None,
    ) -> EquipmentAvailabilityResult:
        start = _as_utc(start_at)
        end = _as_utc(end_at)
        if end <= start:
            raise ValueError("Query end time must be strictly after start time.")
        if requested_quantity < 0:
            raise ValueError("Requested quantity must be non-negative.")

        eq_id = str(equipment.get("id", ""))
        eq_type = str(equipment.get("equipment_type", ""))
        total_quantity = int(equipment.get("total_quantity", 0))
        operational_status = str(equipment.get("operational_status", "Operational"))

        # Base usable stock (SCRUM-34 computed usable stock)
        usable_stock = total_quantity if operational_status == "Operational" else 0

        # Filter and sum overlapping active reservations for this equipment
        overlapping_count = 0
        total_reserved = 0

        for record in reservations:
            if record.get("id") == exclude_reservation_id:
                continue
            if str(record.get("equipment_id")) != eq_id:
                continue
            if record.get("status") not in self.COMMITTED_STATUSES:
                continue

            interval = EquipmentReservationInterval.from_record(record)
            if interval.overlaps(start, end):
                overlapping_count += 1
                total_reserved += interval.quantity

        if operational_status != "Operational":
            available = 0
        else:
            available = max(0, total_quantity - total_reserved)

        return EquipmentAvailabilityResult(
            equipment_id=eq_id,
            equipment_type=eq_type,
            total_quantity=total_quantity,
            operational_status=operational_status,
            usable_quantity=usable_stock,
            reserved_quantity=total_reserved,
            available_quantity=available,
            is_sufficient=available >= requested_quantity,
            overlapping_reservations_count=overlapping_count,
        )


@dataclass(frozen=True)
class ReservationDecision:
    """Immutable value object representing the outcome of a reservation attempt (SCRUM-37)."""

    is_allowed: bool
    equipment_id: str
    requested_quantity: int
    available_quantity: int
    reason: str | None = None

    @classmethod
    def permit(
        cls, equipment_id: str, requested_quantity: int, available_quantity: int
    ) -> "ReservationDecision":
        return cls(
            is_allowed=True,
            equipment_id=equipment_id,
            requested_quantity=requested_quantity,
            available_quantity=available_quantity,
            reason=None,
        )

    @classmethod
    def deny(
        cls, equipment_id: str, requested_quantity: int, available_quantity: int, reason: str
    ) -> "ReservationDecision":
        return cls(
            is_allowed=False,
            equipment_id=equipment_id,
            requested_quantity=requested_quantity,
            available_quantity=available_quantity,
            reason=reason,
        )


class ReservationPolicy(ABC):
    """Abstract strategy interface for validating and creating equipment reservations."""

    @abstractmethod
    def evaluate_reservation(
        self,
        equipment: dict[str, Any],
        start_at: str | datetime,
        end_at: str | datetime,
        requested_quantity: int,
        existing_reservations: list[dict[str, Any]],
        *,
        exclude_reservation_id: str | None = None,
    ) -> ReservationDecision:
        """Evaluate if reserving the requested units violates stock, condition or overlaps."""
        pass  # pragma: no cover


class EquipmentReservationEngine(ReservationPolicy):
    """SCRUM-37 OOP reservation policy reusing the SCRUM-36 availability engine.

    Rules:
    1. Only available equipment (not Damaged or Under Maintenance) can be reserved.
    2. Reserving reduces available quantity; over-reservation beyond available stock is blocked.
    3. Positive quantity check (quantity > 0).
    4. Valid time window check (end_at > start_at).
    """

    def __init__(self, availability_calculator: AvailabilityCalculator | None = None):
        self._calculator = availability_calculator or EquipmentAvailabilityEngine()

    def evaluate_reservation(
        self,
        equipment: dict[str, Any],
        start_at: str | datetime,
        end_at: str | datetime,
        requested_quantity: int,
        existing_reservations: list[dict[str, Any]],
        *,
        exclude_reservation_id: str | None = None,
    ) -> ReservationDecision:
        eq_id = str(equipment.get("id", ""))
        eq_status = str(equipment.get("operational_status", "Operational"))

        if requested_quantity <= 0:
            return ReservationDecision.deny(
                eq_id, requested_quantity, 0, "Requested quantity must be at least 1."
            )

        if eq_status != "Operational":
            return ReservationDecision.deny(
                eq_id,
                requested_quantity,
                0,
                f"Equipment cannot be reserved because it is currently {eq_status}.",
            )

        availability = self._calculator.check_availability(
            equipment,
            start_at,
            end_at,
            existing_reservations,
            requested_quantity=requested_quantity,
            exclude_reservation_id=exclude_reservation_id,
        )

        if not availability.is_sufficient:
            return ReservationDecision.deny(
                eq_id,
                requested_quantity,
                availability.available_quantity,
                f"Cannot reserve {requested_quantity} unit(s). "
                f"Only {availability.available_quantity} available for the selected time slot.",
            )

        return ReservationDecision.permit(
            eq_id, requested_quantity, availability.available_quantity
        )


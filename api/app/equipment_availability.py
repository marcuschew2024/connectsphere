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

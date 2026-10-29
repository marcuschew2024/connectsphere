"""SCRUM-33 + SCRUM-129: reusable venue booking overlap and buffer domain model.

Adheres to:
1. Pure domain engine with zero database dependencies.
2. Configurable venue setup and turnaround time (SCRUM-129 / Week 7 Change #1).
3. Published slot [start_at, end_at) expands to occupied window:
   [start_at - setup_time, end_at + turnaround_time).
4. Back-to-back published bookings conflict if their buffer windows overlap.
5. Existing bookings that become conflicting under the new buffer rule are identified.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any


def _as_utc(value: str | datetime) -> datetime:
    """Ensure datetime has timezone and is converted to UTC."""
    if isinstance(value, str):
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        value = datetime.fromisoformat(value)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Booking times must include a time zone.")
    return value.astimezone(UTC)


@dataclass(frozen=True)
class BookingInterval:
    """A venue booking interval with buffer-occupied windows (SCRUM-129 + SCRUM-79)."""

    booking_id: str | None
    venue_id: str
    start_at: datetime
    end_at: datetime
    status: str
    setup_minutes: int = 0
    turnaround_minutes: int = 0
    expires_at: datetime | None = None

    @classmethod
    def from_record(
        cls,
        record: dict[str, Any],
        setup_minutes: int = 0,
        turnaround_minutes: int = 0,
    ) -> "BookingInterval":
        # If record has its own buffer or venue buffer attached, prefer it
        setup = int(record.get("setup_minutes", setup_minutes) or 0)
        turnaround = int(record.get("turnaround_minutes", turnaround_minutes) or 0)
        expires = record.get("expires_at")
        return cls(
            booking_id=record.get("id"),
            venue_id=str(record["venue_id"]),
            start_at=_as_utc(record["start_at"]),
            end_at=_as_utc(record["end_at"]),
            status=str(record["status"]),
            setup_minutes=max(0, setup),
            turnaround_minutes=max(0, turnaround),
            expires_at=_as_utc(expires) if expires else None,
        )

    def is_expired(self, as_of: datetime | None = None) -> bool:
        """SCRUM-79: A hold with expires_at <= as_of is expired and releases its slot."""
        if not self.expires_at:
            return False
        current = as_of or datetime.now(UTC)
        return current >= self.expires_at

    @property
    def occupied_start(self) -> datetime:
        """Start of physical room occupation, including setup time."""
        return self.start_at - timedelta(minutes=self.setup_minutes)

    @property
    def occupied_end(self) -> datetime:
        """End of physical room occupation, including turnaround reset time."""
        return self.end_at + timedelta(minutes=self.turnaround_minutes)

    def overlaps_published(self, start_at: datetime, end_at: datetime) -> bool:
        """Check raw published interval overlap: [start, end)."""
        return self.start_at < end_at and start_at < self.end_at

    def overlaps(
        self,
        query_start: datetime,
        query_end: datetime,
        *,
        query_setup_minutes: int = 0,
        query_turnaround_minutes: int = 0,
    ) -> bool:
        """Check buffer-aware overlap using half-open intervals [occupied_start, occupied_end).

        Touching endpoints are compatible:
        Booking A occupied_end == Booking B occupied_start does NOT conflict.
        """
        q_start = query_start - timedelta(minutes=max(0, query_setup_minutes))
        q_end = query_end + timedelta(minutes=max(0, query_turnaround_minutes))
        return self.occupied_start < q_end and q_start < self.occupied_end


@dataclass(frozen=True)
class OverlapResult:
    """Classification of a requested slot against existing bookings."""

    hard_conflict: BookingInterval | None = None
    tentative_conflict: BookingInterval | None = None
    problematic_existing: tuple[BookingInterval, ...] = ()

    @property
    def can_request(self) -> bool:
        return self.hard_conflict is None and self.tentative_conflict is None

    @property
    def can_confirm(self) -> bool:
        """A confirmed decision wins over a tentative hold, but never hard conflicts."""
        return self.hard_conflict is None


class OverlapEngine:
    """Apply published-slot and buffer-extended overlap policy (SCRUM-33 + SCRUM-129).

    Confirmed and maintenance-blocked periods are hard conflicts.
    Requested/Pending rows are tentative holds.
    """

    HARD_STATUSES = frozenset({"Confirmed", "Blocked"})
    TENTATIVE_STATUSES = frozenset({"Requested", "Pending", "Held"})

    def evaluate(
        self,
        venue_id: str,
        start_at: str | datetime,
        end_at: str | datetime,
        bookings: list[dict[str, Any]],
        *,
        exclude_booking_id: str | None = None,
        setup_minutes: int = 0,
        turnaround_minutes: int = 0,
    ) -> OverlapResult:
        start = _as_utc(start_at)
        end = _as_utc(end_at)
        if end <= start:
            raise ValueError("Booking end time must be strictly after start time.")

        hard: list[BookingInterval] = []
        tentative: list[BookingInterval] = []

        for record in bookings:
            if (
                record.get("id") == exclude_booking_id
                or str(record.get("venue_id")) != str(venue_id)
            ):
                continue
            if record.get("status") not in self.HARD_STATUSES | self.TENTATIVE_STATUSES:
                continue

            interval = BookingInterval.from_record(
                record,
                setup_minutes=setup_minutes,
                turnaround_minutes=turnaround_minutes,
            )

            # SCRUM-79: An expired hold is not treated as active/confirmed and does not block
            if interval.is_expired():
                continue

            # Check if this interval overlaps considering setup and turnaround buffers
            if not interval.overlaps(
                start,
                end,
                query_setup_minutes=setup_minutes,
                query_turnaround_minutes=turnaround_minutes,
            ):
                continue

            if interval.status in self.HARD_STATUSES:
                hard.append(interval)
            else:
                tentative.append(interval)

        return OverlapResult(
            hard_conflict=_highest_priority(hard),
            tentative_conflict=_highest_priority(tentative),
        )

    def identify_problematic_bookings(
        self,
        venue_id: str,
        bookings: list[dict[str, Any]],
        setup_minutes: int,
        turnaround_minutes: int,
    ) -> list[dict[str, Any]]:
        """Identify existing bookings that became newly conflicting under the buffer rule.

        Acceptance criterion 3: Existing bookings that become conflicting under the new rule
        must be IDENTIFIED/flagged, rather than silently removed or mutated.
        """
        active_records = [
            b for b in bookings
            if str(b.get("venue_id")) == str(venue_id)
            and b.get("status") in (self.HARD_STATUSES | self.TENTATIVE_STATUSES)
        ]

        problematic: list[dict[str, Any]] = []

        for i, rec_a in enumerate(active_records):
            int_a_raw = BookingInterval.from_record(rec_a, 0, 0)
            int_a_buf = BookingInterval.from_record(rec_a, setup_minutes, turnaround_minutes)

            conflicts_with: list[dict[str, Any]] = []

            for j, rec_b in enumerate(active_records):
                if i == j:
                    continue
                int_b_raw = BookingInterval.from_record(rec_b, 0, 0)

                # Check if they did NOT conflict previously under raw times
                did_conflict_raw = int_a_raw.overlaps_published(
                    int_b_raw.start_at, int_b_raw.end_at
                )
                # But DO conflict now under the new buffer rule
                does_conflict_buffered = int_a_buf.overlaps(
                    int_b_raw.start_at,
                    int_b_raw.end_at,
                    query_setup_minutes=setup_minutes,
                    query_turnaround_minutes=turnaround_minutes,
                )

                if not did_conflict_raw and does_conflict_buffered:
                    conflicts_with.append(rec_b)

            if conflicts_with:
                problematic.append({
                    "booking": rec_a,
                    "conflicts_with": conflicts_with,
                    "reason": (
                        f"Booking occupies {int_a_buf.occupied_start.isoformat()} to "
                        f"{int_a_buf.occupied_end.isoformat()} with buffers, conflicting with "
                        f"{len(conflicts_with)} existing booking(s)."
                    ),
                })

        return problematic


def _highest_priority(bookings: list[BookingInterval]) -> BookingInterval | None:
    if not bookings:
        return None
    return sorted(
        bookings, key=lambda booking: (booking.status != "Confirmed", booking.start_at)
    )[0]

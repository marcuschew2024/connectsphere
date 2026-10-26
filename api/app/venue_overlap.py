"""SCRUM-33: reusable venue booking overlap domain model."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


@dataclass(frozen=True)
class BookingInterval:
    """A published venue interval used by the overlap policy."""

    booking_id: str | None
    venue_id: str
    start_at: datetime
    end_at: datetime
    status: str

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> "BookingInterval":
        return cls(
            booking_id=record.get("id"),
            venue_id=record["venue_id"],
            start_at=_as_utc(record["start_at"]),
            end_at=_as_utc(record["end_at"]),
            status=record["status"],
        )

    def overlaps(self, start_at: datetime, end_at: datetime) -> bool:
        """Return True only when this interval and ``[start_at, end_at)`` truly overlap.

        Both bookings are treated as **half-open** intervals ``[start, end)``: the start
        instant belongs to the booking, the end instant does not. Two intervals conflict
        iff ``existing.start < new.end AND new.start < existing.end``. The consequence is
        that **touching endpoints are compatible** — a booking ending at exactly 10:00 and
        another starting at exactly 10:00 do *not* overlap, so **back-to-back bookings are
        allowed** while any real overlap is rejected.

        This is the boundary case that is easy to get wrong: using closed intervals (``<=``)
        would reject legitimate back-to-back bookings, and a naive ``start < end`` check
        across the wrong pair of endpoints would let a real overlap slip through. The two
        strict ``<`` comparisons against the opposite endpoints are deliberate — do not
        "simplify" them to ``<=``.
        """
        return self.start_at < end_at and start_at < self.end_at


@dataclass(frozen=True)
class OverlapResult:
    """Classification of a requested slot against existing bookings."""

    hard_conflict: BookingInterval | None = None
    tentative_conflict: BookingInterval | None = None

    @property
    def can_request(self) -> bool:
        return self.hard_conflict is None and self.tentative_conflict is None

    @property
    def can_confirm(self) -> bool:
        """A confirmed decision wins over a tentative hold, but never hard conflicts."""
        return self.hard_conflict is None


class OverlapEngine:
    """Apply the SCRUM-33 published-slot and status-precedence policy.

    No setup or turnaround buffer is added. Confirmed and maintenance-blocked periods
    are hard conflicts. Requested/Pending rows are one tentative hold and only prevent
    another request; they do not defeat a later confirmed decision.
    """

    HARD_STATUSES = frozenset({"Confirmed", "Blocked"})
    TENTATIVE_STATUSES = frozenset({"Requested", "Pending"})

    def evaluate(
        self,
        venue_id: str,
        start_at: str | datetime,
        end_at: str | datetime,
        bookings: list[dict[str, Any]],
        *,
        exclude_booking_id: str | None = None,
    ) -> OverlapResult:
        start = _as_utc(start_at)
        end = _as_utc(end_at)
        hard: list[BookingInterval] = []
        tentative: list[BookingInterval] = []

        for record in bookings:
            if record.get("id") == exclude_booking_id or record.get("venue_id") != venue_id:
                continue
            if record.get("status") not in self.HARD_STATUSES | self.TENTATIVE_STATUSES:
                continue
            interval = BookingInterval.from_record(record)
            if not interval.overlaps(start, end):
                continue
            if interval.status in self.HARD_STATUSES:
                hard.append(interval)
            else:
                tentative.append(interval)

        return OverlapResult(
            hard_conflict=_highest_priority(hard),
            tentative_conflict=_highest_priority(tentative),
        )


def _highest_priority(bookings: list[BookingInterval]) -> BookingInterval | None:
    if not bookings:
        return None
    return sorted(
        bookings, key=lambda booking: (booking.status != "Confirmed", booking.start_at)
    )[0]


def _as_utc(value: str | datetime) -> datetime:
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Booking times must include a time zone.")
    return value.astimezone(UTC)

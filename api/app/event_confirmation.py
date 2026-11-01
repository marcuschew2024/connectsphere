"""Business rule for confirming an event (SCRUM-39, SCRUM-159).

A confirmation gate in the shape of EventDecision / BookingDecision
(event_decision.py, booking_decision.py): a small, DB-independent value object
that decides whether an event may move Planning -> Confirmed, given the status
of its venue bookings. It has no persistence, so it is unit-testable in
isolation; the endpoint and repository provide the data and the state change.

Gate (Week 7 change #3, multi-venue). An event may be confirmed only when:
  * at least one venue booking is Confirmed - a fully-resourced event must have
    an approved venue (PO decision: zero bookings cannot be confirmed), AND
  * no venue booking is still awaiting approval - any status that is not a
    settled Confirmed/Rejected/Cancelled (Requested, Pending, or an unrecognised value)
    blocks, AND
  * no approved booking's slot has drifted from the event's date/time
    (SCRUM-159: a reschedule must not leave an orphaned booking - NFR-d), AND
  * the technical arrangements are resolved.

Rejected and cancelled bookings are settled history and do not block. The
`from_arrangements` requires every equipment request to be Reserved; the
repository derives readiness from its current reservations. Non-essential items
(programme, registration setup) are intentionally not part of the gate - AC2
requires that they must not block confirmation, so the gate never looks at them.
"""

from datetime import datetime


def _as_instant(value) -> datetime | None:
    """Parse a timezone-aware instant from a datetime or ISO string.

    Returns None for anything we cannot compare safely (missing, unparseable, or
    naive/no-timezone). A None means "cannot judge" - the caller treats such a
    booking as not drifted rather than invent a blocking conflict.
    """
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str) and value.strip():
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None or dt.utcoffset() is None:
        return None
    return dt


class EventConfirmation:
    """Decides whether an event's arrangements allow it to be confirmed."""

    # A booking in one of these states is settled - no further action is pending.
    _SETTLED = {"Confirmed", "Rejected", "Cancelled"}

    def __init__(
        self,
        booking_statuses,
        technical_resolved: bool = True,
        mismatched_bookings: int = 0,
    ):
        statuses = [self._clean(status) for status in booking_statuses]
        self._confirmed = sum(1 for status in statuses if status == "Confirmed")
        # Everything not settled (Requested/Pending/unknown) is still pending.
        self._pending = [status for status in statuses if status not in self._SETTLED]
        self._technical_resolved = bool(technical_resolved)
        # Approved bookings whose slot no longer covers the event's date/time.
        self._mismatched = int(mismatched_bookings)

    @staticmethod
    def _clean(status) -> str:
        """Normalise a status; an unreadable one is treated as unsettled."""
        if not isinstance(status, str) or not status.strip():
            return "Unknown"
        return status.strip()

    @classmethod
    def _slot_covers(cls, booking: dict, event_dt: datetime) -> bool:
        """True when the booking's [start_at, end_at) window contains the event instant.

        A booking whose slot we cannot read is treated as covering (not drifted) so
        the gate never blocks on unreadable data - the status checks still apply.
        """
        start = _as_instant(booking.get("start_at"))
        end = _as_instant(booking.get("end_at"))
        if start is None or end is None:
            return True
        return start <= event_dt < end

    @classmethod
    def from_bookings(
        cls,
        bookings,
        technical_resolved: bool = True,
        event_datetime=None,
    ) -> "EventConfirmation":
        """Build the gate from venue-booking rows (each a dict with 'status').

        When event_datetime is given, an approved (Confirmed) booking whose slot no
        longer covers it is counted as mismatched and blocks confirmation (SCRUM-159).
        When it is omitted the gate behaves exactly as before.
        """
        if not isinstance(bookings, list):
            raise ValueError("Bookings must be a list of booking records.")
        statuses = [
            booking.get("status") if isinstance(booking, dict) else None
            for booking in bookings
        ]
        mismatched = 0
        event_dt = _as_instant(event_datetime) if event_datetime is not None else None
        if event_dt is not None:
            mismatched = sum(
                1
                for booking in bookings
                if isinstance(booking, dict)
                and cls._clean(booking.get("status")) == "Confirmed"
                and not cls._slot_covers(booking, event_dt)
            )
        return cls(
            statuses,
            technical_resolved=technical_resolved,
            mismatched_bookings=mismatched,
        )

    @classmethod
    def from_arrangements(
        cls, bookings, equipment_requests, event_datetime=None
    ) -> "EventConfirmation":
        """No equipment requests means none are needed; every recorded request must be ready."""
        if not isinstance(equipment_requests, list):
            raise ValueError("Equipment requests must be a list of request records.")
        technical_resolved = all(
            isinstance(row, dict) and cls._clean(row.get("status")) == "Reserved"
            for row in equipment_requests
        )
        return cls.from_bookings(
            bookings,
            technical_resolved=technical_resolved,
            event_datetime=event_datetime,
        )

    @property
    def can_confirm(self) -> bool:
        """True only when a venue is approved, nothing is pending or drifted, tech is resolved."""
        return (
            self._confirmed >= 1
            and not self._pending
            and self._mismatched == 0
            and self._technical_resolved
        )

    @property
    def outstanding(self) -> list[str]:
        """Human-readable blocking reasons; empty exactly when can_confirm is True."""
        reasons: list[str] = []
        if self._confirmed == 0 and not self._pending:
            reasons.append("No venue has been booked and approved yet.")
        if self._pending:
            reasons.append(
                f"{len(self._pending)} venue booking(s) still awaiting approval."
            )
        if self._mismatched:
            reasons.append(
                f"{self._mismatched} approved venue booking(s) no longer match the "
                "event's date/time and must be re-checked."
            )
        if not self._technical_resolved:
            reasons.append("Technical arrangements are not yet resolved.")
        return reasons

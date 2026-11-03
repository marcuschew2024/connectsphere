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
    settled Confirmed/Rejected/Cancelled/Expired (Requested, Pending, a live Held,
    or an unrecognised value) blocks, AND
  * no approved booking's slot has drifted from the event's date/time
    (SCRUM-159: a reschedule must not leave an orphaned booking - NFR-d), AND
  * when the event has an end time, its approved bookings together cover the event
    from start to end with no gap (SCRUM-166 / audit R4: a 1-hour booking cannot
    satisfy a 3-hour event; a main hall plus a shorter breakout room can), AND
  * the technical arrangements are resolved, and every Reserved request's reservation
    window covers the event's time (SCRUM-166).

Rejected, cancelled and expired bookings are settled history and do not block
(an expired hold is a lapsed request, not a live one - SCRUM-170/audit A1). A
still-live Held hold is pending and does block. The
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
    # Expired holds are lapsed history (SCRUM-170/audit A1): a live Held hold is
    # still pending and is intentionally not settled.
    _SETTLED = {"Confirmed", "Rejected", "Cancelled", "Expired"}

    def __init__(
        self,
        booking_statuses,
        technical_resolved: bool = True,
        mismatched_bookings: int = 0,
        uncovered: bool = False,
        mistimed_equipment: int = 0,
    ):
        statuses = [self._clean(status) for status in booking_statuses]
        self._confirmed = sum(1 for status in statuses if status == "Confirmed")
        # Everything not settled (Requested/Pending/unknown) is still pending.
        self._pending = [status for status in statuses if status not in self._SETTLED]
        self._technical_resolved = bool(technical_resolved)
        # Approved bookings whose slot no longer covers the event's date/time.
        self._mismatched = int(mismatched_bookings)
        # SCRUM-166: part of the event's start-end span has no approved booking.
        self._uncovered = bool(uncovered)
        # SCRUM-166: Reserved requests whose reservation window misses the event's time.
        self._mistimed_equipment = int(mistimed_equipment)

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

    @staticmethod
    def _window(row: dict, start_key: str, end_key: str):
        """A readable [start, end) window, or None when it cannot be judged."""
        start, end = _as_instant(row.get(start_key)), _as_instant(row.get(end_key))
        if start is None or end is None or end <= start:
            return None
        return start, end

    @staticmethod
    def _span(event_datetime, event_end) -> tuple[datetime, datetime] | None:
        """The event's [start, end) span, or None when it has no usable end time."""
        start = _as_instant(event_datetime) if event_datetime is not None else None
        end = _as_instant(event_end) if event_end is not None else None
        if start is None or end is None or end <= start:
            return None
        return start, end

    @staticmethod
    def _covers_span(windows, span) -> bool:
        """True when the union of half-open windows covers the whole half-open span."""
        reached = span[0]
        for start, end in sorted(windows):
            if start > reached:
                break  # A gap before this window starts.
            reached = max(reached, end)
            if reached >= span[1]:
                return True
        return reached >= span[1]

    @classmethod
    def from_bookings(
        cls,
        bookings,
        technical_resolved: bool = True,
        event_datetime=None,
        event_end=None,
        mistimed_equipment: int = 0,
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
        uncovered = False
        approved = [
            booking for booking in bookings
            if isinstance(booking, dict) and cls._clean(booking.get("status")) == "Confirmed"
        ]
        span = cls._span(event_datetime, event_end)
        event_dt = _as_instant(event_datetime) if event_datetime is not None else None
        if span is not None:
            # SCRUM-166: judge the whole event, not only its start instant.
            windows = [w for b in approved if (w := cls._window(b, "start_at", "end_at"))]
            # An approved booking that does not touch the event at all is an orphan.
            mismatched = sum(1 for start, end in windows
                             if not (start < span[1] and span[0] < end))
            # Unreadable slots never invent a conflict (see _as_instant).
            if windows:
                uncovered = not cls._covers_span(windows, span)
        elif event_dt is not None:
            mismatched = sum(1 for booking in approved
                             if not cls._slot_covers(booking, event_dt))
        return cls(
            statuses,
            technical_resolved=technical_resolved,
            mismatched_bookings=mismatched,
            uncovered=uncovered,
            mistimed_equipment=mistimed_equipment,
        )

    @classmethod
    def from_arrangements(
        cls, bookings, equipment_requests, event_datetime=None, event_end=None
    ) -> "EventConfirmation":
        """No equipment requests means none are needed; every recorded request must be ready.

        SCRUM-166: a Reserved request also needs its reservation window to cover the
        event's time - start to end when the event has an end, else its start instant.
        A window that cannot be read is not counted as mistimed.
        """
        if not isinstance(equipment_requests, list):
            raise ValueError("Equipment requests must be a list of request records.")
        technical_resolved = all(
            isinstance(row, dict) and cls._clean(row.get("status")) == "Reserved"
            for row in equipment_requests
        )
        span = cls._span(event_datetime, event_end)
        event_dt = _as_instant(event_datetime) if event_datetime is not None else None
        mistimed = 0
        for row in equipment_requests:
            if not isinstance(row, dict) or cls._clean(row.get("status")) != "Reserved":
                continue
            window = cls._window(row, "reservation_start_at", "reservation_end_at")
            if window is None:
                continue
            if span is not None:
                covered = window[0] <= span[0] and span[1] <= window[1]
            elif event_dt is not None:
                covered = window[0] <= event_dt < window[1]
            else:
                covered = True
            mistimed += 0 if covered else 1
        return cls.from_bookings(
            bookings,
            technical_resolved=technical_resolved,
            event_datetime=event_datetime,
            event_end=event_end,
            mistimed_equipment=mistimed,
        )

    @property
    def can_confirm(self) -> bool:
        """True only when a venue is approved, nothing is pending or drifted, tech is resolved."""
        return (
            self._confirmed >= 1
            and not self._pending
            and self._mismatched == 0
            and not self._uncovered
            and self._technical_resolved
            and self._mistimed_equipment == 0
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
        if self._uncovered:
            reasons.append(
                "The approved venue bookings do not cover the event's full time; "
                "book a venue for the uncovered part."
            )
        if not self._technical_resolved:
            reasons.append("Technical arrangements are not yet resolved.")
        if self._mistimed_equipment:
            reasons.append(
                f"{self._mistimed_equipment} equipment reservation(s) do not cover the "
                "event's time and must be re-reserved."
            )
        return reasons

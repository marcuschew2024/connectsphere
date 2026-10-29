"""Business rule for confirming an event (SCRUM-39).

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
  * the technical arrangements are resolved.

Rejected and cancelled bookings are settled history and do not block. The
`from_arrangements` requires every equipment request to be Reserved; the
repository derives readiness from its current reservations. Non-essential items
(programme, registration setup) are intentionally not part of the gate - AC2
requires that they must not block confirmation, so the gate never looks at them.
"""


class EventConfirmation:
    """Decides whether an event's arrangements allow it to be confirmed."""

    # A booking in one of these states is settled - no further action is pending.
    _SETTLED = {"Confirmed", "Rejected", "Cancelled"}

    def __init__(self, booking_statuses, technical_resolved: bool = True):
        statuses = [self._clean(status) for status in booking_statuses]
        self._confirmed = sum(1 for status in statuses if status == "Confirmed")
        # Everything not settled (Requested/Pending/unknown) is still pending.
        self._pending = [status for status in statuses if status not in self._SETTLED]
        self._technical_resolved = bool(technical_resolved)

    @staticmethod
    def _clean(status) -> str:
        """Normalise a status; an unreadable one is treated as unsettled."""
        if not isinstance(status, str) or not status.strip():
            return "Unknown"
        return status.strip()

    @classmethod
    def from_bookings(cls, bookings, technical_resolved: bool = True) -> "EventConfirmation":
        """Build the gate from venue-booking rows (each a dict with 'status')."""
        if not isinstance(bookings, list):
            raise ValueError("Bookings must be a list of booking records.")
        statuses = [
            booking.get("status") if isinstance(booking, dict) else None
            for booking in bookings
        ]
        return cls(statuses, technical_resolved=technical_resolved)

    @classmethod
    def from_arrangements(cls, bookings, equipment_requests) -> "EventConfirmation":
        """No equipment requests means none are needed; every recorded request must be ready."""
        if not isinstance(equipment_requests, list):
            raise ValueError("Equipment requests must be a list of request records.")
        technical_resolved = all(
            isinstance(row, dict) and cls._clean(row.get("status")) == "Reserved"
            for row in equipment_requests
        )
        return cls.from_bookings(bookings, technical_resolved=technical_resolved)

    @property
    def can_confirm(self) -> bool:
        """True only when a venue is approved, nothing is pending, tech is resolved."""
        return self._confirmed >= 1 and not self._pending and self._technical_resolved

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
        if not self._technical_resolved:
            reasons.append("Technical arrangements are not yet resolved.")
        return reasons

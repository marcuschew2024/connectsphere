"""Business rule for completing and closing an event (SCRUM-132).

A completion gate in the shape of EventConfirmation (event_confirmation.py): a
small, DB-independent value object that decides whether a delivered event may
move Preparation -> Completed. It has no persistence, so it is unit-testable in
isolation; the endpoint supplies the data and the complete_event database
function re-checks the same rule under a row lock before closing the event.

Gate. An event may be completed only when:
  * it is in Preparation - it was confirmed and passed the operational safety
    check (SCRUM-128), so it has been delivered (team decision 2026-10-25), AND
  * no venue booking is still awaiting approval (Requested/Pending), AND
  * no equipment request is still unactioned (Requested) - Tech Support must
    settle it first, because closed events make equipment requests read-only.

Confirmed, Rejected, Cancelled and Blocked bookings and Reserved, Partially
fulfilled and Unavailable equipment requests are settled and do not block.
"""


class EventCompletion:
    """Decides whether a delivered event's arrangements allow it to be closed."""

    ELIGIBLE_STATUS = "Preparation"

    _PENDING_BOOKINGS = {"Requested", "Pending"}
    _OPEN_EQUIPMENT_REQUESTS = {"Requested"}

    def __init__(self, event_status, booking_statuses=(), equipment_request_statuses=()):
        self._status = event_status.strip() if isinstance(event_status, str) else ""
        self._pending_bookings = sum(
            1 for status in booking_statuses if self._clean(status) in self._PENDING_BOOKINGS
        )
        self._open_requests = sum(
            1 for status in equipment_request_statuses
            if self._clean(status) in self._OPEN_EQUIPMENT_REQUESTS
        )

    @staticmethod
    def _clean(status) -> str:
        return status.strip() if isinstance(status, str) else ""

    @classmethod
    def from_records(cls, event: dict, bookings, equipment_requests) -> "EventCompletion":
        """Build the gate from an event row and its booking/request rows (dicts with 'status')."""
        if not isinstance(bookings, list) or not isinstance(equipment_requests, list):
            raise ValueError("Bookings and equipment requests must be lists of records.")
        return cls(
            event.get("status") if isinstance(event, dict) else None,
            [row.get("status") for row in bookings if isinstance(row, dict)],
            [row.get("status") for row in equipment_requests if isinstance(row, dict)],
        )

    @property
    def in_eligible_state(self) -> bool:
        return self._status == self.ELIGIBLE_STATUS

    @property
    def can_complete(self) -> bool:
        """True only for a Preparation event with no outstanding arrangements."""
        return self.in_eligible_state and not self._pending_bookings and not self._open_requests

    @property
    def outstanding(self) -> list[str]:
        """Human-readable blocking reasons; empty exactly when can_complete is True."""
        if not self.in_eligible_state:
            if self._status == "Completed":
                return ["This event is already completed."]
            return ["Only an event in Preparation can be completed."]
        reasons: list[str] = []
        if self._pending_bookings:
            reasons.append(
                f"{self._pending_bookings} venue booking(s) still awaiting approval."
            )
        if self._open_requests:
            reasons.append(
                f"{self._open_requests} equipment request(s) still awaiting Tech Support."
            )
        return reasons

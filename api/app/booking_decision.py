"""Business rules for venue-staff decisions on submitted booking requests (SCRUM-32).

Mirrors the shape of EventDecision (event_decision.py): a small, DB-independent
value object that validates one approve/reject decision. The endpoint and the
venue_bookings table (SCRUM-31) consume this class; the class itself has no
persistence, so it is unit-testable in isolation.
"""


class BookingDecision:
    """Represents one valid approve or reject decision on a booking request."""

    _STATUSES = {
        "approve": "Confirmed",
        "reject": "Rejected",
        "hold": "Held",
    }

    def __init__(
        self,
        action: str,
        reason: str | None = None,
        alternative: str | None = None,
    ):
        if action not in self._STATUSES:
            raise ValueError("Decision must be approve, reject, or hold.")

        if action == "reject":
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError("A reason is required when rejecting a request.")
            reason = reason.strip()
        elif action == "hold":
            reason = (
                reason.strip()
                if isinstance(reason, str) and reason.strip()
                else "Tentatively held by Venue Staff"
            )
        else:
            reason = None

        # An alternative venue/time is optional on either outcome (AC: "may
        # optionally be suggested"). Blank strings collapse to None.
        if isinstance(alternative, str):
            alternative = alternative.strip() or None
        elif alternative is not None:
            raise ValueError("A suggested alternative must be text.")

        self.action = action
        self.reason = reason
        self.alternative = alternative

    @property
    def is_hold(self) -> bool:
        return self.action == "hold"

    @classmethod
    def from_payload(cls, data: object) -> "BookingDecision":
        """Build a decision from the JSON sent by the client."""
        allowed_keys = {"decision", "reason", "alternative", "expires_at"}
        if not isinstance(data, dict) or set(data) - allowed_keys:
            raise ValueError(
                "Send a decision and, when rejecting, a reason; "
                "alternative and expires_at are optional."
            )
        return cls(data.get("decision"), data.get("reason"), data.get("alternative"))

    @property
    def status(self) -> str:
        """Return the database status produced by this decision."""
        return self._STATUSES[self.action]

    @property
    def is_rejection(self) -> bool:
        return self.action == "reject"

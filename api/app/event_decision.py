"""Business rules for coordinator decisions on submitted event requests."""


class EventDecision:
    """Represents one valid approve or reject decision."""

    _STATUSES = {
        "approve": "Planning",
        "reject": "Rejected",
    }

    def __init__(self, action: str, reason: str | None = None):
        if action not in self._STATUSES:
            raise ValueError("Decision must be approve or reject.")

        if action == "reject":
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError("A reason is required when rejecting a request.")
            reason = reason.strip()
        else:
            reason = None

        self.action = action
        self.reason = reason

    @classmethod
    def from_payload(cls, data: object) -> "EventDecision":
        """Build a decision from the JSON sent by the client."""
        if not isinstance(data, dict) or set(data) - {"decision", "reason"}:
            raise ValueError("Send a decision and, when rejecting, a reason.")
        return cls(data.get("decision"), data.get("reason"))

    @property
    def status(self) -> str:
        """Return the database status produced by this decision."""
        return self._STATUSES[self.action]

    @property
    def is_rejection(self) -> bool:
        return self.action == "reject"

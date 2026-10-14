"""Business rule for a Safety Officer's operational safety decision (SCRUM-128).

Mirrors EventDecision / BookingDecision: a small, DB-independent value object that
validates one safety decision on a Confirmed event (Week 7 customer change #6). The
event lifecycle gains a stage - a Confirmed event is reviewed for operational safety,
and only an approval lets it proceed to Preparation.

Target event status per decision (PO decisions):
  * approve          -> Preparation (the event may proceed to preparation)
  * request_changes  -> Planning    (return to the planning stage to re-review
                                     the affected venue/technical arrangements)
  * reject           -> Planning    (safety-rejected; the team reworks and resubmits)

A reason is required whenever the event is sent back (reject or request_changes) so the
team knows what to address; it is dropped on approval.
"""


class SafetyDecision:
    """Represents one valid Safety Officer decision on a confirmed event."""

    _STATUSES = {
        "approve": "Preparation",
        "request_changes": "Planning",
        "reject": "Planning",
    }

    # Decisions that send the event back therefore need an explanatory reason.
    _REASON_REQUIRED = {"request_changes", "reject"}

    def __init__(self, action: str, reason: str | None = None):
        if action not in self._STATUSES:
            raise ValueError("Decision must be approve, request_changes or reject.")

        if action in self._REASON_REQUIRED:
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError(
                    "A reason is required when rejecting or requesting changes."
                )
            reason = reason.strip()
        else:
            reason = None

        self.action = action
        self.reason = reason

    @classmethod
    def from_payload(cls, data: object) -> "SafetyDecision":
        """Build a decision from the JSON sent by the client."""
        if not isinstance(data, dict) or set(data) - {"decision", "reason"}:
            raise ValueError(
                "Send a decision and, when rejecting or requesting changes, a reason."
            )
        return cls(data.get("decision"), data.get("reason"))

    @property
    def status(self) -> str:
        """Return the event status produced by this decision."""
        return self._STATUSES[self.action]

    @property
    def approved(self) -> bool:
        return self.action == "approve"

    @property
    def returns_to_planning(self) -> bool:
        return self._STATUSES[self.action] == "Planning"

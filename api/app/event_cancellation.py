"""Business rules for cancelling an event (SCRUM-69).

A small, DB-independent value object in the shape of SafetyDecision and
EventCompletion: it validates the cancellation request and decides who may cancel
an event and from which states. It has no persistence, so it is unit-testable in
isolation; the cancel_event database function re-checks the same rules under a
row lock, then releases the event's resources and notifies the people affected.

Authorised users (team decision, 2026-10-30, Decision Log D32):
  * the event's assigned Coordinator - Coordinators manage only their assigned
    events (SCRUM-130); and
  * the Event Coordinator Lead - who oversees every event, including unassigned
    submissions (SCRUM-131).
Organisers do not cancel directly: like any change after submission, they ask the
Coordinator through a change request (SCRUM-46, S1 Q28).
"""

MAX_REASON_LENGTH = 2000


class EventCancellation:
    """A validated cancellation request: the reason recorded in the event's history."""

    LEAD_ROLE = "Event Coordinator Lead"

    # Active workflow states, including the legacy intake sub-states of Submitted.
    CANCELLABLE_STATUSES = frozenset({
        "Submitted", "Assigned", "Under review", "Under Review", "Approved",
        "Planning", "Confirmed", "Preparation",
    })
    CLOSED_STATUSES = frozenset({"Completed", "Rejected", "Cancelled"})

    def __init__(self, reason: str):
        self.reason = reason

    @classmethod
    def from_payload(cls, payload) -> "EventCancellation":
        """Accept exactly {"reason": "..."} with 1-2000 characters after trimming."""
        if not isinstance(payload, dict) or set(payload) != {"reason"}:
            raise ValueError("Send a JSON object containing only reason.")
        reason = payload["reason"]
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("Give a reason for cancelling this event.")
        reason = reason.strip()
        if len(reason) > MAX_REASON_LENGTH:
            raise ValueError(
                f"The cancellation reason must be at most {MAX_REASON_LENGTH} characters."
            )
        return cls(reason)

    @classmethod
    def actor_may_cancel(cls, actor: dict, event: dict) -> bool:
        """The Lead may cancel any event; a Coordinator only the event assigned to them."""
        if not isinstance(actor, dict) or not isinstance(event, dict):
            return False
        if actor.get("role") == cls.LEAD_ROLE:
            return True
        return (
            actor.get("role") == "Coordinator"
            and actor.get("id") is not None
            and event.get("coordinator_id") == actor.get("id")
        )

    @classmethod
    def blocking_reason(cls, status) -> str | None:
        """Why an event in this state cannot be cancelled, or None when it can."""
        status = status.strip() if isinstance(status, str) else ""
        if status in cls.CANCELLABLE_STATUSES:
            return None
        if status == "Cancelled":
            return "This event is already cancelled."
        if status in cls.CLOSED_STATUSES:
            return f"A {status.lower()} event is closed and cannot be cancelled."
        return "Only a submitted or active event can be cancelled."

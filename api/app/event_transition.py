"""SCRUM-135: explicit intake transitions; operational gates remain separate."""

from dataclasses import dataclass


class TransitionRefused(ValueError):
    """A known status cannot be reached from the current state through this action."""


@dataclass(frozen=True)
class EventTransition:
    target: str

    EDGES = {
        "Submitted": frozenset({"Assigned", "Under review", "Planning", "Rejected"}),
        "Assigned": frozenset({"Under review", "Planning", "Rejected"}),
        "Under review": frozenset({"Planning", "Rejected"}),
        "Under Review": frozenset({"Planning", "Rejected"}),
        "Approved": frozenset({"Planning", "Rejected"}),
    }
    GATES = {
        "Confirmed": "Confirm an event through its confirmation step, not a status update.",
        "Preparation": "An event reaches preparation only through the operational safety check.",
        "Completed": "Complete an event through its completion step, not a status update.",
        "Cancelled": "Cancel an event through its cancellation step, not a status update.",
        "Rejected": "Reject a request through its decision step, with a reason.",
    }
    KNOWN = frozenset(
        {
            "Draft",
            "Submitted",
            "Assigned",
            "Under review",
            "Approved",
            "Planning",
            "Confirmed",
            "Preparation",
            "Completed",
            "Rejected",
            "Cancelled",
        }
    )

    @classmethod
    def from_payload(cls, data):
        if not isinstance(data, dict) or set(data) != {"status"}:
            raise ValueError("Send a JSON object containing only status.")
        if not isinstance(data["status"], str) or data["status"] not in cls.KNOWN:
            raise ValueError("Choose a valid event status.")
        return cls(data["status"])

    def validate(self, current, *, decision=False):
        if current == "Draft":
            raise TransitionRefused(
                "Complete and submit this request through the draft form first."
            )
        if current in {"Completed", "Cancelled", "Rejected"}:
            raise TransitionRefused(
                f"This event is {current.lower()} and closed. Its record is read-only."
            )
        if self.target in self.GATES and not (decision and self.target == "Rejected"):
            raise TransitionRefused(self.GATES[self.target])
        if self.target not in self.EDGES.get(current, frozenset()):
            raise TransitionRefused("This status transition is not allowed. Reload the event.")

    @staticmethod
    def actor_allowed(user, event):
        return (
            user.get("role") == "Coordinator"
            and user.get("id") is not None
            and user["id"] == event.get("coordinator_id")
        )

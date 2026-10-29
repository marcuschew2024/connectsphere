"""Who may be routed where when the Event Coordinator Lead assigns (SCRUM-130).

Pure value object: plain inputs in, plain results out. The database function
``assign_coordinator_by_lead`` re-checks the same rules under the event row lock.
"""

from __future__ import annotations

from dataclasses import dataclass

# Active lifecycle states (stored statuses) in which an event can be routed to a
# Coordinator. Drafts are private to their Organiser; terminal events are closed.
ASSIGNABLE_STATUSES = frozenset({
    "Submitted", "Assigned", "Under review", "Approved",
    "Planning", "Confirmed", "Preparation",
})
CLOSED_STATUSES = frozenset({"Completed", "Rejected", "Cancelled"})


class AssignmentRefused(ValueError):
    """The event cannot be routed to this Coordinator right now (HTTP 409)."""


@dataclass(frozen=True)
class CoordinatorAssignment:
    coordinator_id: int

    @classmethod
    def from_payload(cls, data: object) -> CoordinatorAssignment:
        if not isinstance(data, dict) or set(data) != {"coordinator_id"}:
            raise ValueError("Send a JSON object containing only coordinator_id.")
        coordinator_id = data["coordinator_id"]
        # bool is an int subclass in Python, so reject it explicitly.
        if type(coordinator_id) is not int or not 1 <= coordinator_id <= 2_147_483_647:
            raise ValueError("Choose a Coordinator to assign.")
        return cls(coordinator_id)

    def outcome(self, *, status: str, current_coordinator_id: int | None) -> str:
        """Return "assigned" or "reassigned", or raise AssignmentRefused."""
        if status in CLOSED_STATUSES:
            raise AssignmentRefused("This event is closed, so its Coordinator cannot change.")
        if status not in ASSIGNABLE_STATUSES:
            raise AssignmentRefused("This event cannot be assigned in its current state.")
        if current_coordinator_id == self.coordinator_id:
            raise AssignmentRefused("This Coordinator is already assigned to the event.")
        return "assigned" if current_coordinator_id is None else "reassigned"

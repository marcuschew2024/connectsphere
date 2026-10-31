"""SCRUM-45: private rosters belong to the owner and current assigned coordinator."""

from dataclasses import dataclass


@dataclass(frozen=True)
class RegistrationRosterAccess:
    organiser_id: int
    coordinator_id: int | None

    def allows(self, actor_id: int, role: str) -> bool:
        return ((role == "Organiser" and actor_id == self.organiser_id)
                or (role == "Coordinator" and actor_id == self.coordinator_id))

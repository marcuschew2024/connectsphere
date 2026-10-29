"""SCRUM-40 registration rules; no HTTP or persistence dependencies."""

from dataclasses import dataclass
from datetime import datetime

from .registration_capacity import RegistrationCapacity


@dataclass(frozen=True)
class RegistrationRequest:
    capacity: RegistrationCapacity
    status: str
    requirements: str | None = None
    opens_at: str | None = None
    closes_at: str | None = None

    def refusal(self, now: datetime) -> str | None:
        refusal = self.capacity.refusal(self.status)
        if refusal:
            return refusal
        if self.opens_at and now < datetime.fromisoformat(self.opens_at):
            return "Registration has not opened yet."
        if self.closes_at and now >= datetime.fromisoformat(self.closes_at):
            return "Registration has closed."
        return None

    def information_error(self, information: object) -> str | None:
        if not isinstance(information, str):
            return "Enter registration information as text."
        if len(information) > 4000:
            return "Use at most 4,000 characters for registration information."
        if self.requirements and self.requirements.strip() and not information.strip():
            return "Provide the required registration information."
        return None

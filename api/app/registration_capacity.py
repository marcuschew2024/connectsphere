"""SCRUM-41: pure registration-capacity rules, independent of HTTP and storage."""

from dataclasses import dataclass


def valid_capacity(value: object) -> bool:
    return type(value) is int and 1 <= value <= 2_147_483_647


@dataclass(frozen=True)
class RegistrationCapacity:
    capacity: int | None
    registered_count: int

    @property
    def remaining(self) -> int:
        return max(0, (self.capacity or 0) - self.registered_count)

    @property
    def is_full(self) -> bool:
        return self.capacity is not None and self.remaining == 0

    def refusal(self, event_status: str) -> str | None:
        if event_status != "Confirmed":
            return "Registration is only available for confirmed events."
        if self.capacity is None:
            return "Registration capacity has not been set. Please check again later."
        if self.is_full:
            return "This event is full. No places are currently available."
        return None

    def as_dict(self) -> dict:
        return {
            "capacity": self.capacity,
            "registered_count": self.registered_count,
            "remaining": self.remaining,
            "is_full": self.is_full,
        }

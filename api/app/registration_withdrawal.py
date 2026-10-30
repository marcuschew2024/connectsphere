"""SCRUM-43 withdrawal conditions, independent of HTTP and persistence."""

from dataclasses import dataclass
from datetime import UTC, datetime

POLICY_LOCKED = "Withdrawal conditions are locked after the first signup or the event starts."


def instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(UTC) if parsed.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


@dataclass(frozen=True)
class RegistrationWithdrawal:
    event_status: str
    starts_at: str | None
    closes_at: str | None = None

    def refusal(self, now: datetime) -> str | None:
        if self.event_status not in ("Confirmed", "Preparation"):
            return "Withdrawal is only available before an active event starts."
        starts = instant(self.starts_at)
        if starts is None or now >= starts:
            return "Withdrawal is closed because the event has started."
        closes = instant(self.closes_at)
        if closes is not None and now >= closes:
            return "The organiser’s withdrawal deadline has passed."
        return None

    def can_edit(self, now: datetime, has_registrations: bool) -> bool:
        if has_registrations or self.event_status not in (
            "Draft", "Submitted", "Assigned", "Under review", "Approved", "Planning", "Confirmed",
        ):
            return False
        starts = instant(self.starts_at)
        return starts is None or now < starts

    def policy_error(self, closes_at: object, now: datetime) -> str | None:
        if closes_at is not None:
            closes = instant(closes_at)
            starts = instant(self.starts_at)
            if closes is None:
                return "Enter a valid withdrawal deadline including its time zone."
            if starts is None or closes > starts or closes <= now:
                return "Choose a future withdrawal deadline no later than the event start."
        return None


def withdrawal_rules(event: dict) -> RegistrationWithdrawal:
    return RegistrationWithdrawal(event["status"], event.get("event_datetime"),
                                  event.get("withdrawal_closes_at"))

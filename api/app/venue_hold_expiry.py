"""SCRUM-79: releasing expired tentative venue holds (Week 7 Customer Change #4).

The rules at the top are pure — no Flask, no database — so the expiry decision and the
Coordinator's notice are unit-testable in isolation. `release_expired_holds` composes them
with the booking repository and the notification writer, the same way `venue_search`
composes the overlap engine with its repository reads.

Two layers release the slot, deliberately:

- this sweep, which moves the row to 'Expired' and tells the Coordinator (AC 4 and 5);
- a database trigger, which clears stale holds before any booking write even if no
  application path ran first (the authority, so the engine and the exclusion constraints
  can never disagree about whether an expired hold occupies the slot).

Because the trigger is the authority, the sweep is opportunistic: it must never turn a
working request into a 500. It follows `rbac.log_access_denied` in swallowing its own
failures after logging them.
"""

from datetime import UTC, datetime

from flask import current_app

from .booking_repository import expire_holds
from .event_repository import create_notification, get_event_by_id

HOLD_STATUS = "Held"
EXPIRED_STATUS = "Expired"


def _as_utc(value: str | datetime) -> datetime:
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.astimezone(UTC)


def is_hold_expired(record: dict, as_of: datetime | None = None) -> bool:
    """True when this record is a hold whose deadline has passed.

    Mirrors `BookingInterval.is_expired`: the deadline is inclusive, so a hold expires at
    exactly `expires_at` rather than a moment after it.
    """
    if record.get("status") != HOLD_STATUS:
        return False
    expires_at = record.get("expires_at")
    if not expires_at:
        return False
    return (as_of or datetime.now(UTC)) >= _as_utc(expires_at)


def expiry_notice(record: dict, event: dict | None = None) -> str:
    """The Coordinator's message when a hold is released (AC 5)."""
    title = (event or {}).get("title") or (record.get("event") or {}).get("title")
    return (
        f'The tentative venue hold for "{title or "your event"}" reached its deadline and '
        "has expired. The venue is available for other requests again — request it again "
        "or choose another venue."
    )


def hold_notice_recipient(record: dict, event: dict | None = None) -> int | None:
    """Who hears about a released hold: the event's current Coordinator (SCRUM-21/130).

    Falls back to the Coordinator who requested the booking when the event cannot be
    read, so a release is never silent.
    """
    return (event or {}).get("coordinator_id") or record.get("requested_by")


def release_expired_holds(venue_id: str | None = None) -> list[dict]:
    """Release every hold past its deadline and notify its Coordinator.

    Returns the released rows. Never raises: the database trigger guarantees the slot is
    free regardless, so a failure here is logged and the caller continues.
    """
    try:
        released = expire_holds(venue_id)
    except Exception:
        current_app.logger.exception("expired hold sweep failed (non-fatal)")
        return []

    for record in released:
        try:
            event = get_event_by_id(record["event_id"]) if record.get("event_id") else None
            recipient = hold_notice_recipient(record, event)
            if recipient is None:
                continue
            create_notification(
                recipient,
                record.get("event_id"),
                "booking_hold_expired",
                expiry_notice(record, event),
                subject_id=record.get("id"),
            )
        except Exception:
            current_app.logger.exception(
                "expired hold notice failed (non-fatal)", extra={"booking": record.get("id")}
            )
    return released

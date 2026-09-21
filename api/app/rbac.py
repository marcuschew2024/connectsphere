"""Authorisation helpers for SCRUM-21 (US-1.2 Role-based access).

Two kinds of checks, both enforced server-side (never rely on the UI hiding things):
- `require_role`         — role-level gating (e.g. only Organisers create events)
- `require_related_user` — record-level gating (only people tied to an event may see it)

Every denial is recorded in `access_denied_log` so we have an audit trail of who was
blocked from what (TC-US1.2-05). Logging never breaks the request it is protecting.
"""

from __future__ import annotations

from flask import current_app, request
from werkzeug.exceptions import Forbidden

from .event_repository import is_event_participant
from .supabase_client import get_supabase_client


def log_access_denied(
    user: dict | None,
    *,
    action: str,
    event_id: str | None = None,
    reason: str,
) -> None:
    """Append one row to access_denied_log. Never raises — an audit failure must not
    turn a clean 403 into a 500."""
    try:
        client = get_supabase_client()
        if client is None:
            return
        client.table("access_denied_log").insert(
            {
                "actor_id": user.get("id") if user else None,
                "actor_role": user.get("role") if user else None,
                "action": action,
                "event_id": event_id,
                "reason": reason,
                "ip_address": request.remote_addr,
            }
        ).execute()
    except Exception:
        current_app.logger.exception("access_denied_log insert failed (non-fatal)")


def require_role(user: dict, *allowed_roles: str, action: str) -> dict:
    """Allow the action only if the user holds one of ``allowed_roles``.

    On denial: record it and raise 403. ``action`` is required (keyword-only) so every
    call site names what was being attempted, which is what lands in the audit log.
    """
    if user.get("role") not in allowed_roles:
        log_access_denied(
            user,
            action=action,
            reason=f"role '{user.get('role')}' not in {sorted(allowed_roles)}",
        )
        raise Forbidden("You do not have permission to perform this action.")
    return user


def require_related_user(user: dict, event: dict, *, action: str) -> dict:
    """Allow the action only if the user is tied to this event — its organiser, its
    coordinator, or a listed participant. Otherwise record the denial and raise 403.

    This centralises the record-level check that SCRUM-112 duplicated across the
    view/history/status endpoints (enforces cross-client isolation, TC-US1.2-03).
    """
    related_users = {event.get("organiser_id"), event.get("coordinator_id")}
    if user["id"] not in related_users and not is_event_participant(event["id"], user["id"]):
        log_access_denied(
            user,
            action=action,
            event_id=event.get("id"),
            reason="not a related user",
        )
        raise Forbidden("You are not a related user for this event.")
    return user


# Fields an Attendee is allowed to see (TC-US1.2-04). A whitelist, not a blacklist, so a
# newly-added column never leaks to attendees by default — it stays hidden until someone
# consciously adds it here. Everything else (coordinator_id, organiser_id, submitted_at,
# last_status_changed_by/at, timestamps) is treated as internal planning info.
PUBLIC_EVENT_FIELDS = frozenset(
    {"id", "title", "description", "category", "event_datetime", "status"}
)


def public_event_view(event: dict) -> dict:
    """Return a copy of ``event`` with only the attendee-safe public fields."""
    return {key: value for key, value in event.items() if key in PUBLIC_EVENT_FIELDS}

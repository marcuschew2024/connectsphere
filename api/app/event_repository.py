"""Supabase queries for events. HTTP and validation belong in events.py."""

from datetime import UTC, datetime

from werkzeug.exceptions import Conflict, ServiceUnavailable

from .supabase_client import get_supabase_client


class EventStatus:
    """Encapsulates the status mapping logic for user-visible event states."""

    _mapping = {
        "Draft": "Planning",
        "Submitted": "Planning",
        "Assigned": "Planning",
        "Under review": "Planning",
        "Under Review": "Planning",
        "Approved": "Planning",
        "Planning": "Planning",
        "Confirmed": "Confirmed",
        "Completed": "Completed",
        "Rejected": "Rejected",
        "Cancelled": "Cancelled",
    }

    @classmethod
    def to_visible(cls, raw_status: str | None) -> str:
        return cls._mapping.get((raw_status or "").strip(), "Planning")

    @classmethod
    def is_terminal(cls, raw_status: str | None) -> bool:
        visible = cls.to_visible(raw_status)
        return visible in {"Completed", "Rejected", "Cancelled"}


def insert_event(fields: dict) -> dict:
    """Insert one event and return its stored ID, details and database timestamps."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("events").insert(fields).execute()
        if not result.data:
            raise ServiceUnavailable("The database did not confirm the saved request.")
        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        # Never expose Supabase credentials or internal database details to the browser.
        raise ServiceUnavailable(
            "Could not confirm that the request was saved. Contact the team before retrying."
        ) from error


def canonical_event_status(raw_status: str | None) -> str:
    """Backward-compatible wrapper around the OOP status mapper."""
    return EventStatus.to_visible(raw_status)


def get_event_by_id(event_id: str) -> dict | None:
    """Fetch one event record by ID."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")

        result = client.table("events").select("*").eq("id", event_id).execute()
        if not result.data:
            return None

        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load that event. Contact the team before retrying."
        ) from error


def get_events_for_user(user_id: int, *, drafts_only: bool = False) -> list[dict]:
    """Fetch events where the user is the organiser or coordinator."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")

        query = client.table("events").select("*")
        if drafts_only:
            query = query.eq("organiser_id", user_id).eq("status", "Draft")
        else:
            query = query.or_(f"organiser_id.eq.{user_id},coordinator_id.eq.{user_id}")
        result = query.order("updated_at", desc=True).execute()
        # Even an assigned coordinator must not receive someone else's draft.
        # Filtering here also protects future callers of this shared query.
        return [
            event for event in (result.data or [])
            if event["status"] != "Draft" or event["organiser_id"] == user_id
        ]
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load event requests. Contact the team."
        ) from error


def save_event_draft(event_id: str, user_id: int, fields: dict, *, submitting: bool) -> dict:
    """Save the same draft; SQL makes submission and its history entry atomic."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.rpc("save_event_draft", {
            "p_event_id": event_id,
            "p_organiser_id": user_id,
            "p_details": fields,
            "p_submit": submitting,
        }).execute()
        if not result.data:
            # SQL checks ownership and Draft status again at the moment of writing.
            raise Conflict("This draft is no longer editable. Reload to see its latest status.")
        return result.data[0]
    except (Conflict, ServiceUnavailable):
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not confirm that the draft was saved. Reload it before retrying. "
            "If this continues, ask the team to check the draft database setup."
        ) from error


def add_event_participant(event_id: str, user_id: int, role: str) -> None:
    """Link a user to an event so access survives status changes and time."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        client.table("event_participants").upsert({
            "event_id": event_id,
            "user_id": user_id,
            "role": role,
        }).execute()
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not save the event participant. Contact the team."
        ) from error


def is_event_participant(event_id: str, user_id: int) -> bool:
    """Return whether a user has a durable membership link to an event."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("event_participants").select("event_id").eq(
            "event_id", event_id
        ).eq("user_id", user_id).execute()
        return bool(result.data)
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not check event access. Contact the team."
        ) from error


def add_status_history(
    event_id: str, old_status: str | None, new_status: str, user_id: int
) -> None:
    """Append one immutable status transition record."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        client.table("event_status_history").insert({
            "event_id": event_id,
            "old_status": old_status,
            "new_status": new_status,
            "changed_by": user_id,
        }).execute()
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not save the event status history. Contact the team."
        ) from error


def get_status_history(event_id: str) -> list[dict]:
    """Return an event's status changes from oldest to newest."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("event_status_history").select("*").eq(
            "event_id", event_id
        ).order("changed_at").execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load the event status history. Contact the team."
        ) from error


def update_event_status(event_id: str, status: str, user_id: int) -> dict:
    """Update status and record the user and time of the latest change."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")

        result = client.table("events").update({
            "status": status,
            "last_status_changed_by": user_id,
            "last_status_changed_at": datetime.now(UTC).isoformat(),
        }).eq("id", event_id).execute()
        if not result.data:
            raise ServiceUnavailable("The database did not confirm the status change.")
        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not update the event status. Contact the team before retrying."
        ) from error


def update_event_fields(event_id: str, fields: dict) -> dict:
    """Update editable content fields on an event and refresh updated_at."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")

        payload = {**fields, "updated_at": datetime.now(UTC).isoformat()}
        result = client.table("events").update(payload).eq("id", event_id).execute()
        if not result.data:
            raise ServiceUnavailable("The database did not confirm the edit.")
        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not save the event edit. Contact the team before retrying."
        ) from error


def log_event_edit(
    event_id: str, editor_id: int, changed_fields: list[str], importance: str
) -> None:
    """Append one immutable edit-audit record (who edited, which fields, importance)."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        client.table("event_edit_log").insert({
            "event_id": event_id,
            "editor_id": editor_id,
            "changed_fields": changed_fields,
            "importance": importance,
        }).execute()
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not save the edit audit record.") from error

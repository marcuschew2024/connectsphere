"""Supabase queries for events. HTTP and validation belong in events.py."""

from datetime import UTC, datetime

from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from .supabase_client import get_supabase_client

# complete_event() database refusals (SCRUM-132), re-checked under the event row lock.
_COMPLETION_CONFLICTS = {
    "already_completed": "This event is already completed.",
    "not_in_preparation": "Only an event in Preparation can be completed.",
    "pending_bookings": "A venue booking is still awaiting approval.",
    "open_equipment_requests": "An equipment request is still awaiting Tech Support.",
}


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
        events = [
            event for event in (result.data or [])
            if event["status"] != "Draft" or event["organiser_id"] == user_id
        ]
        if events:
            pending_ids = get_pending_clarification_event_ids()
            events = [
                event for event in events
                if not (event.get("coordinator_id") == user_id and event["id"] in pending_ids)
            ]
        return events
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load event requests. Contact the team."
        ) from error


def list_safety_review_events(page: int = 1) -> tuple[list[dict], bool]:
    """Bounded queue; no draft or planning details are returned to Safety Officers."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        start = (page - 1) * 25
        rows = (client.table("events")
                .select("id,title,category,event_datetime,status")
                .eq("status", "Confirmed").order("event_datetime").order("id")
                .range(start, start + 25).execute().data or [])
        return rows[:25], len(rows) > 25
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load safety reviews. Please try again.") from error


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
    event_id: str,
    old_status: str | None,
    new_status: str,
    user_id: int,
    action: str | None = None,
    note: str | None = None,
) -> None:
    """Append one immutable status transition record."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        payload = {
            "event_id": event_id,
            "old_status": old_status,
            "new_status": new_status,
            "changed_by": user_id,
        }
        if action is not None:
            payload["action"] = action
        if note is not None:
            payload["note"] = note
        client.table("event_status_history").insert(payload).execute()
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not save the event status history. Contact the team."
        ) from error


def get_status_history(event_id: str) -> list[dict]:
    """Return status changes, including legacy change-request review entries."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("event_status_history").select("*").eq(
            "event_id", event_id
        ).order("changed_at").execute()
        history = result.data or []
        history_actions = {
            row.get("action")
            for row in history
            if row.get("action")
        }
        # Older reviews were persisted before review actions were added to the
        # status-history write path. Only query change requests for events that
        # already have a change-request history entry; this keeps history reads
        # compatible with deployments that predate the SCRUM-46 table.
        if "change_requested" in history_actions:
            change_requests = get_change_requests(event_id)
            for change_request in change_requests:
                status = change_request.get("status")
                if status in {"Under Review", "Approved", "Rejected", "Implemented"}:
                    action = f"change_request_{status.lower().replace(' ', '_')}"
                    if action not in history_actions:
                        history.append({
                            "id": -int(change_request["id"]),
                            "event_id": event_id,
                            "old_status": None,
                            "new_status": "Planning",
                            "changed_by": change_request.get("reviewed_by"),
                            "changed_at": change_request.get("reviewed_at"),
                            "action": action,
                            "note": change_request.get("review_note"),
                        })
        return sorted(history, key=lambda row: row.get("changed_at") or "")
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load the event status history. Contact the team."
        ) from error


def create_clarification(event_id: str, note: str, user_id: int) -> dict:
    """Create one pending clarification request for an event."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("event_clarifications").insert({
            "event_id": event_id,
            "note": note,
            "requested_by": user_id,
            "status": "Pending",
        }).execute()
        if not result.data:
            raise ServiceUnavailable("The database did not confirm the clarification request.")
        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not save the clarification request. Contact the team."
        ) from error


def get_pending_clarification(event_id: str) -> dict | None:
    """Return the current pending clarification, if one exists."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("event_clarifications").select("*").eq(
            "event_id", event_id
        ).eq("status", "Pending").execute()
        return result.data[0] if result.data else None
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load the clarification request. Contact the team."
        ) from error


def get_pending_clarification_event_ids() -> set[str]:
    """Return event IDs currently waiting for organiser clarification."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("event_clarifications").select("event_id").eq(
            "status", "Pending"
        ).execute()
        return {row["event_id"] for row in (result.data or [])}
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load clarification requests. Contact the team."
        ) from error


def mark_clarification_resubmitted(event_id: str, user_id: int) -> dict:
    """Close the pending clarification after the organiser resubmits."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        now = datetime.now(UTC).isoformat()
        result = client.table("event_clarifications").update({
            "status": "Resubmitted",
            "responded_by": user_id,
            "responded_at": now,
        }).eq("event_id", event_id).eq("status", "Pending").execute()
        if not result.data:
            raise ServiceUnavailable("The clarification request may already be resolved.")
        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not record the resubmission. Contact the team."
        ) from error


def create_change_request(event_id: str, user_id: int, description: str) -> dict:
    """Record a change request without changing the event itself."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("event_change_requests").insert({
            "event_id": event_id,
            "requested_by": user_id,
            "description": description,
            "status": "Pending",
        }).execute()
        if not result.data:
            raise ServiceUnavailable("The database did not confirm the change request.")
        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not save the change request. Contact the team."
        ) from error


def get_change_requests(event_id: str) -> list[dict]:
    """Return all change requests for an event, newest first."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("event_change_requests").select("*").eq(
            "event_id", event_id
        ).order("requested_at", desc=True).execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load the event change requests. Contact the team."
        ) from error


def update_change_request(
    event_id: str,
    request_id: int,
    current_status: str,
    status: str,
    reviewer_id: int,
    review_note: str | None,
) -> dict:
    """Record a coordinator review, guarded by event and request identity."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("event_change_requests").update({
            "status": status,
            "reviewed_by": reviewer_id,
            "review_note": review_note,
            "reviewed_at": datetime.now(UTC).isoformat(),
        }).eq("event_id", event_id).eq("id", request_id).eq(
            "status", current_status
        ).execute()
        if not result.data:
            raise Conflict("This change request has already been reviewed.")
        return result.data[0]
    except (Conflict, ServiceUnavailable):
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not update the change request. Contact the team."
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


def list_event_equipment_requests(event_id: str) -> list[dict]:
    """Equipment request statuses for one event, for the completion gate (SCRUM-132)."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("equipment_requests").select("id,status").eq(
            "event_id", event_id
        ).execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load the event's equipment requests. Contact the team."
        ) from error


def complete_event_record(event_id: str, user_id: int, note: str | None) -> dict:
    """Close a delivered event and release its remaining holds in one transaction."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.rpc("complete_event", {
            "p_event_id": event_id, "p_actor_id": user_id, "p_note": note,
        }).execute()
        if not isinstance(result.data, dict) or "event" not in result.data:
            raise ServiceUnavailable("The database did not confirm the completion.")
        return result.data
    except APIError as error:
        if error.code == "PT403":
            raise Forbidden("Only the assigned Coordinator can complete this event.") from error
        if error.code == "PT404":
            raise NotFound("Event not found.") from error
        if error.code == "PT409":
            raise Conflict(_COMPLETION_CONFLICTS.get(
                error.message, "This event cannot be completed. Reload it and try again."
            )) from error
        if error.code == "22023":
            raise BadRequest("Post-event notes must be at most 2000 characters.") from error
        raise ServiceUnavailable(
            "Could not complete the event. Contact the team before retrying."
        ) from error
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not complete the event. Contact the team before retrying."
        ) from error


def record_event_decision(
    event_id: str, status: str, reason: str | None, user_id: int
) -> dict:
    """Record a coordinator decision only while the request is still submitted."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")

        now = datetime.now(UTC).isoformat()
        result = client.table("events").update({
            "status": status,
            "decision_reason": reason,
            "decision_by": user_id,
            "decision_at": now,
            "last_status_changed_by": user_id,
            "last_status_changed_at": now,
        }).eq("id", event_id).eq("status", "Submitted").execute()
        if not result.data:
            raise ServiceUnavailable("The request may already have a decision.")
        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not record the event decision. Contact the team."
        ) from error


def get_notifications_for_user(user_id: int) -> list[dict]:
    """Return the latest 50 messages addressed to this user, newest first."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        return client.table("notifications").select(
            "id,event_id,notification_type,message,created_at,event:events(title)"
        ).eq("recipient_id", user_id).order("created_at", desc=True).order(
            "id", desc=True
        ).limit(50).execute().data
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load notifications. Please try again.") from error


def create_notification(
    recipient_id: int, event_id: str, notification_type: str, message: str
) -> None:
    """Create an in-app notification for a user."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        client.table("notifications").insert({
            "recipient_id": recipient_id,
            "event_id": event_id,
            "notification_type": notification_type,
            "message": message,
        }).execute()
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not create the notification. Contact the team."
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

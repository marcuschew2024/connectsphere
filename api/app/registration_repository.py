"""SCRUM-41 persistence. The database rechecks capacity inside the write transaction."""

from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from .registration_capacity import RegistrationCapacity
from .registration_withdrawal import POLICY_LOCKED
from .supabase_client import get_supabase_client

CONFLICT_MESSAGES = {
    "withdrawal_policy_locked": POLICY_LOCKED,
    "withdrawal_deadline_passed": "The organiser’s withdrawal deadline has passed.",
    "withdrawal_closed": "Withdrawal is only available before an active event starts.",
    "registration_not_open": "Registration has not opened yet.",
    "registration_ended": "Registration has closed.",
    "event_full": "This event is full. No places are currently available.",
    "capacity_not_set": "Registration capacity has not been set. Please check again later.",
    "registration_closed": "Registration is only available for confirmed events.",
    "already_registered": "You are already registered for this event.",
    "capacity_locked": (
        "Set capacity before confirmation. Afterwards, only the first setup of an unset "
        "capacity is allowed."
    ),
    "capacity_below_registrations": "Capacity cannot be lower than the number already registered.",
}


def _rpc(name: str, parameters: dict) -> dict:
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.rpc(name, parameters).execute()
        if not isinstance(result.data, dict):
            raise ServiceUnavailable("The database did not confirm the registration change.")
        return result.data
    except APIError as error:
        if error.code == "PT403":
            raise Forbidden("You do not have permission to perform this action.") from error
        if error.code == "PT404":
            raise NotFound("Event not found.") from error
        if error.code == "PT409":
            raise Conflict(CONFLICT_MESSAGES.get(
                error.message, "Registration changed. Refresh the event before retrying."
            )) from error
        if error.code == "22023":
            if error.message == "invalid_withdrawal_policy":
                raise BadRequest("Check the withdrawal conditions and deadline.") from error
            if error.message == "registration_information_required":
                raise BadRequest("Provide the required registration information.") from error
            if error.message == "registration_information_too_long":
                raise BadRequest(
                    "Use at most 4,000 characters for registration information."
                ) from error
            raise BadRequest("Enter a whole number between 1 and 10,000.") from error
        raise ServiceUnavailable(
            "Could not confirm the registration change. Refresh the event before retrying."
        ) from error
    except (BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable):
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not confirm the registration change. Refresh the event before retrying."
        ) from error


def capacity_for_event(event: dict) -> RegistrationCapacity:
    return RegistrationCapacity(
        event.get("registration_capacity"), event.get("registered_count", 0),
    )


def set_registration_capacity(event_id: str, actor_id: int, capacity: int) -> dict:
    return _rpc("set_registration_capacity", {
        "p_event_id": event_id, "p_actor_id": actor_id, "p_capacity": capacity,
    })


def register_attendee(event_id: str, attendee_id: int, information: str | None = None) -> dict:
    if information is not None:
        return _rpc("register_event_attendee_with_information", {
            "p_event_id": event_id, "p_attendee_id": attendee_id,
            "p_information": information,
        })
    return _rpc("register_event_attendee", {
        "p_event_id": event_id, "p_attendee_id": attendee_id,
    })


def list_registration_events(page: int) -> tuple[list[dict], bool]:
    """Only confirmed events; bounded discovery does not grant planning access."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        start = (page - 1) * 25
        rows = (client.table("events").select(
            "id,reference,title,description,category,event_datetime,status,registration_requirements,"
            "registration_capacity,registered_count,registration_opens_at,registration_closes_at,"
            "withdrawal_closes_at"
        ).eq("status", "Confirmed").order("event_datetime").order("id")
            .range(start, start + 25).execute().data or [])
        return rows[:25], len(rows) > 25
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load events. Please try again.") from error


def get_own_registration(event_id: str, attendee_id: int) -> dict | None:
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        rows = (client.table("event_registrations")
                .select("id,reference,event_id,status,registered_at,withdrawn_at")
                .eq("event_id", event_id).eq("attendee_id", attendee_id)
                .limit(1).execute().data or [])
        return rows[0] if rows else None
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not check your registration. Please try again.") from error


def list_own_registrations(attendee_id: int, page: int) -> tuple[list[dict], bool]:
    """Read current rows, not confirmation messages; scope before pagination."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        start = (page - 1) * 25
        rows = (client.table("event_registrations").select(
            "id,reference,event_id,status,registered_at,withdrawn_at,"
            "event:events(id,reference,title,category,event_datetime,status)"
        ).eq("attendee_id", attendee_id).order("registered_at", desc=True).order("id")
            .range(start, start + 25).execute().data or [])
        return rows[:25], len(rows) > 25
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load your registrations. Please try again.") from error


# SCRUM-155: a registered attendee is also told when the event is cancelled (S1 Q20, D41).
ATTENDEE_NOTICE_TYPES = ["registration_confirmed", "registration_withdrawn", "event_cancelled"]


def get_registration_confirmations(attendee_id: int) -> list[dict]:
    """Never include organiser decisions, even if an account's role changes."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        return (client.table("notifications")
                .select("id,event_id,notification_type,message,created_at,event:events(title)")
                .eq("recipient_id", attendee_id).in_(
                    "notification_type", ATTENDEE_NOTICE_TYPES)
                .order("created_at", desc=True).limit(50).execute().data or [])
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load registration confirmations. Please try again."
        ) from error


def list_event_registrations(event_id: str, page: int, status: str | None) -> dict:
    """Bounded roster plus exact event-wide counts, independent of the selected page."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        # Only a display name is needed to identify a signup. Never select credentials,
        # contact details or the attendee's free-text registration information.
        query = client.table("event_registrations").select(
            "id,reference,status,registered_at,withdrawn_at,attendee:app_users(display_name)"
        ).eq("event_id", event_id)
        if status is not None:
            query = query.eq("status", status)
        start = (page - 1) * 25
        rows = (query.order("registered_at", desc=True).order("id")
                .range(start, start + 25).execute().data or [])
        counts = {}
        for state in ("Registered", "Waitlisted", "Withdrawn"):
            count = (client.table("event_registrations").select("id", count="exact")
                     .eq("event_id", event_id).eq("status", state).limit(0).execute().count)
            if not isinstance(count, int) or count < 0:
                raise ServiceUnavailable("Could not load registration counts. Please try again.")
            counts[f"{state.lower()}_count"] = count
        return {"registrations": rows[:25], "page": page,
                "has_more": len(rows) > 25, "counts": counts}
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load event registrations. Please try again.") from error


def withdraw_attendee(event_id: str, attendee_id: int) -> dict:
    return _rpc("withdraw_event_attendee", {
        "p_event_id": event_id, "p_attendee_id": attendee_id,
    })


def get_withdrawal_policy(event_id: str, actor_id: int) -> dict:
    return _rpc("get_event_withdrawal_policy", {
        "p_event_id": event_id, "p_actor_id": actor_id,
    })


def set_withdrawal_policy(event_id: str, actor_id: int, closes_at: str | None) -> dict:
    return _rpc("set_event_withdrawal_policy", {
        "p_event_id": event_id, "p_actor_id": actor_id,
        "p_closes_at": closes_at,
    })

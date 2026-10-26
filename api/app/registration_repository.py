"""SCRUM-41 persistence. The database rechecks capacity inside the write transaction."""

from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from .registration_capacity import RegistrationCapacity
from .supabase_client import get_supabase_client

CONFLICT_MESSAGES = {
    "event_full": "This event is full. No places are currently available.",
    "capacity_not_set": "Registration capacity has not been set. Please check again later.",
    "registration_closed": "Registration is only available for confirmed events.",
    "already_registered": "You are already registered for this event.",
    "capacity_locked": "Capacity can only be changed before the event is confirmed.",
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
            raise BadRequest("Enter a whole number between 1 and 2,147,483,647.") from error
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


def register_attendee(event_id: str, attendee_id: int) -> dict:
    return _rpc("register_event_attendee", {
        "p_event_id": event_id, "p_attendee_id": attendee_id,
    })

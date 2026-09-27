"""Persistence for venue booking requests (SCRUM-31)."""

from datetime import UTC, datetime

from werkzeug.exceptions import Conflict, ServiceUnavailable

from .supabase_client import get_supabase_client


def _client():
    client = get_supabase_client()
    if client is None:
        raise ServiceUnavailable("The database is not configured. Contact the team.")
    return client


def find_overlapping_bookings(venue_id: str, start_at: str, end_at: str) -> list[dict]:
    """Find confirmed or blocked bookings whose half-open slots overlap the request."""
    try:
        result = _client().table("venue_bookings").select(
            "id,venue_id,start_at,end_at,status"
        ).eq("venue_id", venue_id).in_("status", ["Confirmed", "Blocked"]).lt(
            "start_at", end_at
        ).gt("end_at", start_at).execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not check venue availability. Contact the team.") from error


def create_booking(fields: dict, actor_id: int) -> dict:
    """Insert a requested booking with server-owned actor and timestamp fields."""
    try:
        result = _client().table("venue_bookings").insert({
            **fields,
            "status": "Requested",
            "requested_by": actor_id,
            "requested_at": datetime.now(UTC).isoformat(),
        }).execute()
        if not result.data:
            raise ServiceUnavailable("The database did not confirm the booking request.")
        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        if getattr(error, "code", None) in {"23P01", "23505"}:
            raise Conflict("The venue is no longer available for that time slot.") from error
        raise ServiceUnavailable("Could not save the booking request. Contact the team.") from error


def list_requested_bookings() -> list[dict]:
    try:
        result = _client().table("venue_bookings").select(
            "*,venue:venues(name,location),event:events(title,event_datetime,expected_attendance)"
        ).eq("status", "Requested").order("requested_at", desc=True).execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load booking requests. Contact the team.") from error


def get_booking(booking_id: str) -> dict | None:
    try:
        result = _client().table("venue_bookings").select(
            "*,venue:venues(name,location),event:events(title,event_datetime,expected_attendance)"
        ).eq("id", booking_id).execute()
        return result.data[0] if result.data else None
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load the booking request. Contact the team.") from error

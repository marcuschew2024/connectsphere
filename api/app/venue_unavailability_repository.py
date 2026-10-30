"""Persistence for SCRUM-60 venue unavailability blocks."""

from datetime import UTC, datetime

from werkzeug.exceptions import Conflict, ServiceUnavailable

from .supabase_client import get_supabase_client
from .venue_unavailability import ACTIVE_BOOKING_STATUSES


def _client():
    client = get_supabase_client()
    if client is None:
        raise ServiceUnavailable("The database is not configured. Contact the team.")
    return client


def create_unavailability(venue_id: str, fields: dict, actor_id: int) -> dict:
    try:
        result = _client().table("venue_unavailability").insert({
            **fields,
            "venue_id": venue_id,
            "created_by": actor_id,
            "created_at": datetime.now(UTC).isoformat(),
        }).execute()
        if not result.data:
            raise ServiceUnavailable("The venue block could not be saved.")
        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not save the venue block. Contact the team.") from error


def list_unavailability(
    venue_id: str,
    start_at: str | None = None,
    end_at: str | None = None,
) -> list[dict]:
    try:
        query = _client().table("venue_unavailability").select(
            "id,venue_id,start_at,end_at,reason,note,status,created_by,created_at"
        ).eq("venue_id", venue_id).eq("status", "Active").order("start_at")
        if start_at and end_at:
            query = query.lt("start_at", end_at)
        if start_at and end_at:
            query = query.gt("end_at", start_at)
        return query.execute().data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load venue blocks. Contact the team.") from error


def unblock_venue(block_id: str, venue_id: str, actor_id: int) -> dict:
    try:
        now = datetime.now(UTC).isoformat()
        result = _client().table("venue_unavailability").update({
            "status": "Unblocked",
            "unblocked_by": actor_id,
            "unblocked_at": now,
        }).eq("id", block_id).eq("venue_id", venue_id).eq("status", "Active").execute()
        if not result.data:
            raise Conflict("This venue block is already inactive or was not found.")
        return result.data[0]
    except (Conflict, ServiceUnavailable):
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not unblock the venue. Contact the team.") from error


def find_affected_bookings(venue_id: str, start_at: str, end_at: str) -> list[dict]:
    try:
        result = _client().table("venue_bookings").select(
            "id,event_id,start_at,end_at,status,requested_by,"
            "event:events(title,coordinator_id)"
        ).eq("venue_id", venue_id).in_("status", sorted(ACTIVE_BOOKING_STATUSES)).lt(
            "start_at", end_at
        ).gt("end_at", start_at).execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not identify affected bookings. Contact the team."
        ) from error

"""Persistence for venue booking requests (SCRUM-31)."""

from datetime import UTC, datetime

from werkzeug.exceptions import Conflict, ServiceUnavailable

from .supabase_client import get_supabase_client


def _client():
    client = get_supabase_client()
    if client is None:
        raise ServiceUnavailable("The database is not configured. Contact the team.")
    return client


def find_overlapping_bookings(
    venue_id: str,
    start_at: str,
    end_at: str,
    buffer_window_minutes: int = 0,
) -> list[dict]:
    """Find active booking states whose slots overlap the request (expanded for buffers)."""
    try:
        query_start = start_at
        query_end = end_at
        if buffer_window_minutes > 0:
            from datetime import timedelta
            s_dt = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
            e_dt = datetime.fromisoformat(end_at.replace("Z", "+00:00"))
            query_start = (s_dt - timedelta(minutes=buffer_window_minutes)).isoformat()
            query_end = (e_dt + timedelta(minutes=buffer_window_minutes)).isoformat()

        result = _client().table("venue_bookings").select(
            "id,venue_id,start_at,end_at,status,expires_at,requested_at"
        ).eq("venue_id", venue_id).in_("status", [
            "Confirmed", "Blocked", "Requested", "Pending", "Held",
        ]).lt(
            "start_at", query_end
        ).gt("end_at", query_start).execute()
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
            "*,venue:venues(reference,name,location),event:events(reference,title,event_datetime,expected_attendance)"
        ).eq("status", "Requested").order("requested_at", desc=True).execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load booking requests. Contact the team.") from error


def get_booking(booking_id: str) -> dict | None:
    try:
        result = _client().table("venue_bookings").select(
            "*,venue:venues(reference,name,location),event:events(reference,title,event_datetime,expected_attendance)"
        ).eq("id", booking_id).execute()
        return result.data[0] if result.data else None
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load the booking request. Contact the team.") from error


def list_bookings_for_event_detail(event_id: str) -> list[dict]:
    """Return every venue arrangement belonging to one event."""
    try:
        result = _client().table("venue_bookings").select(
            "*,venue:venues(reference,name,location,capacity),"
            "event:events(reference,title,event_datetime,expected_attendance)"
        ).eq("event_id", event_id).order("requested_at").execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load the event's venue bookings. Contact the team."
        ) from error


def update_requested_booking(booking_id: str, fields: dict, user_id: int) -> dict:
    """Change only one Coordinator-owned Requested booking."""
    try:
        result = _client().table("venue_bookings").update({
            **fields,
            "updated_at": datetime.now(UTC).isoformat(),
            "last_changed_by": user_id,
            "last_changed_at": datetime.now(UTC).isoformat(),
        }).eq("id", booking_id).eq("requested_by", user_id).eq(
            "status", "Requested"
        ).execute()
        if not result.data:
            raise Conflict("Only your Requested booking can be changed.")
        return result.data[0]
    except (Conflict, ServiceUnavailable):
        raise
    except Exception as error:
        if getattr(error, "code", None) in {"23P01", "23505"}:
            raise Conflict("The venue is no longer available for that time slot.") from error
        raise ServiceUnavailable(
            "Could not change the booking request. Contact the team."
        ) from error


def cancel_booking(booking_id: str, user_id: int) -> dict:
    """Cancel one Coordinator-owned booking without touching sibling bookings."""
    try:
        result = _client().table("venue_bookings").update({
            "status": "Cancelled",
            "updated_at": datetime.now(UTC).isoformat(),
            "last_changed_by": user_id,
            "last_changed_at": datetime.now(UTC).isoformat(),
        }).eq("id", booking_id).eq("requested_by", user_id).in_(
            "status", ["Requested", "Confirmed"]
        ).execute()
        if not result.data:
            raise Conflict("Only your Requested or Confirmed booking can be cancelled.")
        return result.data[0]
    except (Conflict, ServiceUnavailable):
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not cancel the booking. Contact the team.") from error


def list_bookings_for_event(event_id: str) -> list[dict]:
    """All venue bookings for one event (any status), for the confirmation gate (SCRUM-39)."""
    try:
        result = _client().table("venue_bookings").select(
            "id,venue_id,status"
        ).eq("event_id", event_id).execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load the event's venue bookings. Contact the team."
        ) from error


def record_booking_decision(
    booking_id: str,
    status: str,
    reason: str | None,
    alternative: str | None,
    user_id: int,
    expires_at: str | None = None,
) -> dict:
    """Record a Venue Staff decision while the booking still awaits one (SCRUM-32).

    The ``status in (Requested, Pending)`` guard makes the write idempotent: an
    already-decided booking matches no rows (409). Approving to 'Confirmed' can trip the
    EXCLUDE overlap constraint (23P01) if the slot is now taken -> surfaced as a 409.
    """
    try:
        now = datetime.now(UTC).isoformat()
        payload = {
            "status": status,
            "decision_reason": reason,
            "suggested_alternative": alternative,
            "decided_by": user_id,
            "decision_at": now,
        }
        if expires_at is not None:
            payload["expires_at"] = expires_at
        result = _client().table("venue_bookings").update(payload).eq(
            "id", booking_id
        ).in_("status", ["Requested", "Pending", "Held"]).execute()
        if not result.data:
            raise Conflict("This booking has already been decided.")
        return result.data[0]
    except (Conflict, ServiceUnavailable):
        raise
    except Exception as error:
        if getattr(error, "code", None) in {"23P01", "23505"}:
            raise Conflict("The venue is no longer available for that time slot.") from error
        raise ServiceUnavailable(
            "Could not record the booking decision. Contact the team."
        ) from error


def list_venue_bookings_in_range(venue_id: str, start_at: str, end_at: str) -> list[dict]:
    """Bookings for one venue overlapping [start_at, end_at): confirmed, requested, blocked.

    Powers the availability calendar (SCRUM-30). Half-open overlap via start < to and end > from.
    """
    try:
        result = _client().table("venue_bookings").select(
            "id,venue_id,start_at,end_at,status"
        ).eq("venue_id", venue_id).in_(
            "status", ["Confirmed", "Requested", "Blocked"]
        ).lt("start_at", end_at).gt("end_at", start_at).execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load venue bookings. Contact the team.") from error

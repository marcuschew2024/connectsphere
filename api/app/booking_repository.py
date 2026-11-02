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
    setup_minutes: int | None = None,
    turnaround_minutes: int | None = None,
) -> list[dict]:
    """Find active booking states whose slots overlap the request (expanded for buffers)."""
    try:
        query_start = start_at
        query_end = end_at
        if setup_minutes is not None or turnaround_minutes is not None:
            from datetime import timedelta
            s_dt = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
            e_dt = datetime.fromisoformat(end_at.replace("Z", "+00:00"))
            setup = max(0, setup_minutes if setup_minutes is not None else 0)
            turnaround = max(0, turnaround_minutes if turnaround_minutes is not None else 0)
            query_start = (s_dt - timedelta(minutes=setup + turnaround)).isoformat()
            query_end = (e_dt + timedelta(minutes=setup + turnaround)).isoformat()
        elif buffer_window_minutes > 0:
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
    """Bookings still awaiting a Venue Staff decision.

    SCRUM-79: a tentatively Held booking is still undecided — staff must be able to
    approve or reject it before its deadline — so it belongs in this queue alongside
    Requested ones.
    """
    try:
        result = _client().table("venue_bookings").select(
            "*,venue:venues(reference,name,location),event:events(reference,title,event_datetime,expected_attendance)"
        ).in_("status", ["Requested", "Held"]).order("requested_at", desc=True).execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load booking requests. Contact the team.") from error


def get_booking(booking_id: str) -> dict | None:
    """One booking with its venue and event.

    The event embed carries `coordinator_id` because booking management follows the
    event's *current* Coordinator, not whoever first requested it (SCRUM-21/130).
    """
    try:
        result = _client().table("venue_bookings").select(
            "*,venue:venues(reference,name,location),"
            "event:events(reference,title,event_datetime,expected_attendance,coordinator_id)"
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
    """Change one Requested booking.

    Authority is the route's business: it checks the acting user is the event's current
    Coordinator (SCRUM-21/130), so this filters on state only. `last_changed_by` records
    who made the change.
    """
    try:
        result = _client().table("venue_bookings").update({
            **fields,
            "updated_at": datetime.now(UTC).isoformat(),
            "last_changed_by": user_id,
            "last_changed_at": datetime.now(UTC).isoformat(),
        }).eq("id", booking_id).eq(
            "status", "Requested"
        ).execute()
        if not result.data:
            raise Conflict("Only a Requested booking can be changed.")
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
    """Cancel one booking without touching sibling bookings.

    As with `update_requested_booking`, the route owns authority (the event's current
    Coordinator, SCRUM-21/130) and this filters on cancellable state only.
    """
    try:
        result = _client().table("venue_bookings").update({
            "status": "Cancelled",
            "updated_at": datetime.now(UTC).isoformat(),
            "last_changed_by": user_id,
            "last_changed_at": datetime.now(UTC).isoformat(),
        }).eq("id", booking_id).in_(
            "status", ["Requested", "Confirmed"]
        ).execute()
        if not result.data:
            raise Conflict("Only a Requested or Confirmed booking can be cancelled.")
        return result.data[0]
    except (Conflict, ServiceUnavailable):
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not cancel the booking. Contact the team.") from error


def list_bookings_for_event(event_id: str) -> list[dict]:
    """All venue bookings for one event (any status), for the confirmation gate (SCRUM-39).

    start_at/end_at are included so the gate can check a booking's slot still covers
    the event's date/time after a reschedule (SCRUM-159).
    """
    try:
        result = _client().table("venue_bookings").select(
            "id,venue_id,status,start_at,end_at"
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
    clear_expiry: bool = False,
) -> dict:
    """Record a Venue Staff decision while the booking still awaits one (SCRUM-32).

    The ``status in (Requested, Pending, Held)`` guard makes the write idempotent: an
    already-decided booking matches no rows (409). Approving to 'Confirmed' can trip the
    EXCLUDE overlap constraint (23P01) if the slot is now taken -> surfaced as a 409.

    SCRUM-79: ``clear_expiry`` drops the hold deadline when a held booking is approved,
    so a confirmed slot never carries an expiry that outlived the decision.
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
        if clear_expiry:
            payload["expires_at"] = None
        elif expires_at is not None:
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


def list_venue_bookings_in_range(
    venue_id: str,
    start_at: str,
    end_at: str,
    setup_minutes: int = 0,
    turnaround_minutes: int = 0,
) -> list[dict]:
    """Bookings for one venue overlapping [start_at, end_at): confirmed, requested, blocked.

    Powers the availability calendar (SCRUM-30). Half-open overlap via start < to and end > from.
    """
    try:
        buffer_minutes = max(0, setup_minutes) + max(0, turnaround_minutes)
        if buffer_minutes:
            s_dt = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
            e_dt = datetime.fromisoformat(end_at.replace("Z", "+00:00"))
            from datetime import timedelta
            start_at = (s_dt - timedelta(minutes=buffer_minutes)).isoformat()
            end_at = (e_dt + timedelta(minutes=buffer_minutes)).isoformat()
        result = _client().table("venue_bookings").select(
            "id,venue_id,start_at,end_at,status,occupied_start,occupied_end,expires_at"
        ).eq("venue_id", venue_id).in_(
            # SCRUM-79: a tentative hold occupies the slot, so the calendar must show it.
            "status", ["Confirmed", "Requested", "Pending", "Held", "Blocked"]
        ).lt("start_at", end_at).gt("end_at", start_at).execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load venue bookings. Contact the team.") from error


def expire_holds(venue_id: str | None = None, as_of: str | None = None) -> list[dict]:
    """Flip every tentative hold past its deadline to 'Expired' (SCRUM-79).

    The row is kept, not deleted: an expired hold is part of the venue's history and the
    audit trail (S1 Q23). 'Expired' sits outside every exclusion-constraint predicate, so
    the slot becomes requestable again at the database layer as well as in the engine.
    Returns the rows it released, so the caller can notify their Coordinators.
    """
    try:
        moment = as_of or datetime.now(UTC).isoformat()
        query = _client().table("venue_bookings").update({
            "status": "Expired",
            "updated_at": moment,
        }).eq("status", "Held").lte("expires_at", moment)
        if venue_id is not None:
            query = query.eq("venue_id", venue_id)
        return [row for row in (query.execute().data or []) if isinstance(row, dict)]
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not release expired venue holds. Contact the team."
        ) from error


def list_active_bookings_for_venue(venue_id: str) -> list[dict]:
    """Every slot-holding booking for one venue, for the buffer conflict report (SCRUM-129).

    Status is unfiltered by date: raising a venue's buffers can make any pair of its
    existing bookings conflict, so the report considers all of them.
    """
    try:
        result = _client().table("venue_bookings").select(
            "id,reference,venue_id,event_id,start_at,end_at,status,expires_at,"
            "event:events(reference,title)"
        ).eq("venue_id", venue_id).in_(
            "status", ["Confirmed", "Blocked", "Requested", "Pending", "Held"]
        ).order("start_at").execute()
        return result.data or []
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load this venue's bookings. Contact the team."
        ) from error

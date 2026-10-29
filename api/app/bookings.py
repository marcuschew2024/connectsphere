"""Coordinator venue booking requests and Venue Staff review queue (SCRUM-31)."""

from datetime import UTC, datetime

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, HTTPException, NotFound

from .acting_user import require_acting_user
from .booking_decision import BookingDecision
from .booking_repository import (
    cancel_booking,
    create_booking,
    find_overlapping_bookings,
    get_booking,
    list_bookings_for_event_detail,
    list_requested_bookings,
    record_booking_decision,
    update_requested_booking,
)
from .event_repository import create_notification, get_event_by_id
from .rbac import require_related_user, require_role
from .supabase_client import get_supabase_client
from .venue_overlap import OverlapEngine
from .venue_repository import get_venue

bookings = Blueprint("bookings", __name__, url_prefix="/venues/bookings")

BOOKING_TEXT_LIMITS = {
    "layout": 100,
    "special_requirements": 2000,
}


def _validated_booking_fields(data, event: dict, existing: dict | None = None) -> dict:
    """Validate one booking payload for both create and independent change operations."""
    if not isinstance(data, dict):
        raise BadRequest("Send booking details as a JSON object.")
    source = existing or {}
    venue_id = data.get("venue_id", source.get("venue_id"))
    venue = get_venue(venue_id) if isinstance(venue_id, str) else None
    if venue is None:
        raise BadRequest("Choose a valid venue.")
    start_value = data.get("start_at", source.get("start_at"))
    end_value = data.get("end_at", source.get("end_at"))
    try:
        start = datetime.fromisoformat(start_value).astimezone(UTC)
        end = datetime.fromisoformat(end_value).astimezone(UTC)
    except (TypeError, ValueError, OverflowError):
        raise BadRequest("Enter valid start and end times including a time zone.") from None
    if end <= start:
        raise BadRequest("The booking end time must be after the start time.")
    if start < datetime.now(UTC):
        raise BadRequest("The booking cannot start in the past.")
    attendance = data.get(
        "expected_attendance",
        source.get("expected_attendance", event.get("expected_attendance")),
    )
    if type(attendance) is not int or not 1 <= attendance <= 2_147_483_647:
        raise BadRequest("Enter a positive whole-number attendance.")
    if attendance > venue["capacity"]:
        raise BadRequest(
            f"Expected attendance cannot exceed this venue's capacity of {venue['capacity']}."
        )
    layout = data.get("layout", source.get("layout"))
    if not isinstance(layout, str) or not layout.strip() or len(layout.strip()) > 100:
        raise BadRequest("Choose a layout of 1 to 100 characters.")
    special = data.get("special_requirements", source.get("special_requirements") or "")
    if not isinstance(special, str) or len(special.strip()) > 2000:
        raise BadRequest("Special requirements must be 2000 characters or fewer.")

    setup_m = int(venue.get("setup_time_minutes") or 0)
    turnaround_m = int(venue.get("turnaround_time_minutes") or 0)
    buffer_window = setup_m + turnaround_m

    conflicts = find_overlapping_bookings(
        venue_id, start.isoformat(), end.isoformat(), buffer_window_minutes=buffer_window
    )
    overlap = OverlapEngine().evaluate(
        venue_id, start, end, conflicts,
        exclude_booking_id=source.get("id"),
        setup_minutes=setup_m,
        turnaround_minutes=turnaround_m,
    )
    if not overlap.can_request:
        if overlap.hard_conflict is not None:
            raise Conflict("The venue is already confirmed or blocked for that time slot.")
        raise Conflict("The venue already has a tentative booking hold for that time slot.")
    return {
        "venue_id": venue_id,
        "start_at": start.isoformat(),
        "end_at": end.isoformat(),
        "expected_attendance": attendance,
        "layout": layout.strip(),
        "special_requirements": special.strip() or None,
    }


def _origin_check():
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")


def _venue_staff_ids() -> list[int]:
    client = get_supabase_client()
    if client is None:
        return []
    result = client.table("app_users").select("id").eq("role", "Venue Staff").execute()
    return [row["id"] for row in (result.data or [])]


@bookings.after_request
def prevent_caching(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@bookings.errorhandler(HTTPException)
def json_error(error):
    return jsonify({"error": error.description}), error.code


@bookings.post("")
def submit_booking():
    _origin_check()
    user = require_acting_user()
    require_role(user, "Coordinator", action="submit_venue_booking")
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadRequest("Send booking details as a JSON object.")
    allowed = {"event_id", "venue_id", "start_at", "end_at", "expected_attendance",
               "layout", "special_requirements"}
    if set(data) - allowed:
        raise BadRequest("The request contains unsupported fields.")

    event_id = data.get("event_id")
    event = get_event_by_id(event_id) if isinstance(event_id, str) else None
    if event is None:
        raise BadRequest("Choose a valid event.")
    require_related_user(user, event, action="submit_venue_booking")
    if event.get("status") != "Planning":
        raise Conflict("A venue can only be requested for an event in Planning.")

    venue_id = data.get("venue_id")
    if not isinstance(venue_id, str) or not venue_id.strip():
        raise BadRequest("Choose a venue.")
    venue = get_venue(venue_id)
    if venue is None:
        raise BadRequest("Choose a valid venue.")
    start_at, end_at = data.get("start_at"), data.get("end_at")
    try:
        start = datetime.fromisoformat(start_at).astimezone(UTC)
        end = datetime.fromisoformat(end_at).astimezone(UTC)
    except (TypeError, ValueError, OverflowError):
        raise BadRequest("Enter valid start and end times including a time zone.") from None
    if end <= start:
        raise BadRequest("The booking end time must be after the start time.")
    if start < datetime.now(UTC):
        raise BadRequest("The booking cannot start in the past.")

    attendance = data.get("expected_attendance", event.get("expected_attendance"))
    if type(attendance) is not int or not 1 <= attendance <= 2_147_483_647:
        raise BadRequest("Enter a positive whole-number attendance.")
    if attendance > venue["capacity"]:
        raise BadRequest(
            f"Expected attendance cannot exceed this venue's capacity of {venue['capacity']}."
        )
    layout = data.get("layout")
    if not isinstance(layout, str) or not layout.strip() or len(layout.strip()) > 100:
        raise BadRequest("Choose a layout of 1 to 100 characters.")
    special = data.get("special_requirements") or ""
    if not isinstance(special, str) or len(special.strip()) > 2000:
        raise BadRequest("Special requirements must be 2000 characters or fewer.")

    setup_m = int(venue.get("setup_time_minutes") or 0)
    turnaround_m = int(venue.get("turnaround_time_minutes") or 0)
    buffer_window = setup_m + turnaround_m

    overlap = OverlapEngine().evaluate(
        venue_id,
        start,
        end,
        find_overlapping_bookings(
            venue_id, start.isoformat(), end.isoformat(), buffer_window_minutes=buffer_window
        ),
        setup_minutes=setup_m,
        turnaround_minutes=turnaround_m,
    )
    if not overlap.can_request:
        if overlap.hard_conflict is not None:
            raise Conflict("The venue is already confirmed or blocked for that time slot.")
        raise Conflict("The venue already has a tentative booking hold for that time slot.")

    saved = create_booking({
        "event_id": event_id,
        "venue_id": venue_id,
        "start_at": start.isoformat(),
        "end_at": end.isoformat(),
        "expected_attendance": attendance,
        "layout": layout.strip(),
        "special_requirements": special.strip() or None,
    }, user["id"])
    for staff_id in _venue_staff_ids():
        create_notification(
            staff_id, event_id, "venue_booking_requested",
            f"Venue booking requested for {event.get('title') or 'an event'}.",
        )
    return jsonify({"booking": saved}), 201


@bookings.get("")
def requested_queue():
    _origin_check()
    user = require_acting_user()
    require_role(user, "Venue Staff", action="view_venue_booking_queue")
    return jsonify({"bookings": list_requested_bookings()}), 200


@bookings.get("/<booking_id>")
def booking_detail(booking_id):
    _origin_check()
    user = require_acting_user()
    booking = get_booking(booking_id)
    if booking is None:
        raise NotFound("Booking request not found.")
    event = get_event_by_id(booking["event_id"])
    if user.get("role") == "Venue Staff":
        require_role(user, "Venue Staff", action="view_venue_booking")
    else:
        require_role(user, "Coordinator", action="view_venue_booking")
        require_related_user(user, event or booking, action="view_venue_booking")
    return jsonify({"booking": booking}), 200


@bookings.get("/event/<event_id>")
def event_bookings(event_id):
    """Return all venue arrangements for an event to its related internal users."""
    _origin_check()
    user = require_acting_user()
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")
    if user.get("role") != "Venue Staff":
        require_role(user, "Coordinator", "Organiser", action="view_event_bookings")
        require_related_user(user, event, action="view_event_bookings")
    else:
        require_role(user, "Venue Staff", action="view_event_bookings")
    return jsonify({"bookings": list_bookings_for_event_detail(event_id)}), 200


@bookings.patch("/<booking_id>")
def change_booking(booking_id):
    """Change one Requested booking; sibling bookings and the event are untouched."""
    _origin_check()
    user = require_acting_user()
    require_role(user, "Coordinator", action="change_venue_booking")
    booking = get_booking(booking_id)
    if booking is None:
        raise NotFound("Booking request not found.")
    if booking.get("requested_by") != user["id"] or booking.get("status") != "Requested":
        raise Conflict("Only your Requested booking can be changed.")
    event = get_event_by_id(booking["event_id"])
    if event is None:
        raise NotFound("Event not found.")
    data = request.get_json(silent=True)
    fields = _validated_booking_fields(data, event, booking)
    return jsonify({"booking": update_requested_booking(booking_id, fields, user["id"])}), 200


@bookings.post("/<booking_id>/cancel")
def cancel_one_booking(booking_id):
    """Cancel one booking arrangement without removing the event or its siblings."""
    _origin_check()
    user = require_acting_user()
    require_role(user, "Coordinator", action="cancel_venue_booking")
    booking = get_booking(booking_id)
    if booking is None:
        raise NotFound("Booking request not found.")
    event = get_event_by_id(booking["event_id"]) if booking.get("event_id") else None
    if event and event.get("status") == "Completed":
        # SCRUM-132: a completed event's bookings are part of its closed record.
        raise Conflict("This event is completed and closed. Its bookings are read-only.")
    return jsonify({"booking": cancel_booking(booking_id, user["id"])}), 200


@bookings.post("/<booking_id>/decision")
def decide_booking(booking_id):
    """Approve or reject a submitted booking request as Venue Staff (SCRUM-32)."""
    _origin_check()
    user = require_acting_user()
    require_role(user, "Venue Staff", action="decide_venue_booking")

    booking = get_booking(booking_id)
    if booking is None:
        raise NotFound("Booking request not found.")
    if booking.get("status") not in ("Requested", "Pending"):
        raise Conflict("This booking has already been decided.")

    try:
        decision = BookingDecision.from_payload(request.get_json(silent=True))
    except ValueError as error:
        raise BadRequest(str(error)) from error

    # Confirmed decisions hard-block only published-slot conflicts. A stale tentative
    # hold does not beat a confirmed booking (FCFS); the database remains the backstop.
    if decision.status == "Confirmed":
        venue = get_venue(booking["venue_id"]) or {}
        setup_m = int(venue.get("setup_time_minutes") or 0)
        turnaround_m = int(venue.get("turnaround_time_minutes") or 0)
        buffer_window = setup_m + turnaround_m

        overlap = OverlapEngine().evaluate(
            booking["venue_id"],
            booking["start_at"],
            booking["end_at"],
            find_overlapping_bookings(
                booking["venue_id"],
                booking["start_at"],
                booking["end_at"],
                buffer_window_minutes=buffer_window,
            ),
            exclude_booking_id=booking_id,
            setup_minutes=setup_m,
            turnaround_minutes=turnaround_m,
        )
        if not overlap.can_confirm:
            raise Conflict("The venue is already confirmed or blocked for that time slot.")

    updated = record_booking_decision(
        booking_id, decision.status, decision.reason, decision.alternative, user["id"],
    )

    # Notify the Coordinator who requested the booking.
    if decision.is_rejection:
        message = f"Your venue booking was rejected: {decision.reason}"
        if decision.alternative:
            message += f" Suggested alternative: {decision.alternative}"
        create_notification(
            booking["requested_by"], booking["event_id"], "booking_rejected", message,
        )
    else:
        create_notification(
            booking["requested_by"], booking["event_id"], "booking_approved",
            "Your venue booking was approved and the slot is now confirmed.",
        )
    return jsonify({"booking": updated}), 200

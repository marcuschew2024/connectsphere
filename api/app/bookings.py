"""Coordinator venue booking requests and Venue Staff review queue (SCRUM-31)."""

from datetime import UTC, datetime

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, HTTPException, NotFound

from .acting_user import require_acting_user
from .booking_repository import (
    create_booking,
    find_overlapping_bookings,
    get_booking,
    list_requested_bookings,
)
from .event_repository import create_notification, get_event_by_id
from .rbac import require_related_user, require_role
from .supabase_client import get_supabase_client
from .venue_repository import get_venue

bookings = Blueprint("bookings", __name__, url_prefix="/venues/bookings")

BOOKING_TEXT_LIMITS = {
    "layout": 100,
    "special_requirements": 2000,
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

    if find_overlapping_bookings(venue_id, start.isoformat(), end.isoformat()):
        raise Conflict("The venue is already confirmed or blocked for that time slot.")

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

"""Venue Staff create venues; Venue Staff and Coordinators read the catalogue."""

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import BadRequest, Forbidden, HTTPException, NotFound, Unauthorized

from .acting_user import get_acting_user
from .auth import get_authenticated_user
from .booking_repository import list_venue_bookings_in_range
from .event_repository import get_event_by_id
from .rbac import require_role
from .venue_repository import create_venue, get_venue, list_venues
from .venue_suitability import SuitabilityEngine
from .venue_validation import FIELDS, validate_venue

venues = Blueprint("venues", __name__, url_prefix="/venues")


@venues.after_request
def prevent_caching(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@venues.errorhandler(HTTPException)
def json_error(error):
    return jsonify({"error": error.description}), error.code


def _require_user(*roles):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    # Match /session's identity precedence, supporting login and the local demo.
    user = get_authenticated_user() or get_acting_user()
    if user is None:
        raise Unauthorized("Sign in or select a demo user first.")
    return require_role(user, *roles, action="create_venue" if request.method == "POST"
                        else "view_venue_catalogue")


@venues.post("")
def add_venue():
    user = _require_user("Venue Staff")
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) - FIELDS:
        raise BadRequest(
            "Send venue details only. Identity and timestamps are recorded automatically."
        )
    fields, errors = validate_venue(data)
    if errors:
        return jsonify({"error": "Please check the highlighted fields.", "fields": errors}), 400
    return jsonify({"venue": create_venue(fields, user["id"])}), 201


@venues.get("")
def catalogue():
    _require_user("Venue Staff", "Coordinator")
    page = request.args.get("page", "1")
    if set(request.args) - {"page"} or not page.isascii() or not page.isdecimal():
        raise BadRequest("Choose a catalogue page from 1 to 10000.")
    if len(page) > 5 or not 1 <= int(page) <= 10000:
        raise BadRequest("Choose a catalogue page from 1 to 10000.")
    rows, has_more = list_venues(int(page))
    return jsonify({"venues": rows, "page": int(page), "has_more": has_more}), 200


@venues.get("/<venue_id>")
def venue_detail(venue_id):
    """One venue by id, for the availability calendar (SCRUM-30). Internal roles only."""
    _require_user("Venue Staff", "Coordinator")
    venue = get_venue(venue_id)
    if venue is None:
        raise NotFound("Venue not found.")
    return jsonify({"venue": venue}), 200


@venues.get("/<venue_id>/bookings")
def venue_bookings(venue_id):
    """A venue's confirmed/requested/blocked bookings over a date range (SCRUM-30)."""
    _require_user("Venue Staff", "Coordinator")
    start_at, end_at = request.args.get("from"), request.args.get("to")
    if not start_at or not end_at:
        raise BadRequest("Provide 'from' and 'to' timestamps.")
    return jsonify({"bookings": list_venue_bookings_in_range(venue_id, start_at, end_at)}), 200


@venues.get("/suitability/<event_id>")
def evaluate_all_venue_suitability(event_id: str):
    """
    Evaluate one event request against every venue on the current catalogue page.

    Unlike the single-venue check, this lets a Coordinator compare venues
    instead of being told about one arbitrary venue. Results are ranked in
    three tiers: fully suitable venues first, then advisory (flagged but
    usable) venues, then unsuitable ones. Within a tier the catalogue order
    is preserved; the endpoint does not pick a single winner, so the
    Coordinator chooses from the ranked list.
    """
    _require_user("Venue Staff", "Coordinator", "Organiser")

    page = request.args.get("page", "1")
    if set(request.args) - {"page"} or not page.isascii() or not page.isdecimal():
        raise BadRequest("Choose a catalogue page from 1 to 10000.")
    if len(page) > 5 or not 1 <= int(page) <= 10000:
        raise BadRequest("Choose a catalogue page from 1 to 10000.")

    event = get_event_by_id(event_id)
    if not event:
        raise NotFound("The requested event was not found.")

    venues, has_more = list_venues(int(page))
    if not venues:
        return jsonify({"event_id": event_id, "venues": [], "page": int(page),
                        "has_more": has_more}), 200

    engine = SuitabilityEngine()
    evaluated = []
    for venue in venues:
        result = engine.evaluate_suitability(event, venue)
        evaluated.append({
            "venue_id": venue["id"],
            "venue": venue,
            "suitability": result,
        })

    # Rank: suitable first, then advisory (some flags), then unsuitable.
    evaluated.sort(key=lambda item: (not item["suitability"]["is_suitable"],))

    return jsonify({
        "event_id": event_id,
        "venues": evaluated,
        "page": int(page),
        "has_more": has_more,
    }), 200


@venues.get("/<venue_id>/suitability/<event_id>")
def evaluate_venue_suitability(venue_id: str, event_id: str):
    """Evaluate suitability of a specific venue for a given event request (SCRUM-29)."""
    _require_user("Venue Staff", "Coordinator", "Organiser")

    event = get_event_by_id(event_id)
    if not event:
        raise NotFound("The requested event was not found.")

    venue = get_venue(venue_id)
    if not venue:
        raise NotFound("The requested venue was not found.")

    engine = SuitabilityEngine()
    result = engine.evaluate_suitability(event, venue)
    return jsonify({"suitability": result, "event_id": event_id, "venue_id": venue_id}), 200

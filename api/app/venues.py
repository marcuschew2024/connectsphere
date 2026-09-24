"""Venue Staff create venues; Venue Staff and Coordinators read the catalogue."""

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import BadRequest, Forbidden, HTTPException, Unauthorized

from .acting_user import get_acting_user
from .auth import get_authenticated_user
from .rbac import require_role
from .venue_repository import create_venue, list_venues
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

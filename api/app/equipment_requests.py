"""Record Coordinator equipment requests and expose the Tech Support queue."""

from datetime import datetime
from uuid import UUID

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import BadRequest, Forbidden, HTTPException, Unauthorized

from .acting_user import get_acting_user
from .auth import get_authenticated_user
from .equipment_request_repository import (
    get_request,
    list_request_events,
    list_request_history,
    list_requests,
    record_request,
    save_request_reservations,
    update_request_status,
)
from .event_repository import create_notification
from .rbac import require_role

equipment_requests = Blueprint("equipment_requests", __name__, url_prefix="/equipment/requests")


@equipment_requests.after_request
def prevent_caching(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@equipment_requests.errorhandler(HTTPException)
def json_error(error):
    return jsonify({"error": error.description}), error.code


def _user(*roles):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = get_authenticated_user() or get_acting_user()
    if user is None:
        raise Unauthorized("Sign in or select a demo user first.")
    return require_role(user, *roles, action="equipment_requests")


def _page():
    page = request.args.get("page", "1")
    if (
        set(request.args) - {"page"}
        or len(request.args.getlist("page")) > 1
        or not page.isascii()
        or not page.isdecimal()
        or len(page) > 5
        or not 1 <= int(page) <= 10000
    ):
        raise BadRequest("Choose a page from 1 to 10000.")
    return int(page)


def _uuid(value):
    try:
        return str(UUID(value)) if isinstance(value, str) else None
    except ValueError:
        return None


def validate_request(data):
    """Only request content is writable; attribution and routing are server-owned."""
    if not isinstance(data, dict) or set(data) != {"event_id", "items"}:
        raise BadRequest("Send event_id and items only. Attribution is recorded automatically.")
    errors = {}
    event_id = _uuid(data["event_id"])
    if event_id is None:
        errors["event_id"] = "Choose an event."
    items = data["items"]
    if not isinstance(items, list) or not 1 <= len(items) <= 50:
        raise BadRequest("Include between 1 and 50 equipment items.")
    clean, seen = [], set()
    for index, item in enumerate(items):
        if not isinstance(item, dict) or set(item) != {
            "equipment_id",
            "quantity",
            "technical_notes",
        }:
            raise BadRequest("Each item needs equipment_id, quantity and technical_notes only.")
        equipment_id = _uuid(item["equipment_id"])
        prefix = f"items.{index}."
        if equipment_id is None:
            errors[prefix + "equipment_id"] = "Choose catalogue equipment."
        elif equipment_id in seen:
            errors[prefix + "equipment_id"] = (
                "Combine quantities for the same equipment in one row."
            )
        seen.add(equipment_id)
        quantity = item["quantity"]
        if type(quantity) is not int or not 1 <= quantity <= 2_147_483_647:
            errors[prefix + "quantity"] = "Enter a whole number from 1 to 2147483647."
        notes = item["technical_notes"]
        if not isinstance(notes, str) or len(notes.strip()) > 2000:
            errors[prefix + "technical_notes"] = "Use no more than 2000 characters."
        clean.append(
            {
                "equipment_id": equipment_id,
                "quantity": quantity,
                "technical_notes": notes.strip() if isinstance(notes, str) else "",
            }
        )
    return event_id, clean, errors


@equipment_requests.post("")
def submit_request():
    user = _user("Coordinator")
    event_id, items, errors = validate_request(request.get_json(silent=True))
    if errors:
        return jsonify({"error": "Please check the highlighted fields.", "fields": errors}), 400
    # The database verifies event ownership and writes every line in one transaction.
    saved = record_request(event_id, items, user["id"])
    # SCRUM-49 / R07: Tech Support reviews new equipment requests from a shared queue.
    create_notification(
        None, event_id, "equipment_request_submitted",
        "A new equipment request needs review.",
        recipient_role="Tech Support",
    )
    return jsonify({"request": saved}), 201


@equipment_requests.get("")
def request_queue():
    user = _user("Coordinator", "Tech Support")
    page = _page()
    rows, more = list_requests(user, page)
    return jsonify({"requests": rows, "page": page, "has_more": more})


@equipment_requests.get("/events")
def request_events():
    user = _user("Coordinator")
    page = _page()
    rows, more = list_request_events(user["id"], page)
    return jsonify({"events": rows, "page": page, "has_more": more})


@equipment_requests.get("/<uuid:request_id>")
def request_detail(request_id):
    user = _user("Coordinator", "Tech Support")
    return jsonify({"request": get_request(str(request_id), user)})


@equipment_requests.get("/<uuid:request_id>/history")
def request_history(request_id):
    user = _user("Coordinator", "Tech Support")
    page = _page()
    rows, more = list_request_history(str(request_id), user, page)
    return jsonify({"history": rows, "page": page, "has_more": more})


@equipment_requests.patch("/<uuid:request_id>/status")
def change_request_status(request_id):
    user = _user("Tech Support")
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {"status", "notes", "revision"}:
        raise BadRequest(
            "Send status, notes and revision only. Attribution is recorded automatically."
        )
    if not isinstance(data["status"], str) or data["status"] not in {
        "Requested",
        "Unavailable",
    }:
        raise BadRequest(
            "Choose Requested or Unavailable. "
            "Save reserved quantities to set Reserved or Partially fulfilled."
        )
    if type(data["revision"]) is not int or not 1 <= data["revision"] <= 2_147_483_647:
        raise BadRequest("Reload the request before updating its status.")
    if not isinstance(data["notes"], str) or len(data["notes"].strip()) > 2000:
        raise BadRequest("Use no more than 2000 characters for update notes.")
    saved = update_request_status(
        str(request_id), data["status"], data["notes"].strip(), data["revision"], user["id"]
    )
    return jsonify({"request": saved})


@equipment_requests.put("/<uuid:request_id>/reservations")
def save_reservations(request_id):
    user = _user("Tech Support")
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {
        "start_at",
        "end_at",
        "items",
        "notes",
        "revision",
    }:
        raise BadRequest("Send start_at, end_at, items, notes and revision only.")
    try:
        start, end = (
            datetime.fromisoformat(data[key].replace("Z", "+00:00"))
            for key in ("start_at", "end_at")
        )
        if start.tzinfo is None or end.tzinfo is None or end <= start:
            raise ValueError
    except (ValueError, TypeError, AttributeError) as error:
        raise BadRequest("Choose a valid start and later end, including the time zone.") from error
    if type(data["revision"]) is not int or not 1 <= data["revision"] <= 2_147_483_647:
        raise BadRequest("Reload the request before saving reservations.")
    if not isinstance(data["notes"], str) or len(data["notes"].strip()) > 2000:
        raise BadRequest("Use no more than 2000 characters for update notes.")
    items = data["items"]
    if not isinstance(items, list) or not 1 <= len(items) <= 50:
        raise BadRequest("Include each requested equipment item.")
    seen = set()
    for item in items:
        if (
            not isinstance(item, dict)
            or not {"equipment_id", "quantity"} <= set(item)
            or set(item) - {"equipment_id", "quantity", "reservation_id"}
        ):
            raise BadRequest(
                "Each item needs equipment_id, quantity and an optional reservation_id."
            )
        equipment_id = _uuid(item["equipment_id"])
        if not equipment_id or equipment_id in seen:
            raise BadRequest("Include each requested equipment item once.")
        if type(item["quantity"]) is not int or not 0 <= item["quantity"] <= 2_147_483_647:
            raise BadRequest("Reserved quantities must be whole numbers from zero upwards.")
        if "reservation_id" in item and not _uuid(item["reservation_id"]):
            raise BadRequest("Choose an existing reservation from this event.")
        item["equipment_id"] = equipment_id
        seen.add(equipment_id)
    data["notes"] = data["notes"].strip()
    return jsonify({"request": save_request_reservations(str(request_id), data, user["id"])})

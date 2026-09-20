"""Create event requests using the current acting user's identity (SCRUM-14)."""

from datetime import UTC, datetime

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, HTTPException, NotFound

from .acting_user import require_acting_user
from .event_repository import (
    add_event_participant,
    add_status_history,
    canonical_event_status,
    get_event_by_id,
    get_events_for_user,
    get_status_history,
    insert_event,
    log_event_edit,
    update_event_fields,
    update_event_status,
)
from .event_validation import TEXT_LIMITS, validate_event
from .rbac import public_event_view, require_related_user, require_role

events = Blueprint("events", __name__, url_prefix="/events")


@events.after_request
def prevent_caching(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@events.errorhandler(HTTPException)
def json_error(error):
    return jsonify({"error": error.description}), error.code


@events.post("")
def create_event():
    # Session cookies authenticate browser requests, so verify their origin too.
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    require_role(user, "Organiser", action="create_event")

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadRequest("Send event details as a JSON object.")

    allowed_fields = set(TEXT_LIMITS) | {"action", "event_datetime", "expected_attendance"}
    if set(data) - allowed_fields:
        # Identity, status, assignment and timestamps are controlled by the server.
        raise BadRequest("The request contains unsupported fields.")
    action = data.get("action", "submit")
    if action not in ("draft", "submit"):
        raise BadRequest("Choose draft or submit as the action.")

    fields, errors = validate_event(data, submitting=action == "submit")
    if errors:
        return jsonify({"error": "Please check the highlighted fields.", "fields": errors}), 400

    fields["organiser_id"] = user["id"]
    fields["status"] = "Submitted" if action == "submit" else "Draft"
    fields["submitted_at"] = datetime.now(UTC).isoformat() if action == "submit" else None
    fields["last_status_changed_by"] = user["id"]
    fields["last_status_changed_at"] = datetime.now(UTC).isoformat()
    saved = insert_event(fields)
    add_event_participant(saved["id"], user["id"], "Organiser")
    add_status_history(saved["id"], None, fields["status"], user["id"])
    return jsonify({"event": saved}), 201


@events.get("")
def list_events():
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    event_list = get_events_for_user(user["id"])
    for event in event_list:
        event["status"] = canonical_event_status(event.get("status"))
    if user["role"] == "Attendee":
        event_list = [public_event_view(event) for event in event_list]
    return jsonify({"events": event_list}), 200


@events.get("/<event_id>")
def get_event(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    event = get_event_by_id(event_id)

    if event is None:
        raise NotFound("Event not found.")

    require_related_user(user, event, action="view_event")

    event["status"] = canonical_event_status(event.get("status"))
    if user["role"] == "Attendee":
        event = public_event_view(event)
    return jsonify({"event": event}), 200


@events.get("/<event_id>/history")
def get_event_history(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")

    require_related_user(user, event, action="view_event_history")

    return jsonify({"history": get_status_history(event_id)}), 200


@events.patch("/<event_id>/status")
def change_event_status(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")

    require_related_user(user, event, action="change_status")

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {"status"}:
        raise BadRequest("Send a JSON object containing only status.")

    status = data["status"]
    allowed_statuses = {
        "Submitted", "Assigned", "Under review", "Approved", "Planning",
        "Confirmed", "Completed", "Rejected", "Cancelled",
    }
    if status not in allowed_statuses:
        raise BadRequest("Choose a valid event status.")

    old_status = event.get("status")
    updated = update_event_status(event_id, status, user["id"])
    add_status_history(event_id, old_status, status, user["id"])
    updated["status"] = canonical_event_status(updated.get("status"))
    return jsonify({"event": updated}), 200


# An edit touching any of these confirmed-arrangement-affecting fields is "important"
# rather than "ordinary" (TC-US4.6-05).
IMPORTANT_FIELDS = {
    "event_datetime",
    "expected_attendance",
    "category",
    "venue_requirements",
    "equipment_requirements",
    "accessibility_requirements",
}


def _normalise_datetime(value):
    """Compare datetimes by instant, not string form (DB and validator may format differently)."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).astimezone(UTC)
    except (TypeError, ValueError):
        return value


def _field_changed(name, new_value, old_value):
    if name == "event_datetime":
        return _normalise_datetime(new_value) != _normalise_datetime(old_value)
    return new_value != old_value


@events.patch("/<event_id>")
def edit_event(event_id):
    # Session cookies authenticate browser requests, so verify their origin too.
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")

    # Only this event's coordinator may edit it: Coordinator role AND tied to the event.
    # A non-coordinator, or a coordinator of a different event, is denied and logged
    # (TC-US4.6-04, ties to US-1.2 RBAC).
    require_role(user, "Coordinator", action="edit_event")
    require_related_user(user, event, action="edit_event")

    # Direct edits are only allowed while the event is in Planning (TC-US4.6-03).
    if canonical_event_status(event.get("status")) != "Planning":
        raise Conflict(
            "This event can no longer be edited directly. A confirmed event must be "
            "changed through a change request."
        )

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadRequest("Send the updated event details as a JSON object.")
    allowed_fields = set(TEXT_LIMITS) | {"event_datetime", "expected_attendance"}
    if set(data) - allowed_fields:
        raise BadRequest("The request contains unsupported fields.")

    # Validate the full editable set (the edit form submits all fields, like create).
    fields, errors = validate_event(data, submitting=True)
    if errors:
        return jsonify({"error": "Please check the highlighted fields.", "fields": errors}), 400

    # Persist only what actually changed, and classify the edit's importance.
    changed = [name for name in data if _field_changed(name, fields.get(name), event.get(name))]
    if not changed:
        event["status"] = canonical_event_status(event.get("status"))
        return jsonify({"event": event, "changed_fields": [], "importance": "ordinary"}), 200

    importance = "important" if any(name in IMPORTANT_FIELDS for name in changed) else "ordinary"
    updated = update_event_fields(event_id, {name: fields[name] for name in changed})
    # Audit is best-effort: the edit already saved, so a lost audit row must not fail it.
    try:
        log_event_edit(event_id, user["id"], changed, importance)
    except HTTPException:
        current_app.logger.exception("event_edit_log write failed (non-fatal)")

    updated["status"] = canonical_event_status(updated.get("status"))
    return jsonify({"event": updated, "changed_fields": changed, "importance": importance}), 200

"""Create, continue and view event requests (SCRUM-14/15 and status tracking)."""

from datetime import UTC, datetime

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, HTTPException, NotFound

from .acting_user import require_acting_user
from .event_decision import EventDecision
from .event_repository import (
    add_event_participant,
    add_status_history,
    canonical_event_status,
    create_clarification,
    create_notification,
    customer_event_status,
    get_event_by_id,
    get_events_for_user,
    get_pending_clarification,
    get_status_history,
    insert_event,
    log_event_edit,
    mark_clarification_resubmitted,
    record_event_decision,
    save_event_draft,
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


def event_response(event, user):
    """Keep drafts editable and show customers Planning during coordinator review."""
    visible = canonical_event_status(event["status"])
    if user["role"] != "Coordinator":
        visible = customer_event_status(visible)
    result = {**event, "request_status": event["status"], "status": visible}
    return public_event_view(result) if user["role"] == "Attendee" else result


def require_event_access(event_id, user):
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")
    if event["status"] == "Draft":
        # Membership never grants access to a private draft, including its history.
        if user["role"] != "Organiser" or event["organiser_id"] != user["id"]:
            raise NotFound("Event not found.")
    else:
        require_related_user(user, event, action="view_event")
    return event


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
    if saved.get("coordinator_id") is not None:
        add_event_participant(saved["id"], saved["coordinator_id"], "Coordinator")
    add_status_history(saved["id"], None, fields["status"], user["id"])
    return jsonify({"event": event_response(saved, user)}), 201


@events.get("")
def list_events():
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    status = request.args.get("status")
    if status not in (None, "Draft"):
        raise BadRequest("The supported status filter is Draft.")
    if status == "Draft" and user["role"] != "Organiser":
        raise Forbidden("Only Organisers can view their drafts.")
    event_list = get_events_for_user(user["id"], drafts_only=status == "Draft")
    event_list = [event for event in event_list
                  if event["status"] != "Draft" or user["role"] == "Organiser"]
    return jsonify({"events": [event_response(event, user) for event in event_list]}), 200


@events.get("/<event_id>")
def get_event(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    event = require_event_access(event_id, user)
    return jsonify({"event": event_response(event, user)}), 200


def edit_draft(event, user, data):
    """Save or submit a private draft after the route checks origin and access."""
    require_role(user, "Organiser", action="edit_draft")
    if event["organiser_id"] != user["id"]:
        raise Forbidden("Only the Organiser who owns this request can edit it.")
    if event["status"] != "Draft":
        raise Conflict("This request has already been submitted and cannot be edited as a draft.")

    if not isinstance(data, dict):
        raise BadRequest("Send event details as a JSON object.")
    editable_fields = set(TEXT_LIMITS) | {"event_datetime", "expected_attendance"}
    if set(data) - editable_fields - {"action"}:
        raise BadRequest("The request contains unsupported fields.")
    action = data.get("action", "draft")
    if action not in ("draft", "submit"):
        raise BadRequest("Choose draft or submit as the action.")

    # PATCH keeps omitted fields; an explicit null or empty string clears a field.
    details = {name: event.get(name) for name in editable_fields}
    details.update({name: value for name, value in data.items() if name in editable_fields})
    fields, errors = validate_event(details, submitting=action == "submit")
    if errors:
        return jsonify({"error": "Please check the highlighted fields.", "fields": errors}), 400
    saved = save_event_draft(event["id"], user["id"], fields, submitting=action == "submit")
    return jsonify({"event": event_response(saved, user)}), 200


@events.get("/<event_id>/history")
def get_event_history(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    require_event_access(event_id, user)

    return jsonify({"history": get_status_history(event_id)}), 200


@events.patch("/<event_id>/status")
def change_event_status(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    event = require_event_access(event_id, user)
    if event["status"] == "Draft":
        raise Conflict("Complete and submit this request through the draft form first.")
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


@events.post("/<event_id>/decision")
def decide_event(event_id):
    """Approve or reject a submitted request as its assigned coordinator."""
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    require_role(user, "Coordinator", action="decide_event")

    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")

    require_related_user(user, event, action="decide_event")

    if event.get("status") != "Submitted":
        raise Conflict("This request has already been decided.")

    try:
        decision = EventDecision.from_payload(request.get_json(silent=True))
    except ValueError as error:
        raise BadRequest(str(error)) from error

    updated = record_event_decision(
        event_id, decision.status, decision.reason, user["id"]
    )
    add_status_history(event_id, event["status"], decision.status, user["id"])

    if decision.is_rejection:
        create_notification(
            event["organiser_id"],
            event_id,
            "event_rejected",
            f"Your event request was rejected: {decision.reason}",
        )

    updated["status"] = canonical_event_status(updated.get("status"))
    return jsonify({"event": updated}), 200


@events.post("/<event_id>/clarification")
def request_clarification(event_id):
    """Return a submitted request to its organiser for clarification."""
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    require_role(user, "Coordinator", action="request_clarification")
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")
    require_related_user(user, event, action="request_clarification")
    if event.get("status") != "Submitted":
        raise Conflict("Clarification can only be requested for a submitted request.")
    if get_pending_clarification(event_id) is not None:
        raise Conflict("This request already has a pending clarification.")

    data = request.get_json(silent=True)
    note = data.get("note") if isinstance(data, dict) else None
    if not isinstance(note, str) or not note.strip() or len(note.strip()) > 2000:
        raise BadRequest("A clarification note of 1 to 2000 characters is required.")
    note = note.strip()
    clarification = create_clarification(event_id, note, user["id"])
    add_status_history(
        event_id, event["status"], event["status"], user["id"],
        action="clarification_requested", note=note,
    )
    create_notification(
        event["organiser_id"], event_id, "event_clarification",
        f"Clarification requested: {note}",
    )
    return jsonify({"clarification": clarification}), 201


@events.get("/<event_id>/clarification")
def get_clarification(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")
    require_related_user(user, event, action="view_clarification")
    return jsonify({"clarification": get_pending_clarification(event_id)}), 200


@events.post("/<event_id>/resubmit")
def resubmit_event(event_id):
    """Save organiser revisions and return the request to the coordinator queue."""
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Organiser", action="resubmit_event")
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")
    if event.get("organiser_id") != user["id"]:
        require_related_user(user, event, action="resubmit_event")
        raise Forbidden("Only the organiser can resubmit this request.")
    clarification = get_pending_clarification(event_id)
    if clarification is None:
        raise Conflict("This request does not have a pending clarification.")

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadRequest("Send the revised event details as a JSON object.")
    allowed_fields = set(TEXT_LIMITS) | {"event_datetime", "expected_attendance"}
    if set(data) - allowed_fields:
        raise BadRequest("The request contains unsupported fields.")
    fields, errors = validate_event(data, submitting=True)
    if errors:
        return jsonify({"error": "Please check the highlighted fields.", "fields": errors}), 400

    fields.update({
        "status": "Submitted",
        "submitted_at": datetime.now(UTC).isoformat(),
        "last_status_changed_by": user["id"],
        "last_status_changed_at": datetime.now(UTC).isoformat(),
    })
    updated = update_event_fields(event_id, fields)
    mark_clarification_resubmitted(event_id, user["id"])
    add_status_history(
        event_id, event["status"], event["status"], user["id"],
        action="clarification_resubmitted", note=clarification["note"],
    )
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
    event = require_event_access(event_id, user)
    data = request.get_json(silent=True)
    # One PATCH route handles both private draft edits and coordinator Planning edits.
    if event["status"] == "Draft" or (isinstance(data, dict) and "action" in data):
        return edit_draft(event, user, data)

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

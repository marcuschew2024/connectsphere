"""Create, continue and view event requests (SCRUM-14/15 and status tracking)."""

from datetime import UTC, datetime

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, HTTPException, NotFound

from .acting_user import require_acting_user
from .booking_repository import list_bookings_for_event, list_bookings_for_event_detail
from .change_request_proposal import ChangeRequestProposal
from .coordinator_assignment import AssignmentRefused, CoordinatorAssignment
from .equipment_repository import list_event_equipment_reservations
from .equipment_request_repository import list_confirmation_requests
from .event_cancellation import EventCancellation
from .event_completion import EventCompletion
from .event_confirmation import EventConfirmation
from .event_decision import EventDecision
from .event_repository import (
    add_event_participant,
    add_status_history,
    approve_change_request_record,
    assign_event_coordinator,
    cancel_event_record,
    complete_event_record,
    create_change_request,
    create_clarification,
    create_notification,
    get_change_requests,
    get_event_by_id,
    get_events_for_user,
    get_pending_clarification,
    get_status_history,
    insert_event,
    list_all_events_for_coordinator,
    list_all_supervised_events,
    list_coordinators,
    list_event_equipment_requests,
    list_planning_events,
    list_safety_review_events,
    log_event_edit,
    mark_clarification_resubmitted,
    save_event_draft,
    transition_event_intake,
    update_change_request,
    update_event_fields,
    update_event_status,
)
from .event_status import canonical_event_status, customer_event_status
from .event_transition import EventTransition, TransitionRefused
from .event_validation import TEXT_LIMITS, validate_event
from .rbac import log_access_denied, public_event_view, require_related_user, require_role
from .registration_capacity import valid_capacity
from .registration_repository import (
    CONFLICT_MESSAGES,
    capacity_for_event,
    get_own_registration,
    get_registration_confirmations,
    get_withdrawal_policy,
    list_event_registrations,
    list_own_registrations,
    list_registration_events,
    register_attendee,
    set_registration_capacity,
    set_withdrawal_policy,
    withdraw_attendee,
)
from .registration_request import RegistrationRequest
from .registration_roster import RegistrationRosterAccess
from .registration_withdrawal import withdrawal_rules
from .safety_decision import SafetyDecision
from .venue_repository import get_venue

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
    # Coordinators and the Event Coordinator Lead are internal staff who oversee intake,
    # so they see the real workflow status (Submitted vs Planning); customers do not.
    if user["role"] not in ("Coordinator", "Event Coordinator Lead"):
        visible = customer_event_status(visible)
    result = {**event, "request_status": event["status"], "status": visible}
    return public_event_view(result) if user["role"] == "Attendee" else result


# A Safety Officer reviews events in the safety-review window, so they may read these
# states without being an organiser/coordinator/participant (SCRUM-128).
_SAFETY_REVIEW_STATES = {"Confirmed", "Preparation"}
# A Completed event is terminal (SCRUM-132): nothing may change it after closing.
_COMPLETED_READ_ONLY = "This event is completed and closed. Its record is read-only."
# A Cancelled event is terminal too (SCRUM-69): it cannot be reopened by a status edit,
# because its venue bookings and equipment have already been released.
_CANCELLED_READ_ONLY = "This event is cancelled. Its record is read-only."


def require_event_access(event_id, user):
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")
    if event["status"] == "Draft":
        # Membership never grants access to a private draft, including its history.
        if user["role"] != "Organiser" or event["organiser_id"] != user["id"]:
            raise NotFound("Event not found.")
    elif user.get("role") == "Safety Officer":
        if event.get("status") not in _SAFETY_REVIEW_STATES:
            log_access_denied(user, action="view_event", event_id=event_id,
                              reason="outside the safety-review window")
            raise Forbidden("This event is not available for safety review.")
    elif user.get("role") == "Event Coordinator Lead":
        # The Lead oversees intake and every coordinator assignment, so may read any
        # event that has left Draft (SCRUM-131). Drafts stay private to their organiser,
        # which the Draft branch above already enforces.
        pass
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
    require_role(user, "Organiser", "Coordinator", "Venue Staff", "Tech Support", "Attendee",
                 "Event Coordinator Lead", action="list_events")
    status = request.args.get("status")
    if status not in (None, "Draft"):
        raise BadRequest("The supported status filter is Draft.")
    if status == "Draft" and user["role"] != "Organiser":
        raise Forbidden("Only Organisers can view their drafts.")
    if user["role"] == "Event Coordinator Lead":
        # Oversight view: every submitted/active event, not just ones tied to the Lead.
        event_list = list_all_supervised_events()
    elif user["role"] == "Coordinator":
        # SCRUM-54: a Coordinator views every non-draft event, their own surfaced first.
        event_list = list_all_events_for_coordinator(user["id"])
    elif user["role"] == "Venue Staff":
        event_list = list_planning_events()
    else:
        event_list = get_events_for_user(user["id"], drafts_only=status == "Draft")
        event_list = [event for event in event_list
                      if event["status"] != "Draft" or user["role"] == "Organiser"]
    responses = [event_response(event, user) for event in event_list]
    if user["role"] == "Coordinator":
        # Tag which events the Coordinator owns so the list can surface them first and
        # the UI can show a "your event" marker without the browser learning the user id.
        for response, event in zip(responses, event_list, strict=True):
            response["is_mine"] = (event.get("organiser_id") == user["id"]
                                   or event.get("coordinator_id") == user["id"])
    return jsonify({"events": responses}), 200


@events.get("/safety-review")
def safety_review_queue():
    """Only confirmed events await an operational safety decision (SCRUM-127)."""
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Safety Officer", action="list_safety_reviews")
    page = request.args.get("page", "1")
    if not page.isascii() or not page.isdecimal() or len(page) > 5 or not 1 <= int(page) <= 10000:
        raise BadRequest("Choose a review page from 1 to 10000.")
    rows, has_more = list_safety_review_events(int(page))
    return jsonify({"events": [event_response(row, user) for row in rows],
                    "page": int(page), "has_more": has_more})


# The venue attributes a Safety Officer needs to assess operational safety (SCRUM-145 / R16):
# capacity, layout, accessibility and facilities. A whitelist keeps the read least-privilege —
# buffers, operating hours and audit columns never reach the review screen.
_SAFETY_VENUE_FIELDS = frozenset(
    {"id", "name", "location", "capacity", "supported_layouts", "accessibility", "facilities"}
)


def safety_venue_view(venue: dict | None) -> dict | None:
    """Project a venue to the safety-relevant fields shown on the review screen."""
    if venue is None:
        return None
    return {key: value for key, value in venue.items() if key in _SAFETY_VENUE_FIELDS}


@events.get("/<event_id>/safety-review-details")
def safety_review_details(event_id):
    """Read-only venue + equipment detail for the operational safety check (SCRUM-145 / R16).

    Access follows require_event_access, which gates the Safety Officer to the
    Confirmed/Preparation review window (and also admits the event's related users and the
    Lead). The read is event-scoped and read-only: no venue catalogue access, no management.
    """
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_event_access(event_id, user)

    bookings = list_bookings_for_event_detail(event_id)
    venue_ids = []
    for booking in bookings:
        venue_id = booking.get("venue_id")
        if venue_id is not None and venue_id not in venue_ids:
            venue_ids.append(venue_id)
    venues = [view for view in (safety_venue_view(get_venue(vid)) for vid in venue_ids)
              if view is not None]
    reservations = list_event_equipment_reservations(event_id) or []
    return jsonify({
        "bookings": bookings,
        "venues": venues,
        "equipment": {"reservations": reservations},
    }), 200


@events.get("/coordinators")
def assignable_coordinators():
    """The Coordinators the Event Coordinator Lead can route a request to (SCRUM-130)."""
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Event Coordinator Lead", action="list_coordinators")
    return jsonify({"coordinators": list_coordinators()}), 200


@events.post("/<event_id>/coordinator")
def assign_coordinator(event_id):
    """Assign an unassigned request, or reassign an active event (SCRUM-130).

    Status is unchanged. The database function re-checks the Lead, the Coordinator and
    the event state under the row lock, moves the Coordinator's event membership (so a
    previous Coordinator loses access), records history and notifies both Coordinators.
    """
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Event Coordinator Lead", action="assign_coordinator")

    try:
        assignment = CoordinatorAssignment.from_payload(request.get_json(silent=True))
    except ValueError as error:
        raise BadRequest(str(error)) from error

    event = get_event_by_id(event_id)
    if event is None or event["status"] == "Draft":
        raise NotFound("Event not found.")
    try:
        assignment.outcome(status=event["status"],
                           current_coordinator_id=event.get("coordinator_id"))
    except AssignmentRefused as error:
        raise Conflict(str(error)) from error

    result = assign_event_coordinator(event_id, assignment.coordinator_id, user["id"])
    return jsonify({
        "event": event_response(result["event"], user),
        "outcome": result["outcome"],
        "previous_coordinator_id": result.get("previous_coordinator_id"),
    }), 200


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


@events.route("/<uuid:event_id>/registration-capacity", methods=["GET", "PUT"])
def registration_capacity(event_id):
    """Aggregate places only; no attendee identities are exposed."""
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    event = require_event_access(str(event_id), user)
    if request.method == "GET":
        return jsonify({"registration_capacity": capacity_for_event(event).as_dict()})

    require_role(user, "Organiser", action="set_registration_capacity")
    if event["organiser_id"] != user["id"]:
        raise Forbidden("Only the event's Organiser can set its registration capacity.")
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {"capacity"}:
        raise BadRequest("Send a JSON object containing only capacity.")
    if not valid_capacity(data["capacity"]):
        return jsonify({"error": "Please check the highlighted field.", "fields": {
            "capacity": "Enter a whole number between 1 and 10,000.",
        }}), 400
    if not capacity_for_event(event).can_set(event["status"]):
        raise Conflict(CONFLICT_MESSAGES["capacity_locked"])
    saved = set_registration_capacity(str(event_id), user["id"], data["capacity"])
    return jsonify({"registration_capacity": capacity_for_event(saved).as_dict()})


@events.route("/<uuid:event_id>/withdrawal-policy", methods=["GET", "PUT"])
def withdrawal_policy(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Organiser", action="manage_withdrawal_policy")
    event = require_event_access(str(event_id), user)
    if event["organiser_id"] != user["id"]:
        raise Forbidden("Only the event's Organiser can set withdrawal conditions.")
    if request.args:
        raise BadRequest("Do not send query parameters.")
    if request.method == "GET":
        saved = get_withdrawal_policy(str(event_id), user["id"])
    else:
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or set(data) != {"closes_at"}:
            raise BadRequest("Send only closes_at.")
        rules = withdrawal_rules(event)
        now = datetime.now(UTC)
        # SQL independently checks for any signup after acquiring the event lock.
        if not rules.can_edit(now, has_registrations=False):
            raise Conflict(CONFLICT_MESSAGES["withdrawal_policy_locked"])
        error = rules.policy_error(data["closes_at"], now)
        if error:
            raise BadRequest(error)
        saved = set_withdrawal_policy(str(event_id), user["id"],
                                      data["closes_at"])
    return jsonify({"withdrawal_policy": saved})


@events.post("/<uuid:event_id>/registrations/withdraw")
def withdraw_registration(event_id):
    """Only the session's own registration; SQL rechecks conditions after locking."""
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Attendee", action="withdraw_registration")
    if request.args or request.get_json(silent=True) != {}:
        raise BadRequest("Send an empty JSON object. The attendee comes from your session.")
    registration = withdraw_attendee(str(event_id), user["id"])
    return jsonify({"registration": registration})


@events.post("/<uuid:event_id>/registrations")
def create_registration(event_id):
    """Session-only identity; SQL commits the place, access and receipt together."""
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Attendee", action="register_event")
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) - {"information"}:
        raise BadRequest(
            "Send only registration information. The attendee comes from your session."
        )
    event = get_event_by_id(str(event_id))
    if event is None:
        raise NotFound("Event not found.")
    rules = registration_rules(event)
    refusal = rules.refusal(datetime.now(UTC))
    if refusal:
        raise Conflict(refusal)
    error = rules.information_error(data.get("information", ""))
    if error:
        return jsonify({"error": "Please check the highlighted field.",
                        "fields": {"information": error}}), 400
    # Signup must not require a pre-existing participant link. SQL checks the actual
    # stored status, actor role, uniqueness and capacity atomically before inserting.
    registration = (register_attendee(str(event_id), user["id"], data["information"].strip())
                    if "information" in data else register_attendee(str(event_id), user["id"]))
    return jsonify({"registration": registration}), 201


def registration_rules(event: dict) -> RegistrationRequest:
    return RegistrationRequest(capacity_for_event(event), event["status"],
                               event.get("registration_requirements"),
                               event.get("registration_opens_at"),
                               event.get("registration_closes_at"))


def registration_offer(event: dict) -> dict:
    """An explicit attendee projection, separate from internal event/planning APIs."""
    return {"event": {**public_event_view(event),
                      "registration_requirements": event.get("registration_requirements")},
            "withdrawal_policy": {"closes_at": event.get("withdrawal_closes_at"),
                                  "unavailable_reason": withdrawal_rules(event).refusal(
                                      datetime.now(UTC))},
            "capacity": capacity_for_event(event).as_dict(),
            "unavailable_reason": registration_rules(event).refusal(datetime.now(UTC))}


@events.get("/registration-offers")
def registration_offers():
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Attendee", action="browse_registration_events")
    page = request.args.get("page", "1")
    if not page.isascii() or not page.isdecimal() or len(page) > 5 or not 1 <= int(page) <= 10000:
        raise BadRequest("Choose an event page from 1 to 10000.")
    rows, has_more = list_registration_events(int(page))
    return jsonify({"offers": [registration_offer(row) for row in rows],
                    "page": int(page), "has_more": has_more})


@events.get("/registration-confirmations")
def registration_confirmations():
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Attendee", action="view_registration_confirmations")
    return jsonify({"confirmations": get_registration_confirmations(user["id"])})


@events.get("/registrations")
def own_registrations():
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Attendee", action="view_own_registrations")
    if set(request.args) - {"page"} or len(request.args.getlist("page")) > 1:
        raise BadRequest("Send only a page number. The attendee comes from your session.")
    page = request.args.get("page", "1")
    if not page.isascii() or not page.isdecimal() or len(page) > 5 or not 1 <= int(page) <= 10000:
        raise BadRequest("Choose a registration page from 1 to 10000.")
    rows, has_more = list_own_registrations(user["id"], int(page))
    return jsonify({"registrations": rows, "page": int(page), "has_more": has_more})


@events.get("/<uuid:event_id>/registration-offer")
def get_registration_offer(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Attendee", action="view_registration_event")
    event = get_event_by_id(str(event_id))
    if event is None or event["status"] == "Draft":
        raise NotFound("Event not found.")
    registration = get_own_registration(str(event_id), user["id"])
    if event["status"] != "Confirmed" and registration is None:
        raise NotFound("Event not found.")
    return jsonify({**registration_offer(event), "registration": registration})


@events.get("/<uuid:event_id>/registrations")
def event_registration_roster(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Organiser", "Coordinator", action="view_event_registrations")
    event = require_event_access(str(event_id), user)
    access = RegistrationRosterAccess(event["organiser_id"], event.get("coordinator_id"))
    if not access.allows(user["id"], user["role"]):
        log_access_denied(user, action="view_event_registrations", event_id=str(event_id),
                          reason="not the owning organiser or current assigned coordinator")
        raise Forbidden(
            "Only the event's Organiser and assigned Coordinator can view registrations.")
    if (set(request.args) - {"page", "status"}
            or any(len(request.args.getlist(key)) > 1 for key in request.args)):
        raise BadRequest("Send only a page number and registration status.")
    page = request.args.get("page", "1")
    if not page.isascii() or not page.isdecimal() or len(page) > 5 or not 1 <= int(page) <= 10000:
        raise BadRequest("Choose a registration page from 1 to 10000.")
    status = request.args.get("status")
    if status is not None and status not in {"Registered", "Waitlisted", "Withdrawn"}:
        raise BadRequest("Choose Registered, Waitlisted or Withdrawn, or omit the status filter.")
    result = list_event_registrations(str(event_id), int(page), status)
    return jsonify({**result, "event": public_event_view(event),
                    "capacity": event.get("registration_capacity")})


def _apply_intake_transition(event, user, transition, *, decision=False, reason=None):
    """Validate intent here, then re-check assignment/state under the database lock."""
    try:
        transition.validate(event["status"], decision=decision)
    except TransitionRefused as error:
        log_access_denied(user, action="change_status", event_id=event["id"], reason=str(error))
        raise Conflict(str(error)) from error
    if not transition.actor_allowed(user, event):
        log_access_denied(user, action="change_status", event_id=event["id"],
                          reason="only the currently assigned Coordinator may change intake status")
        raise Forbidden("Only the assigned Coordinator can change this event's status.")
    try:
        return transition_event_intake(event["id"], event["status"], transition.target,
                                       user["id"], reason)
    except (Conflict, Forbidden) as error:
        log_access_denied(user, action="change_status", event_id=event["id"],
                          reason=error.description)
        raise


@events.patch("/<event_id>/status")
def change_event_status(event_id):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    event = require_event_access(event_id, user)
    # Keep private draft 404s, then refuse non-management roles before parsing input.
    require_role(user, "Organiser", "Coordinator", action="change_status")
    if event["status"] == "Draft":
        log_access_denied(user, action="change_status", event_id=event_id,
                          reason="draft submission must use the draft form")
        raise Conflict("Complete and submit this request through the draft form first.")
    try:
        transition = EventTransition.from_payload(request.get_json(silent=True))
    except ValueError as error:
        raise BadRequest(str(error)) from error
    updated = _apply_intake_transition(event, user, transition)
    return jsonify({"event": event_response(updated, user)}), 200


@events.post("/<event_id>/confirm")
def confirm_event(event_id):
    """Confirm an event once all its venue bookings are approved (SCRUM-39).

    The Week 7 multi-venue gate (change #3): a Coordinator may move an event from
    Planning to Confirmed only when every venue booking is approved and the technical
    arrangements are resolved. A confirmed event then awaits the Operational Safety
    Check (SCRUM-128) before it can proceed to preparation.
    """
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    require_role(user, "Coordinator", action="confirm_event")

    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")

    require_related_user(user, event, action="confirm_event")

    if event.get("status") != "Planning":
        raise Conflict("Only an event in Planning can be confirmed.")

    gate = EventConfirmation.from_arrangements(
        list_bookings_for_event(event_id), list_confirmation_requests(event_id),
        event_datetime=event.get("event_datetime"),
    )
    if not gate.can_confirm:
        raise Conflict("This event cannot be confirmed yet. " + " ".join(gate.outstanding))

    old_status = event["status"]
    updated = update_event_status(event_id, "Confirmed", user["id"])
    add_status_history(event_id, old_status, "Confirmed", user["id"])
    updated["status"] = canonical_event_status(updated.get("status"))
    return jsonify({"event": updated}), 200


# Maps each safety decision to the audit action recorded in the status history.
_SAFETY_ACTIONS = {
    "approve": "safety_approved",
    "request_changes": "safety_changes_requested",
    "reject": "safety_rejected",
}


@events.post("/<event_id>/safety-check")
def safety_check_event(event_id):
    """Record a Safety Officer's operational safety decision on a confirmed event (SCRUM-128).

    Week 7 customer change #6. The safety review acts on a Confirmed event: approving it
    moves it to Preparation (the only path there); requesting changes or rejecting sends
    it back to Planning with a recorded reason so the arrangements can be re-reviewed.
    """
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    # Authorisation is by role: the Safety Officer role (SCRUM-127) is the gate, not
    # organiser/coordinator relatedness.
    require_role(user, "Safety Officer", action="safety_check_event")

    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")

    if event.get("status") != "Confirmed":
        raise Conflict("Only a confirmed event can undergo the operational safety check.")

    try:
        decision = SafetyDecision.from_payload(request.get_json(silent=True))
    except ValueError as error:
        raise BadRequest(str(error)) from error

    old_status = event["status"]
    updated = update_event_status(event_id, decision.status, user["id"])
    add_status_history(
        event_id, old_status, decision.status, user["id"],
        action=_SAFETY_ACTIONS[decision.action], note=decision.reason,
    )
    updated["status"] = canonical_event_status(updated.get("status"))
    return jsonify({"event": updated}), 200


@events.post("/<event_id>/complete")
def complete_delivered_event(event_id):
    """Mark a delivered event Completed and close it (SCRUM-132).

    Customer Brief step 14. The assigned Coordinator closes an event that has been
    delivered (Preparation). The database function re-checks the gate under a row
    lock, records the completion with an optional post-event note, and releases the
    event's remaining equipment reservations and future venue bookings.
    """
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    require_role(user, "Coordinator", action="complete_event")

    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")

    require_related_user(user, event, action="complete_event")
    if event.get("coordinator_id") != user["id"]:
        raise Forbidden("Only the assigned Coordinator can complete this event.")

    data = request.get_json(silent=True)
    if data is None:
        data = {}
    if not isinstance(data, dict) or set(data) - {"note"}:
        raise BadRequest("Send a JSON object with an optional note only.")
    note = data.get("note")
    if note is not None and (not isinstance(note, str) or len(note.strip()) > 2000):
        raise BadRequest("Post-event notes must be text of at most 2000 characters.")
    note = note.strip() or None if isinstance(note, str) else None

    gate = EventCompletion.from_records(
        event, list_bookings_for_event(event_id), list_event_equipment_requests(event_id),
    )
    if not gate.can_complete:
        raise Conflict("This event cannot be completed yet. " + " ".join(gate.outstanding))

    result = complete_event_record(event_id, user["id"], note)
    updated = result["event"]
    updated["status"] = canonical_event_status(updated.get("status"))
    return jsonify({
        "event": updated,
        "released": {
            "equipment_reservations": result.get("released_equipment_reservations", 0),
            "venue_bookings": result.get("released_venue_bookings", 0),
        },
    }), 200


@events.post("/<event_id>/cancel")
def cancel_event(event_id):
    """Cancel an event and release its venue and equipment reservations (SCRUM-69).

    The assigned Coordinator or the Event Coordinator Lead gives a reason. The database
    function re-checks who may cancel and the state under a row lock, then in one
    transaction cancels the venue bookings, releases equipment, records the reason in
    the history and notifies registered Attendees, the Organiser and, when the Lead
    cancels, the assigned Coordinator. Registrations themselves are left unchanged.
    """
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    require_role(user, "Coordinator", EventCancellation.LEAD_ROLE, action="cancel_event")
    event = require_event_access(event_id, user)
    if not EventCancellation.actor_may_cancel(user, event):
        log_access_denied(user, action="cancel_event", event_id=event_id,
                          reason="not the assigned Coordinator or the Lead")
        raise Forbidden(
            "Only the assigned Coordinator or the Event Coordinator Lead can cancel this event."
        )

    blocked = EventCancellation.blocking_reason(event.get("status"))
    if blocked:
        raise Conflict(blocked)
    try:
        cancellation = EventCancellation.from_payload(request.get_json(silent=True))
    except ValueError as error:
        raise BadRequest(str(error)) from error

    result = cancel_event_record(event_id, user["id"], cancellation.reason)
    updated = result["event"]
    return jsonify({
        "event": event_response(updated, user),
        "released": {
            "equipment_reservations": result.get("released_equipment_reservations", 0),
            "venue_bookings": result.get("released_venue_bookings", 0),
        },
        "notified_attendees": result.get("notified_attendees", 0),
    }), 200


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

    try:
        decision = EventDecision.from_payload(request.get_json(silent=True))
    except ValueError as error:
        raise BadRequest(str(error)) from error
    updated = _apply_intake_transition(
        event, user, EventTransition(decision.status), decision=True, reason=decision.reason,
    )
    return jsonify({"event": event_response(updated, user)}), 200


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
    # R11 (SCRUM-140): the Lead oversees every event, so it may read a clarification on any
    # non-draft event — this is what unblocks its detail screen. Everyone else must be
    # related to the event (Coordinators stay record-scoped; SCRUM-54 is list-only). This
    # mirrors the event-read rule's Lead exemption without opening the Safety Officer
    # window, which has no clarification use.
    lead_oversight = user.get("role") == "Event Coordinator Lead" and event["status"] != "Draft"
    if not lead_oversight:
        require_related_user(user, event, action="view_clarification")
    return jsonify({"clarification": get_pending_clarification(event_id)}), 200


@events.route("/<event_id>/change-requests", methods=["GET", "POST"])
def change_requests(event_id):
    """List or create organiser change requests for a submitted event."""
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")
    require_event_access(event_id, user)

    if request.method == "GET":
        require_role(user, "Organiser", "Coordinator", action="view_change_requests")
        return jsonify({"change_requests": get_change_requests(event_id)}), 200

    require_role(user, "Organiser", action="create_change_request")
    if event.get("organiser_id") != user["id"]:
        raise Forbidden("Only the Organiser who owns this request can raise a change request.")
    if event.get("status") == "Completed":
        raise Conflict(_COMPLETED_READ_ONLY)
    if event.get("status") == "Cancelled":
        raise Conflict(_CANCELLED_READ_ONLY)
    if event.get("status") in {"Draft", "Rejected", "Cancelled"}:
        raise Conflict("Change requests are only available after an event is submitted.")
    if event.get("coordinator_id") is None:
        raise Conflict("This event has no assigned Coordinator yet.")

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or "description" not in data or set(data) - {
        "description", "changes",
    }:
        raise BadRequest("Send a description and, optionally, the proposed changes.")
    description = data["description"]
    if not isinstance(description, str) or not 1 <= len(description.strip()) <= 2000:
        raise BadRequest("A change description of 1 to 2000 characters is required.")
    if "changes" in data:
        # SCRUM-138: structured proposed values, applied when the Coordinator approves.
        try:
            proposal = ChangeRequestProposal.from_payload(data["changes"], event)
        except ValueError as error:
            problem = error.args[0]
            if isinstance(problem, dict):
                return jsonify({
                    "error": "Please check the proposed changes.", "fields": problem,
                }), 400
            raise BadRequest(problem) from error
        saved = create_change_request(
            event_id, user["id"], description.strip(), requested_changes=proposal.changes,
        )
    else:
        saved = create_change_request(event_id, user["id"], description.strip())
    add_status_history(
        event_id, event["status"], event["status"], user["id"],
        action="change_requested", note=description.strip(),
    )
    create_notification(
        event["coordinator_id"], event_id, "event_change_request",
        "The organiser submitted a change request for your event.",
    )
    return jsonify({"change_request": saved}), 201


@events.patch("/<event_id>/change-requests/<int:request_id>")
def review_change_request(event_id, request_id):
    """Allow only the assigned Coordinator to record a first review decision."""
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = require_acting_user()
    require_role(user, "Coordinator", action="review_change_request")
    event = get_event_by_id(event_id)
    if event is None:
        raise NotFound("Event not found.")
    require_related_user(user, event, action="review_change_request")
    if event.get("coordinator_id") != user["id"]:
        raise Forbidden("Only the assigned Coordinator can review this request.")
    if event.get("status") == "Completed":
        raise Conflict(_COMPLETED_READ_ONLY)
    if event.get("status") == "Cancelled":
        raise Conflict(_CANCELLED_READ_ONLY)

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) - {"status", "review_note"} or "status" not in data:
        raise BadRequest("Send status and an optional review_note.")
    status = data["status"]
    if status not in {"Under Review", "Approved", "Rejected", "Implemented"}:
        raise BadRequest("Choose a valid change request status.")
    review_note = data.get("review_note")
    if review_note is not None and (
        not isinstance(review_note, str) or len(review_note.strip()) > 2000
    ):
        raise BadRequest("The review note must be at most 2000 characters.")
    existing = next(
        (item for item in get_change_requests(event_id) if item.get("id") == request_id),
        None,
    )
    if existing is None:
        raise NotFound("Change request not found.")
    current_status = existing.get("status")
    allowed_transitions = {
        "Pending": {"Under Review", "Approved", "Rejected"},
        "Under Review": {"Approved", "Rejected"},
        "Approved": {"Implemented"},
    }
    if status not in allowed_transitions.get(current_status, set()):
        raise Conflict("This change request cannot move to that status.")
    note = review_note.strip() if isinstance(review_note, str) and review_note.strip() else None
    if status == "Approved" and existing.get("requested_changes"):
        # SCRUM-138: apply the values, record the decision, flag a significant change
        # and notify, all in one database transaction (or none of it).
        result = approve_change_request_record(event_id, request_id, user["id"], note)
        return jsonify({
            "change_request": result["change_request"],
            "event": event_response(result["event"], user),
            "affected": result.get("affected", {}),
        }), 200
    updated = update_change_request(
        event_id, request_id, current_status, status, user["id"],
        review_note.strip() if isinstance(review_note, str) and review_note.strip() else None,
    )
    add_status_history(
        event_id,
        event["status"],
        event["status"],
        user["id"],
        action=f"change_request_{status.lower().replace(' ', '_')}",
        note=review_note.strip() if isinstance(review_note, str) and review_note.strip() else None,
    )
    create_notification(
        event["organiser_id"], event_id, "event_change_request_updated",
        f"Your change request status is now {status}.",
    )
    return jsonify({"change_request": updated}), 200


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

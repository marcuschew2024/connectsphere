"""Read the current user's in-app notifications (Organisers; Coordinators since SCRUM-130)."""

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import Forbidden, HTTPException

from .acting_user import require_acting_user
from .event_repository import get_notifications_for_user
from .rbac import require_role

notifications = Blueprint("notifications", __name__, url_prefix="/notifications")


@notifications.after_request
def prevent_caching(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@notifications.errorhandler(HTTPException)
def json_error(error):
    return jsonify({"error": error.description}), error.code


@notifications.get("")
def list_notifications():
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")

    user = require_acting_user()
    # SCRUM-130: Coordinators are told when an event is assigned to or moved away
    # from them. Each user only ever reads notifications addressed to them.
    require_role(user, "Organiser", "Coordinator", action="view_notifications")
    return jsonify({"notifications": get_notifications_for_user(user["id"])}), 200

"""Read the acting user's in-app notifications (any authenticated role, SCRUM-49)."""

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import Forbidden, HTTPException

from .acting_user import require_acting_user
from .event_repository import get_notifications_for_user

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
    # SCRUM-49 / R07: no role gate. Every role has a Home feed; the reader returns
    # only rows addressed to this user (recipient_id) or their role pool
    # (recipient_role), so record-level isolation still holds.
    return jsonify(
        {"notifications": get_notifications_for_user(user["id"], user["role"])}
    ), 200

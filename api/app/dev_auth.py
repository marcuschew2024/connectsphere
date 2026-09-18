"""Passwordless development endpoints. Not registered outside development."""

from flask import Blueprint, current_app, jsonify, request, session
from werkzeug.exceptions import BadRequest, Forbidden, HTTPException, NotFound, ServiceUnavailable

from .acting_user import dev_switcher_enabled, get_acting_user, require_acting_user
from .users import get_demo_user, list_demo_users

dev_auth = Blueprint("dev_auth", __name__, url_prefix="/dev")


@dev_auth.before_request
def protect_dev_endpoints():
    if not dev_switcher_enabled():
        raise NotFound()
    # Only our configured frontend may change a browser's acting user or act as it.
    if request.method in {"POST", "DELETE"}:
        if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
            raise Forbidden("Request must come from the configured frontend origin.")


@dev_auth.after_request
def prevent_caching(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@dev_auth.errorhandler(HTTPException)
def json_error(error):
    return jsonify({"error": error.description}), error.code


@dev_auth.get("/users")
def users():
    demo_users = list_demo_users()
    if not demo_users:
        raise ServiceUnavailable("No demo users found. Run supabase/seed_users.sql first.")
    return jsonify({"users": demo_users})


@dev_auth.get("/session")
def current_session():
    return jsonify({"user": get_acting_user()})


@dev_auth.post("/session")
def switch_user():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {"user_id"}:
        raise BadRequest("Send a JSON object containing only user_id.")

    user = get_demo_user(data["user_id"])
    if user is None:
        raise BadRequest("Choose an existing demo user.")

    # Store only the ID. The name and role are read from the database on each request.
    session.clear()
    session["acting_user_id"] = user["id"]
    return jsonify({"user": user})


@dev_auth.delete("/session")
def clear_session():
    session.clear()
    return jsonify({"user": None})


@dev_auth.post("/actions/test")
def test_action():
    """Demonstrate attribution before real event/booking actions are implemented."""
    user = require_acting_user()
    # Attribution always comes from Flask's session, even if the body claims another ID.
    current_app.logger.info(
        "test_action actor_user_id=%s role=%s", user["id"], user["role"]
    )
    return jsonify({"action": "test_action", "actor": user})

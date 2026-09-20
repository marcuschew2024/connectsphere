"""Login, logout, and session endpoints for SCRUM-20 (US-1.1 Secure login)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import bcrypt
from flask import Blueprint, current_app, g, jsonify, request, session
from werkzeug.exceptions import BadRequest, Forbidden, HTTPException, TooManyRequests

from .supabase_client import get_supabase_client

auth = Blueprint("auth", __name__, url_prefix="/auth")

# Lock account for 15 minutes after this many consecutive failures.
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

# A throwaway bcrypt hash, computed once at import. When the email is unknown (or the
# account has no password), we still run bcrypt against this so the response takes the
# same time as a real password check. Without it, "unknown email" returns noticeably
# faster than "wrong password", letting an attacker enumerate valid emails by timing —
# even though the error message is identical.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equaliser", bcrypt.gensalt())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_same_origin() -> None:
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")


def _get_user_by_email(email: str) -> dict | None:
    """Return the app_users row for this email, or None."""
    client = get_supabase_client()
    if client is None:
        return None
    rows = (
        client.table("app_users")
        .select("id,display_name,role,password_hash,failed_attempts,locked_until")
        .eq("email", email)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _record_audit(
    event_type: str,
    *,
    user_id: int | None = None,
    attempted_email: str | None = None,
) -> None:
    """Append one row to auth_audit_log. Never raises — audit failures must not break login."""
    try:
        client = get_supabase_client()
        if client is None:
            return
        client.table("auth_audit_log").insert(
            {
                "user_id": user_id,
                "event_type": event_type,
                "attempted_email": attempted_email,
                "ip_address": request.remote_addr,
            }
        ).execute()
    except Exception:
        current_app.logger.exception("auth_audit_log insert failed (non-fatal)")


def _increment_failed_attempts(user_id: int, current_count: int) -> None:
    """Increment the failure counter; lock the account if the threshold is reached."""
    client = get_supabase_client()
    if client is None:
        return
    new_count = current_count + 1
    patch: dict = {"failed_attempts": new_count}
    if new_count >= MAX_FAILED_ATTEMPTS:
        patch["locked_until"] = (
            datetime.now(UTC) + timedelta(minutes=LOCKOUT_MINUTES)
        ).isoformat()
    client.table("app_users").update(patch).eq("id", user_id).execute()


def _reset_failed_attempts(user_id: int) -> None:
    client = get_supabase_client()
    if client is None:
        return
    client.table("app_users").update(
        {"failed_attempts": 0, "locked_until": None}
    ).eq("id", user_id).execute()


def get_authenticated_user() -> dict | None:
    """Return the session user dict, or None if not logged in."""
    if "auth_user" not in g:
        user_id = session.get("user_id")
        if user_id is None:
            g.auth_user = None
        else:
            client = get_supabase_client()
            if client is None:
                g.auth_user = None
            else:
                rows = (
                    client.table("app_users")
                    .select("id,display_name,role")
                    .eq("id", user_id)
                    .limit(1)
                    .execute()
                    .data
                )
                g.auth_user = rows[0] if rows else None
                if g.auth_user is None:
                    # Session references a deleted user — clear it.
                    session.clear()
    return g.auth_user


# ---------------------------------------------------------------------------
# Error handler
# ---------------------------------------------------------------------------

@auth.errorhandler(HTTPException)
def json_error(error: HTTPException):
    return jsonify({"error": error.description}), error.code


@auth.after_request
def prevent_caching(response):
    response.headers["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@auth.post("/login")
def login():
    """
    Authenticate with email + password.

    Returns 200 + user on success.
    Returns 401 with a generic message on bad credentials (no hint about which field is wrong).
    Returns 429 when the account is temporarily locked.
    """
    _require_same_origin()

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not {"email", "password"} <= set(data):
        raise BadRequest("Send a JSON object with email and password.")

    email = data.get("email", "")
    password = data.get("password", "")

    # Basic type checks — never log the submitted password.
    if not isinstance(email, str) or not isinstance(password, str):
        raise BadRequest("email and password must be strings.")
    if not email or not password:
        raise BadRequest("email and password are required.")

    # Generic message for all auth failures (prevents email enumeration).
    GENERIC_ERROR = "Invalid email or password."

    user = _get_user_by_email(email.lower().strip())

    if user is None:
        # Spend the same time as a real verification (see _DUMMY_HASH) so an unknown
        # email is indistinguishable by timing from a wrong password.
        bcrypt.checkpw(password.encode(), _DUMMY_HASH)
        _record_audit("login_failure", attempted_email=email)
        return jsonify({"error": GENERIC_ERROR}), 401

    # Check lockout before verifying password to prevent timing-based enumeration.
    locked_until = user.get("locked_until")
    if locked_until:
        locked_dt = datetime.fromisoformat(locked_until)
        if datetime.now(UTC) < locked_dt:
            _record_audit("login_failure", user_id=user["id"], attempted_email=email)
            remaining = int((locked_dt - datetime.now(UTC)).total_seconds() // 60) + 1
            raise TooManyRequests(
                f"Account temporarily locked. Try again in {remaining} minute(s)."
            )

    stored_hash = user.get("password_hash")
    if not stored_hash:
        # User exists but has no password set (demo-only account). Equalise timing here
        # too so "no password" cannot be distinguished from "wrong password".
        bcrypt.checkpw(password.encode(), _DUMMY_HASH)
        _record_audit("login_failure", user_id=user["id"], attempted_email=email)
        return jsonify({"error": GENERIC_ERROR}), 401

    # bcrypt.checkpw is constant-time.
    password_correct = bcrypt.checkpw(password.encode(), stored_hash.encode())

    if not password_correct:
        _increment_failed_attempts(user["id"], user.get("failed_attempts", 0))
        _record_audit("login_failure", user_id=user["id"], attempted_email=email)
        # Re-fetch to check if this failure just triggered a lock.
        updated = _get_user_by_email(email.lower().strip())
        if updated and updated.get("locked_until"):
            _record_audit("account_locked", user_id=user["id"], attempted_email=email)
        return jsonify({"error": GENERIC_ERROR}), 401

    # Credentials valid — start session.
    _reset_failed_attempts(user["id"])
    session.clear()
    session["user_id"] = user["id"]
    session.permanent = True  # Expiry is set by PERMANENT_SESSION_LIFETIME in config.

    _record_audit("login_success", user_id=user["id"], attempted_email=email)
    current_app.logger.info("login user_id=%s", user["id"])

    return jsonify({
        "user": {
            "id": user["id"],
            "display_name": user["display_name"],
            "role": user["role"],
        }
    }), 200


@auth.post("/logout")
def logout():
    _require_same_origin()
    user_id = session.get("user_id")
    session.clear()
    if user_id:
        _record_audit("logout", user_id=user_id)
        current_app.logger.info("logout user_id=%s", user_id)
    return jsonify({"user": None}), 200


@auth.get("/session")
def current_session():
    """Return the currently logged-in user, or null."""
    user = get_authenticated_user()
    return jsonify({"user": user}), 200

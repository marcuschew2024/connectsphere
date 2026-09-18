"""Resolve who is acting. Real authentication will replace this temporary lookup."""

from flask import current_app, g, session
from werkzeug.exceptions import Unauthorized

from .users import get_demo_user


def dev_switcher_enabled() -> bool:
    """Both settings are required; debug/testing mode alone never enables this."""
    return (
        current_app.config.get("APP_ENV") == "development"
        and current_app.config.get("DEV_ROLE_SWITCHER_ENABLED") is True
    )


def get_acting_user() -> dict | None:
    """Look up the signed session's ID in Supabase once per request."""
    # Old development cookies must never establish an identity in production.
    if not dev_switcher_enabled():
        return None

    if "acting_user" not in g:
        user_id = session.get("acting_user_id")
        g.acting_user = get_demo_user(user_id) if user_id else None
        if user_id and g.acting_user is None:
            session.pop("acting_user_id", None)
    return g.acting_user


def require_acting_user() -> dict:
    """Use this in action handlers instead of accepting a user ID from the browser."""
    user = get_acting_user()
    if user is None:
        raise Unauthorized("Select a demo user first.")
    return user

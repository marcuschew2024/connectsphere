"""Application factory for the ConnectSphere REST API."""

from __future__ import annotations

import os
from datetime import timedelta

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from .acting_user import dev_switcher_enabled, get_acting_user
from .auth import auth, get_authenticated_user
from .dev_auth import dev_auth
from .events import events

load_dotenv()


def create_app(config: dict | None = None) -> Flask:
    """Create and configure the Flask application.

    Args:
        config: Optional overrides applied to ``app.config``.

    Returns:
        A configured :class:`~flask.Flask` instance.
    """
    app = Flask(__name__)
    app.config.update(
        APP_ENV=os.environ.get("APP_ENV", "production"),
        DEV_ROLE_SWITCHER_ENABLED=os.environ.get("DEV_ROLE_SWITCHER_ENABLED", "").lower() == "true",
        SECRET_KEY=os.environ.get("SECRET_KEY"),
        FRONTEND_ORIGIN=os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000"),
        SESSION_COOKIE_NAME="connectsphere_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Sessions expire after 30 minutes of inactivity.
        PERMANENT_SESSION_LIFETIME=timedelta(minutes=30),
        SMTP_HOST=os.environ.get("SMTP_HOST", ""),
        SMTP_PORT=int(os.environ.get("SMTP_PORT", "1025")),
        SMTP_FROM=os.environ.get("SMTP_FROM", "ConnectSphere <no-reply@connectsphere.test>"),
        SMTP_STARTTLS=os.environ.get("SMTP_STARTTLS", "").lower() == "true",
        SMTP_USERNAME=os.environ.get("SMTP_USERNAME", ""),
        SMTP_PASSWORD=os.environ.get("SMTP_PASSWORD", ""),
    )

    if config:
        app.config.update(config)

    app.register_blueprint(events)
    app.register_blueprint(auth)

    # Allow the frontend origin. Defaults to the local Next.js dev server.
    CORS(
        app,
        resources={r"/*": {"origins": app.config["FRONTEND_ORIGIN"]}},
        supports_credentials=True,
    )

    with app.app_context():
        if dev_switcher_enabled():
            if not app.config["SECRET_KEY"]:
                raise ValueError("Set SECRET_KEY before enabling the development role switcher.")
            app.register_blueprint(dev_auth)
            app.logger.setLevel("INFO")

    @app.get("/health")
    def health():  # type: ignore[no-untyped-def]
        return jsonify({"status": "ok"})

    @app.get("/session")
    def current_session():
        """Return current identity: real auth session, dev switcher, or null."""
        # In production: only real auth sessions are valid.
        # In development: real auth takes priority; fall back to dev switcher.
        user = get_authenticated_user()
        if user is None and dev_switcher_enabled():
            try:
                user = get_acting_user()
            except HTTPException as error:
                response = jsonify({"error": error.description})
                response.status_code = error.code
                response.headers["Cache-Control"] = "no-store"
                return response
        response = jsonify({"user": user})
        response.headers["Cache-Control"] = "no-store"
        return response

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=5001)

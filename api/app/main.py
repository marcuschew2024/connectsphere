"""Application factory for the ConnectSphere REST API."""

from __future__ import annotations

import os

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS

from .acting_user import dev_switcher_enabled
from .dev_auth import dev_auth

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
    )

    if config:
        app.config.update(config)

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

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=5001)

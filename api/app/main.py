"""Application factory for the ConnectSphere REST API."""

from __future__ import annotations

import os

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS

load_dotenv()


def create_app(config: dict | None = None) -> Flask:
    """Create and configure the Flask application.

    Args:
        config: Optional overrides applied to ``app.config``.

    Returns:
        A configured :class:`~flask.Flask` instance.
    """
    app = Flask(__name__)

    if config:
        app.config.update(config)

    # Allow the frontend origin. Defaults to the local Next.js dev server.
    frontend_origin = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")
    CORS(app, resources={r"/*": {"origins": frontend_origin}})

    @app.get("/health")
    def health():  # type: ignore[no-untyped-def]
        return jsonify({"status": "ok"})

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=5000)

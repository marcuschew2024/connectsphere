"""Run the real Flask app against the allowlisted disposable PostgREST service.

This test-only adapter replaces the database client, never the HTTP handlers,
authentication, business rules or repositories. There are no fixture HTTP routes.
Run from the repository root after the SQL harness; never use hosted credentials.
"""

from __future__ import annotations

import importlib
import os
import pkgutil
import sys
from pathlib import Path


def create_test_app():
    url = os.environ.get("POSTGREST_TEST_URL")
    # Two fixed local acceptance ports allow independent worktrees to verify without
    # reusing or resetting another task's database. Hosted targets remain forbidden.
    if url not in {
        "http://127.0.0.1:55433", "http://localhost:55433",
        "http://127.0.0.1:55434", "http://localhost:55434",
    }:
        raise ValueError("POSTGREST_TEST_URL must name the disposable acceptance service.")
    # main.py loads .env at import time; empty values prevent local secrets loading.
    for key in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SECRET_KEY"):
        os.environ[key] = ""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))
    from postgrest import SyncPostgrestClient

    import app

    database = SyncPostgrestClient(url)
    for info in pkgutil.iter_modules(app.__path__):
        module = importlib.import_module(f"app.{info.name}")
        if hasattr(module, "get_supabase_client"):
            module.get_supabase_client = lambda: database
    return app.create_app({
        "APP_ENV": "production",
        "DEV_ROLE_SWITCHER_ENABLED": False,
        "SECRET_KEY": "disposable-integrated-test-only",
        "FRONTEND_ORIGIN": "http://localhost:3107",
    })


if __name__ == "__main__":
    create_test_app().run(host="127.0.0.1", port=5001, use_reloader=False)

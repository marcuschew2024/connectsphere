"""Fail-closed identity lookup, runtime demo protection and non-fatal audit outages."""

import importlib
import runpy

import pytest
from flask import Flask

from app import auth
from app.rbac import log_access_denied

from .repository_doubles import database_result


def test_missing_auth_database_cannot_resolve_an_identity_or_write_counters(app, monkeypatch):
    monkeypatch.setattr(auth, "get_supabase_client", lambda: None)
    with app.test_request_context():
        from flask import session
        session["user_id"] = 10
        assert auth.get_authenticated_user() is None
        assert auth._get_user_by_email("alice@example.com") is None
        assert auth._increment_failed_attempts(10, 4) is None
        assert auth._reset_failed_attempts(10) is None
        assert auth._record_audit("login_failure", user_id=10) is None


@pytest.mark.parametrize("kind", ["login", "access_denial"])
def test_audit_failure_does_not_turn_an_authentication_outcome_into_a_crash(
    app, monkeypatch, caplog, kind,
):
    client, _ = database_result(error=ConnectionError("audit store unavailable"))
    module = importlib.import_module("app.auth" if kind == "login" else "app.rbac")
    monkeypatch.setattr(module, "get_supabase_client", lambda: client)
    with app.test_request_context():
        if kind == "login":
            auth._record_audit("login_failure", user_id=10)
        else:
            log_access_denied({"id": 10, "role": "Attendee"}, action="edit", reason="not owner")
    assert "non-fatal" in caplog.text


def test_demo_routes_recheck_the_runtime_environment(app):
    app.config["APP_ENV"] = "production"
    response = app.test_client().get("/dev/users")
    assert response.status_code == 404


def test_direct_api_entry_point_uses_the_documented_host_and_port(monkeypatch):
    calls = []
    monkeypatch.setattr(Flask, "run", lambda self, **kwargs: calls.append(kwargs))
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DEV_ROLE_SWITCHER_ENABLED", "false")
    with pytest.warns(RuntimeWarning, match="app.main"):
        runpy.run_module("app.main", run_name="__main__")
    assert calls == [{"host": "0.0.0.0", "port": 5001}]

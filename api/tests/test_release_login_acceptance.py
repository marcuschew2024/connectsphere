"""Core 1: cumulative password failures, stored lockout, reset and durable audit."""

import importlib
import os
from datetime import UTC, datetime

import pytest
from postgrest import SyncPostgrestClient

from app import create_app

from .conftest import ORIGIN
from .test_role_accounts_acceptance import PASSWORD

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"), reason="Disposable acceptance database required",
)


@pytest.fixture
def account(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in {"http://127.0.0.1:55433", "http://localhost:55433"}
    with SyncPostgrestClient(url) as db:
        for name in ("auth", "users"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        user = db.table("app_users").select("id,email").eq(
            "email", "attendee.b@connectsphere.test").execute().data[0]
        reset = {"failed_attempts": 0, "locked_until": None}
        db.table("app_users").update(reset).eq("id", user["id"]).execute()
        app = create_app({"TESTING": True, "APP_ENV": "production",
                          "DEV_ROLE_SWITCHER_ENABLED": False, "SECRET_KEY": "test-only",
                          "FRONTEND_ORIGIN": ORIGIN["Origin"]})
        try:
            yield db, app, user
        finally:
            db.table("app_users").update(reset).eq("id", user["id"]).execute()


def attempt(client, user, password):
    return client.post("/auth/login", headers=ORIGIN,
                       json={"email": user["email"], "password": password})


def stored(db, user):
    return db.table("app_users").select("failed_attempts,locked_until").eq(
        "id", user["id"]).execute().data[0]


def test_five_real_failures_lock_across_clients_and_record_attributed_timestamps(account):
    db, app, user = account
    previous = db.table("auth_audit_log").select("id").order(
        "id", desc=True).limit(1).execute().data
    watermark = previous[0]["id"] if previous else 0
    for number in range(1, 6):
        client = app.test_client()
        assert attempt(client, user, "wrong-test-password").status_code == 401
        assert client.get("/session").json == {"user": None}
        saved = stored(db, user)
        assert saved["failed_attempts"] == number
        if number < 5:
            assert saved["locked_until"] is None
    assert datetime.fromisoformat(saved["locked_until"]) > datetime.now(UTC)
    # A new browser/session with the correct password still encounters the stored lock.
    assert attempt(app.test_client(), user, PASSWORD).status_code == 429
    rows = db.table("auth_audit_log").select("event_type,user_id,occurred_at").eq(
        "user_id", user["id"]).gt("id", watermark).order("id").execute().data
    assert sum(row["event_type"] == "login_failure" for row in rows) == 6
    assert sum(row["event_type"] == "account_locked" for row in rows) == 1
    timestamps = [datetime.fromisoformat(row["occurred_at"]) for row in rows]
    assert all(row["user_id"] == user["id"] for row in rows)
    assert all(stamp.utcoffset() is not None for stamp in timestamps)
    assert timestamps == sorted(timestamps)


def test_correct_fifth_attempt_resets_stored_failures_and_logout_invalidates_session(account):
    db, app, user = account
    client = app.test_client()
    for _ in range(4):
        assert attempt(client, user, "wrong-test-password").status_code == 401
    assert attempt(client, user, PASSWORD).status_code == 200
    assert stored(db, user) == {"failed_attempts": 0, "locked_until": None}
    assert client.get("/session").json["user"]["id"] == user["id"]
    assert client.post("/auth/logout", headers=ORIGIN).status_code == 200
    assert client.get("/session").json == {"user": None}

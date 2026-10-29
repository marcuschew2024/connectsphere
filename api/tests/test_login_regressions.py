"""SCRUM-20 regressions using real password checks and a stateful local user store.

This proves sequential login/session behaviour, not concurrent database locking
or deployment TLS. Existing auth tests are preserved unchanged.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import bcrypt
import pytest

from app import create_app

ORIGIN = {"Origin": "http://localhost:3000"}


@pytest.fixture
def login_store(monkeypatch):
    user = {
        "id": 10, "email": "alice@example.com", "display_name": "Alice",
        "role": "Organiser", "failed_attempts": 0, "locked_until": None,
        "password_hash": bcrypt.hashpw(b"CorrectPassword1!", bcrypt.gensalt(rounds=4)).decode(),
    }
    audit = []
    database = MagicMock()

    def table(name):
        query = MagicMock()
        filters, state = {}, {}
        query.select.return_value = query
        query.limit.return_value = query

        def equals(column, value):
            filters[column] = value
            return query

        def update(patch):
            state["patch"] = patch
            return query

        def insert(row):
            state["row"] = row
            return query

        def execute():
            if name == "auth_audit_log":
                audit.append(state["row"])
                return SimpleNamespace(data=[state["row"]])
            assert name == "app_users"
            if not all(user.get(key) == value for key, value in filters.items()):
                return SimpleNamespace(data=[])
            user.update(state.get("patch", {}))
            return SimpleNamespace(data=[dict(user)])

        query.eq.side_effect = equals
        query.update.side_effect = update
        query.insert.side_effect = insert
        query.execute.side_effect = execute
        return query

    database.table.side_effect = table
    monkeypatch.setattr("app.auth.get_supabase_client", lambda: database)
    app = create_app({
        "TESTING": True, "APP_ENV": "production", "DEV_ROLE_SWITCHER_ENABLED": False,
        "SECRET_KEY": "test-only-secret", "FRONTEND_ORIGIN": ORIGIN["Origin"],
    })
    return app, user, audit


def log_in(client, password="CorrectPassword1!"):
    return client.post("/auth/login", json={
        "email": "alice@example.com", "password": password,
    }, headers=ORIGIN)


def test_five_consecutive_failures_lock_the_account_and_reject_correct_password(login_store):
    app, user, audit = login_store
    client = app.test_client()
    before = datetime.now(UTC)
    for attempt in range(1, 6):
        assert log_in(client, "wrong password").status_code == 401
        assert user["failed_attempts"] == attempt
        if attempt < 5:
            assert user["locked_until"] is None
    locked_until = datetime.fromisoformat(user["locked_until"])
    assert before + timedelta(minutes=15) <= locked_until
    assert locked_until <= datetime.now(UTC) + timedelta(minutes=15)
    assert log_in(client).status_code == 429
    assert client.get("/auth/session").json["user"] is None
    assert any(row["event_type"] == "account_locked" and row["user_id"] == 10 for row in audit)


def test_success_after_four_failures_resets_counter_and_establishes_session(login_store):
    app, user, _ = login_store
    client = app.test_client()
    for _ in range(4):
        assert log_in(client, "wrong password").status_code == 401
    assert log_in(client).status_code == 200
    assert user["failed_attempts"] == 0
    assert user["locked_until"] is None
    assert client.get("/auth/session").json["user"]["id"] == 10


def test_expired_lock_allows_login_and_clears_lock(login_store):
    app, user, _ = login_store
    user.update(
        failed_attempts=5,
        locked_until=(datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
    )
    assert log_in(app.test_client()).status_code == 200
    assert user["failed_attempts"] == 0
    assert user["locked_until"] is None


def test_session_rejects_a_cookie_older_than_the_inactivity_limit(login_store, monkeypatch):
    app, _, _ = login_store
    client = app.test_client()
    assert log_in(client).status_code == 200
    assert client.get("/auth/session").json["user"]["id"] == 10
    past = datetime.now(UTC).timestamp() - app.permanent_session_lifetime.total_seconds() - 60
    serializer = app.session_interface.get_signing_serializer(app)
    with monkeypatch.context() as clock:
        clock.setattr("itsdangerous.timed.time.time", lambda: past)
        expired = serializer.dumps({"user_id": 10, "_permanent": True})
    client.set_cookie(app.config["SESSION_COOKIE_NAME"], expired)
    assert client.get("/auth/session").json["user"] is None


@pytest.mark.parametrize("payload", [
    None, [], {}, {"email": "alice@example.com"},
    {"email": 7, "password": "secret"}, {"email": "alice@example.com", "password": None},
    {"email": "", "password": "secret"}, {"email": "alice@example.com", "password": ""},
])
def test_malformed_login_does_not_establish_identity_or_change_failure_count(login_store, payload):
    app, user, audit = login_store
    client = app.test_client()
    assert client.post("/auth/login", json=payload, headers=ORIGIN).status_code == 400
    assert client.get("/auth/session").json["user"] is None
    assert user["failed_attempts"] == 0
    assert audit == []


@pytest.mark.parametrize("path", ["/auth/login", "/auth/logout"])
@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example"}])
def test_untrusted_auth_requests_preserve_the_existing_session(login_store, path, headers):
    app, _, _ = login_store
    client = app.test_client()
    assert log_in(client).status_code == 200
    response = client.post(path, json={
        "email": "alice@example.com", "password": "CorrectPassword1!",
    }, headers=headers)
    assert response.status_code == 403
    assert client.get("/auth/session").json["user"]["id"] == 10


def test_account_without_password_returns_generic_failure(login_store):
    app, user, audit = login_store
    user["password_hash"] = None
    client = app.test_client()
    response = log_in(client)
    assert response.status_code == 401
    assert response.json == {"error": "Invalid email or password."}
    assert client.get("/auth/session").json["user"] is None
    assert audit[-1]["event_type"] == "login_failure"
    assert audit[-1]["user_id"] == 10


def test_deleted_identity_invalidates_and_clears_an_existing_session(login_store):
    app, user, _ = login_store
    client = app.test_client()
    assert log_in(client).status_code == 200
    user["id"] = 11  # The original identity no longer exists in the stateful store.
    assert client.get("/auth/session").json["user"] is None
    with client.session_transaction() as saved_session:
        assert "user_id" not in saved_session


def test_logging_out_twice_does_not_invent_another_authenticated_logout(login_store):
    app, _, audit = login_store
    client = app.test_client()
    assert log_in(client).status_code == 200
    for _ in range(2):
        assert client.post("/auth/logout", headers=ORIGIN).status_code == 200
    assert [row["user_id"] for row in audit if row["event_type"] == "logout"] == [10]
    assert client.get("/auth/session").json["user"] is None

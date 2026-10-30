"""Tests for SCRUM-20: Secure login (TC-US1.1-01..08)."""

import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import bcrypt
import pytest

from app import create_app

ORIGIN = {"Origin": "http://localhost:3000"}
HASHED_PASSWORD = bcrypt.hashpw(b"CorrectPassword1!", bcrypt.gensalt()).decode()


def _make_user(
    *,
    password_hash=HASHED_PASSWORD,
    failed_attempts=0,
    locked_until=None,
    email="organiser@example.com",
    is_demo=False,
):
    return {
        "id": 10,
        "display_name": "Alice Organiser",
        "role": "Organiser",
        "email": email,
        "password_hash": password_hash,
        "failed_attempts": failed_attempts,
        "locked_until": locked_until,
        "is_demo": is_demo,
    }


@pytest.fixture
def auth_db(monkeypatch):
    """Fake Supabase client that holds one real user and records updates."""
    users = [_make_user()]
    audit_log = []
    updates = []  # Each update call appends {"table": ..., "patch": ..., "filter": ...}

    client = MagicMock()

    def table(name):
        q = MagicMock()
        state = {"table": name, "filters": {}, "inserted": None}

        def select(*_):
            return q

        def eq(col, val):
            state["filters"][col] = val
            return q

        def limit(_):
            return q

        def insert(data):
            state["inserted"] = data
            return q

        def update(data):
            state["patch"] = data
            return q

        def execute():
            if "patch" in state:
                updates.append({
                    "table": state["table"],
                    "patch": state["patch"],
                    "filters": dict(state["filters"]),
                })
                return SimpleNamespace(data=[])
            if state["inserted"] is not None:
                audit_log.append(state["inserted"])
                return SimpleNamespace(data=[state["inserted"]])
            # SELECT
            if name == "app_users":
                return SimpleNamespace(data=[
                    {k: u[k] for k in u}
                    for u in users
                    if all(u.get(k) == v for k, v in state["filters"].items())
                ])
            return SimpleNamespace(data=[])

        q.select.side_effect = select
        q.eq.side_effect = eq
        q.limit.side_effect = limit
        q.insert.side_effect = insert
        q.update.side_effect = update
        q.execute.side_effect = execute
        return q

    client.table.side_effect = table

    def rpc(name, params):
        # SCRUM-141: the atomic failed-login RPC. Mutate the in-memory user the same way
        # register_failed_login() does, and return the new counter + lock state.
        assert name == "register_failed_login"
        q = MagicMock()

        def rpc_execute():
            user = next((u for u in users if u["id"] == params["p_user_id"]), None)
            if user is None:
                return SimpleNamespace(data=None)
            user["failed_attempts"] = user.get("failed_attempts", 0) + 1
            if user["failed_attempts"] >= params["p_max_attempts"]:
                user["locked_until"] = (
                    datetime.now(UTC) + timedelta(minutes=params["p_lockout_minutes"])
                ).isoformat()
            return SimpleNamespace(data={
                "failed_attempts": user["failed_attempts"],
                "locked_until": user["locked_until"],
            })

        q.execute.side_effect = rpc_execute
        return q

    client.rpc.side_effect = rpc
    monkeypatch.setattr("app.auth.get_supabase_client", lambda: client)
    return users, audit_log, updates


@pytest.fixture
def app(auth_db):
    return create_app({
        "TESTING": True,
        "APP_ENV": "production",  # Real auth mode; dev switcher is off.
        "DEV_ROLE_SWITCHER_ENABLED": False,
        "SECRET_KEY": "test-only-secret",
        "FRONTEND_ORIGIN": ORIGIN["Origin"],
    })


# ---------------------------------------------------------------------------
# TC-US1.1-01: Valid credentials → 200 + user, session cookie set
# ---------------------------------------------------------------------------
def test_login_valid_credentials(app, auth_db):
    with app.test_client() as client:
        resp = client.post(
            "/auth/login",
            json={"email": "organiser@example.com", "password": "CorrectPassword1!"},
            headers=ORIGIN,
        )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["user"]["role"] == "Organiser"
    assert data["user"]["display_name"] == "Alice Organiser"


# ---------------------------------------------------------------------------
# TC-US1.1-02: Wrong password → 401, generic message (no "wrong password" leak)
# ---------------------------------------------------------------------------
def test_login_wrong_password_generic_error(app, auth_db):
    with app.test_client() as client:
        resp = client.post(
            "/auth/login",
            json={"email": "organiser@example.com", "password": "WrongPassword"},
            headers=ORIGIN,
        )
    assert resp.status_code == 401
    msg = resp.get_json()["error"]
    assert "password" not in msg.lower() or "invalid" in msg.lower()
    assert "wrong" not in msg.lower()


# ---------------------------------------------------------------------------
# TC-US1.1-03: Non-existent email → 401, same generic message (no enumeration)
# ---------------------------------------------------------------------------
def test_login_unknown_email_same_error(app, auth_db):
    with app.test_client() as client:
        wrong = client.post(
            "/auth/login",
            json={"email": "nobody@example.com", "password": "anything"},
            headers=ORIGIN,
        )
        valid_wrong = client.post(
            "/auth/login",
            json={"email": "organiser@example.com", "password": "WrongPassword"},
            headers=ORIGIN,
        )
    assert wrong.status_code == 401
    assert valid_wrong.status_code == 401
    assert wrong.get_json()["error"] == valid_wrong.get_json()["error"]


# ---------------------------------------------------------------------------
# TC-US1.1-04: Account locked after MAX_FAILED_ATTEMPTS → 429
# ---------------------------------------------------------------------------
def test_login_sequential_failures_lock_then_recover(app, auth_db):
    """TC-US1.1-04: five *real* consecutive wrong passwords lock the account (429 even with
    the correct password); once the lock window elapses, a correct login recovers and resets
    the counter. No preset counter — the failures are counted through the atomic RPC."""
    users, audit_log, updates = auth_db

    def attempt(password):
        with app.test_client() as client:
            return client.post(
                "/auth/login",
                json={"email": "organiser@example.com", "password": password},
                headers=ORIGIN,
            )

    # Four failures: counted but still unlocked (401, not 429).
    for _ in range(4):
        assert attempt("WrongPassword").status_code == 401
    assert users[0]["locked_until"] is None

    # The fifth consecutive failure reaches the threshold and locks the account.
    assert attempt("WrongPassword").status_code == 401
    assert users[0]["failed_attempts"] == 5
    assert users[0]["locked_until"] is not None
    assert "account_locked" in [entry["event_type"] for entry in audit_log]

    # While locked, even the correct password is refused.
    assert attempt("CorrectPassword1!").status_code == 429

    # Once the lock window has elapsed, a correct login succeeds and resets the counter.
    users[0]["locked_until"] = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    assert attempt("CorrectPassword1!").status_code == 200
    assert any(update.get("patch", {}).get("failed_attempts") == 0 for update in updates)


# ---------------------------------------------------------------------------
# TC-US1.1-05: Locked account rejects even correct password → 429
# ---------------------------------------------------------------------------
def test_login_locked_account_rejects_correct_password(app, auth_db):
    users, _, _ = auth_db
    users[0]["locked_until"] = (datetime.now(UTC) + timedelta(minutes=10)).isoformat()
    users[0]["failed_attempts"] = 5

    with app.test_client() as client:
        resp = client.post(
            "/auth/login",
            json={"email": "organiser@example.com", "password": "CorrectPassword1!"},
            headers=ORIGIN,
        )
    assert resp.status_code == 429


# ---------------------------------------------------------------------------
# TC-US1.1-05: Session expires after inactivity (genuine timed journey)
# ---------------------------------------------------------------------------
def test_session_expires_after_inactivity(auth_db):
    """A session left idle past PERMANENT_SESSION_LIFETIME is no longer authenticated —
    exercised as a real timed journey, not asserted from config."""
    short_app = create_app({
        "TESTING": True,
        "APP_ENV": "production",
        "DEV_ROLE_SWITCHER_ENABLED": False,
        "SECRET_KEY": "test-only-secret",
        "FRONTEND_ORIGIN": ORIGIN["Origin"],
        "PERMANENT_SESSION_LIFETIME": timedelta(seconds=1),
    })
    with short_app.test_client() as client:
        assert client.post(
            "/auth/login",
            json={"email": "organiser@example.com", "password": "CorrectPassword1!"},
            headers=ORIGIN,
        ).status_code == 200
        # Authenticated immediately after login.
        assert client.get("/auth/session").get_json()["user"] is not None
        # Exceed the one-second lifetime. itsdangerous ages sessions in whole seconds and
        # expires on age > max_age, so sleep past two seconds to clear the boundary reliably.
        time.sleep(2.2)
        # The idle session cookie is no longer accepted.
        assert client.get("/auth/session").get_json()["user"] is None


# ---------------------------------------------------------------------------
# TC-US1.1-06: Successful login resets failed_attempts counter
# ---------------------------------------------------------------------------
def test_login_success_resets_failed_attempts(app, auth_db):
    users, _, updates = auth_db
    users[0]["failed_attempts"] = 3

    with app.test_client() as client:
        client.post(
            "/auth/login",
            json={"email": "organiser@example.com", "password": "CorrectPassword1!"},
            headers=ORIGIN,
        )
    reset_updates = [
        u for u in updates
        if u.get("patch", {}).get("failed_attempts") == 0
    ]
    assert reset_updates, "Expected failed_attempts to be reset to 0 on success"


# ---------------------------------------------------------------------------
# TC-US1.1-07: Logout clears session → /auth/session returns null
# ---------------------------------------------------------------------------
def test_logout_clears_session(app, auth_db):
    with app.test_client() as client:
        client.post(
            "/auth/login",
            json={"email": "organiser@example.com", "password": "CorrectPassword1!"},
            headers=ORIGIN,
        )
        client.post("/auth/logout", headers=ORIGIN)
        resp = client.get("/auth/session")
    assert resp.get_json()["user"] is None


# ---------------------------------------------------------------------------
# TC-US1.1-08: Login and logout events recorded in audit log
# ---------------------------------------------------------------------------
def test_login_logout_audit_logged(app, auth_db):
    _, audit_log, _ = auth_db
    with app.test_client() as client:
        client.post(
            "/auth/login",
            json={"email": "organiser@example.com", "password": "CorrectPassword1!"},
            headers=ORIGIN,
        )
        client.post("/auth/logout", headers=ORIGIN)

    event_types = [entry["event_type"] for entry in audit_log]
    assert "login_success" in event_types
    assert "logout" in event_types

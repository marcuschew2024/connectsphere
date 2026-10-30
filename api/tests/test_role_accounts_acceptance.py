"""Real database verification of SCRUM-139: every role has a working password account."""

import importlib
import os

import pytest
from postgrest import SyncPostgrestClient

from app import create_app

from .conftest import ORIGIN

pytestmark = pytest.mark.skipif(not os.environ.get("POSTGREST_TEST_URL"),
                                reason="Disposable acceptance services are not running")

# Set by supabase/tests/run.sh when it seeds the disposable database.
PASSWORD = "disposable-test-only-password"

ACCOUNTS = {
    "organiser.a@connectsphere.test": "Organiser",
    "organiser.b@connectsphere.test": "Organiser",
    "coordinator.a@connectsphere.test": "Coordinator",
    "coordinator.b@connectsphere.test": "Coordinator",
    "coordinator-lead@connectsphere.test": "Event Coordinator Lead",
    "venue-staff@connectsphere.test": "Venue Staff",
    "tech-support@connectsphere.test": "Tech Support",
    "safety-officer@connectsphere.test": "Safety Officer",
    "attendee.a@connectsphere.test": "Attendee",
    "attendee.b@connectsphere.test": "Attendee",
}


@pytest.fixture
def production_app(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in ("http://127.0.0.1:55433", "http://localhost:55433")
    with SyncPostgrestClient(url) as db:
        for name in ("auth", "users"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        yield db, create_app({"TESTING": True, "APP_ENV": "production",
                              "DEV_ROLE_SWITCHER_ENABLED": False, "SECRET_KEY": "test-only",
                              "FRONTEND_ORIGIN": ORIGIN["Origin"]})


def login(client, email, password=PASSWORD):
    return client.post("/auth/login", json={"email": email, "password": password}, headers=ORIGIN)


@pytest.mark.parametrize(("email", "role"), ACCOUNTS.items())
def test_each_seeded_account_signs_in_with_its_role_in_production(production_app, email, role):
    _, app = production_app
    client = app.test_client()

    response = login(client, email)

    assert response.status_code == 200, response.json
    assert response.json["user"]["role"] == role
    assert client.get("/session").json["user"] == response.json["user"]


def test_seed_covers_all_seven_roles_with_distinct_isolation_accounts(production_app):
    db, _ = production_app
    rows = db.table("app_users").select("id,role,is_demo,email").like(
        "email", "%@connectsphere.test").execute().data

    assert {row["email"]: row["role"] for row in rows} == ACCOUNTS
    assert len({row["role"] for row in rows}) == 7
    assert not any(row["is_demo"] for row in rows)
    assert len({row["id"] for row in rows}) == len(ACCOUNTS)


def test_seeded_account_rejects_a_wrong_password_without_starting_a_session(production_app):
    _, app = production_app
    client = app.test_client()

    response = login(client, "organiser.b@connectsphere.test", "not-the-password")

    assert response.status_code == 401
    assert client.get("/session").json == {"user": None}
    # A successful login afterwards clears the counter so later tests are not locked out.
    assert login(client, "organiser.b@connectsphere.test").status_code == 200


def test_account_locks_after_real_consecutive_failures_then_recovers(production_app):
    """SCRUM-141 / R12: five real wrong-password logins lock the account (429 even with the
    correct password); clearing the lock lets a correct login recover and reset the counter.
    Exercises the atomic register_failed_login RPC end-to-end against the real database."""
    db, app = production_app
    client = app.test_client()
    email = "attendee.b@connectsphere.test"
    # Start from a known-clean counter regardless of test order.
    db.table("app_users").update({"failed_attempts": 0, "locked_until": None}).eq(
        "email", email).execute()
    try:
        for _ in range(5):
            assert login(client, email, "wrong-password").status_code == 401
        # The fifth failure locks the account; the correct password is now refused.
        assert login(client, email).status_code == 429
        locked = db.table("app_users").select("failed_attempts,locked_until").eq(
            "email", email).execute().data[0]
        assert locked["failed_attempts"] >= 5 and locked["locked_until"] is not None
    finally:
        # Clear the lock window so the account recovers (and later tests are not blocked).
        db.table("app_users").update({"locked_until": None}).eq("email", email).execute()

    # A correct login now succeeds and resets the counter to zero.
    assert login(client, email).status_code == 200
    recovered = db.table("app_users").select("failed_attempts,locked_until").eq(
        "email", email).execute().data[0]
    assert recovered["failed_attempts"] == 0 and recovered["locked_until"] is None


def test_production_never_resolves_a_demo_identity(production_app):
    db, app = production_app
    demo = db.table("app_users").select("id").eq("is_demo", True).limit(1).execute().data[0]
    client = app.test_client()
    with client.session_transaction() as session:
        session["acting_user_id"] = demo["id"]

    assert client.get("/session").json == {"user": None}
    assert client.get("/dev/session").status_code == 404

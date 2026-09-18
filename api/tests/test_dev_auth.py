"""Exercise the real Flask routes with a fake Supabase database (no network/secrets)."""

import logging
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import create_app
from app.acting_user import get_acting_user, require_acting_user

ORIGIN = {"Origin": "http://localhost:3000"}
ROLES = ["Organiser", "Coordinator", "Venue Staff", "Tech Support", "Attendee"]


@pytest.fixture
def database(monkeypatch):
    rows = [
        {
            "id": number,
            "display_name": f"Demo {role}",
            "role": role,
            "is_demo": True,
        }
        for number, role in enumerate(ROLES, start=1)
    ]
    rows.append({
        "id": 99,
        "display_name": "Real Attendee",
        "role": "Attendee",
        "is_demo": False,
    })
    client = MagicMock()

    def table(name):
        assert name == "app_users"
        query = MagicMock()
        filters = {}

        def equals(column, value):
            filters[column] = value
            return query

        def execute():
            return SimpleNamespace(data=[
                {key: row[key] for key in ("id", "display_name", "role")}
                for row in rows
                if all(row[key] == value for key, value in filters.items())
            ])

        query.select.return_value = query
        query.eq.side_effect = equals
        query.order.return_value = query
        query.execute.side_effect = execute
        return query

    client.table.side_effect = table
    monkeypatch.setattr("app.users.get_supabase_client", lambda: client)
    return rows, client


@pytest.fixture
def app(database):
    return create_app({
        "TESTING": True,
        "APP_ENV": "development",
        "DEV_ROLE_SWITCHER_ENABLED": True,
        "SECRET_KEY": "test-only-secret",
        "FRONTEND_ORIGIN": ORIGIN["Origin"],
    })


def select_user(client, user_id):
    return client.post("/dev/session", json={"user_id": user_id}, headers=ORIGIN)


def test_lists_exactly_five_demo_roles(app):
    response = app.test_client().get("/dev/users")
    assert response.status_code == 200
    assert [user["role"] for user in response.json["users"]] == ROLES
    assert response.headers["Cache-Control"] == "no-store"


def test_switch_persists_and_action_uses_session_not_body(app, database, caplog):
    client = app.test_client()
    assert client.get("/dev/session").json == {"user": None}
    for row in database[0][:5]:
        switched = select_user(client, row["id"])
        assert switched.status_code == 200
        assert "HttpOnly" in switched.headers["Set-Cookie"]
        assert "SameSite=Lax" in switched.headers["Set-Cookie"]
        assert client.get("/dev/session").json["user"]["id"] == row["id"]

        with caplog.at_level(logging.INFO):
            response = client.post(
                "/dev/actions/test",
                json={"user_id": "forged-id", "role": "admin"},
                headers=ORIGIN,
            )
        assert response.status_code == 200
        assert response.json["actor"]["id"] == row["id"]
        assert response.json["actor"]["role"] == row["role"]
        assert f"actor_user_id={row['id']} role={row['role']}" in caplog.text


def test_sessions_are_independent_and_can_be_cleared(app, database):
    first, second = app.test_client(), app.test_client()
    select_user(first, database[0][0]["id"])
    select_user(second, database[0][1]["id"])
    assert first.get("/dev/session").json["user"]["role"] == "Organiser"
    assert second.get("/dev/session").json["user"]["role"] == "Coordinator"
    assert first.delete("/dev/session", headers=ORIGIN).json == {"user": None}
    assert first.post("/dev/actions/test", headers=ORIGIN).status_code == 401
    assert second.get("/dev/session").json["user"]["role"] == "Coordinator"


def test_tampered_cookie_cannot_establish_an_identity(app, database):
    client = app.test_client()
    select_user(client, database[0][0]["id"])
    cookie_name = app.config["SESSION_COOKIE_NAME"]
    value = client.get_cookie(cookie_name).value
    payload, signature = value.rsplit(".", 1)
    altered_signature = ("A" if signature[0] != "A" else "B") + signature[1:]
    client.set_cookie(cookie_name, f"{payload}.{altered_signature}")
    assert client.get("/dev/session").json == {"user": None}
    assert client.post("/dev/actions/test", headers=ORIGIN).status_code == 401


def test_no_selection_does_not_accept_identity_from_headers_or_body(app, database):
    response = app.test_client().post(
        "/dev/actions/test",
        json={"user_id": database[0][0]["id"]},
        headers={**ORIGIN, "X-User-ID": str(database[0][0]["id"])},
    )
    assert response.status_code == 401


@pytest.mark.parametrize("payload", [
    None, [], {}, {"user_id": None}, {"user_id": "1"}, {"user_id": "invalid"},
    {"user_id": 0}, {"user_id": -1}, {"user_id": True}, {"user_id": 1.0},
    {"user_id": 2_147_483_648}, {"user_id": []}, {"user_id": {}},
    {"user_id": "00000000-0000-4000-8000-000000000001"},
    {"user_id": 98},
    {"user_id": 99},  # Real user, not a demo.
    {"user_id": 1, "role": "admin"},
])
def test_invalid_selection_is_rejected_without_changing_current_user(app, database, payload):
    client = app.test_client()
    select_user(client, database[0][0]["id"])
    assert client.post("/dev/session", json=payload, headers=ORIGIN).status_code == 400
    assert client.get("/dev/session").json["user"]["role"] == "Organiser"


def test_roles_are_reloaded_and_removed_demo_identity_is_rejected(app, database):
    client = app.test_client()
    select_user(client, database[0][0]["id"])
    database[0][0]["role"] = "Attendee"
    assert client.get("/dev/session").json["user"]["role"] == "Attendee"
    database[0][0]["is_demo"] = False
    assert client.post("/dev/actions/test", headers=ORIGIN).status_code == 401
    assert client.get("/dev/session").json == {"user": None}


def test_old_uuid_session_is_cleared_after_migration(app, database):
    client = app.test_client()
    with client.session_transaction() as session:
        session["acting_user_id"] = "00000000-0000-4000-8000-000000000001"
    assert client.get("/dev/session").json == {"user": None}
    database[1].table.assert_not_called()
    assert select_user(client, 1).json["user"]["id"] == 1


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example"}])
def test_untrusted_origin_cannot_switch_clear_or_act(app, database, headers):
    client = app.test_client()
    select_user(client, database[0][0]["id"])
    assert client.post("/dev/session", json={}, headers=headers).status_code == 403
    assert client.delete("/dev/session", headers=headers).status_code == 403
    assert client.post("/dev/actions/test", headers=headers).status_code == 403
    assert client.get("/dev/session").json["user"]["role"] == "Organiser"


def test_cors_allows_frontend_credentials_only(app):
    client = app.test_client()
    response = client.options("/dev/session", headers={
        **ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert response.headers["Access-Control-Allow-Origin"] == ORIGIN["Origin"]
    assert response.headers["Access-Control-Allow-Credentials"] == "true"
    response = client.get("/dev/users", headers={"Origin": "https://untrusted.example"})
    assert "Access-Control-Allow-Origin" not in response.headers


@pytest.mark.parametrize(("environment", "enabled"), [
    ("production", True), ("staging", True), ("", True),
    ("development", False), ("development", "false"),
])
def test_switcher_disabled_outside_explicit_development(database, environment, enabled):
    app = create_app({
        "TESTING": True, "DEBUG": True, "SECRET_KEY": "test-only-secret",
        "APP_ENV": environment, "DEV_ROLE_SWITCHER_ENABLED": enabled,
    })
    client = app.test_client()
    with client.session_transaction() as session:
        session["acting_user_id"] = database[0][0]["id"]
    for method, path in [
        ("GET", "/dev/users"), ("GET", "/dev/session"),
        ("POST", "/dev/session"), ("DELETE", "/dev/session"),
        ("POST", "/dev/actions/test"),
    ]:
        assert client.open(path, method=method, headers=ORIGIN).status_code == 404

    with app.test_request_context():
        from flask import session

        session["acting_user_id"] = database[0][0]["id"]
        assert get_acting_user() is None
    database[1].table.assert_not_called()
    assert client.get("/health").status_code == 200


def test_default_config_disables_switcher(monkeypatch, database):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("DEV_ROLE_SWITCHER_ENABLED", raising=False)
    app = create_app({"TESTING": True})
    assert app.test_client().get("/dev/users").status_code == 404
    database[1].table.assert_not_called()


def test_environment_can_explicitly_enable_switcher(monkeypatch, database):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEV_ROLE_SWITCHER_ENABLED", "true")
    monkeypatch.setenv("SECRET_KEY", "test-only-secret")
    assert create_app().test_client().get("/dev/users").status_code == 200


def test_enabled_switcher_requires_session_secret():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        create_app({
            "APP_ENV": "development", "DEV_ROLE_SWITCHER_ENABLED": True, "SECRET_KEY": None,
        })


def test_missing_database_configuration_returns_helpful_error(app, monkeypatch):
    monkeypatch.setattr("app.users.get_supabase_client", lambda: None)
    response = app.test_client().get("/dev/users")
    assert response.status_code == 503
    assert "SUPABASE_URL" in response.json["error"]
    assert app.test_client().get("/health").status_code == 200


def test_database_failure_does_not_expose_internal_details(app, database):
    database[1].table.side_effect = RuntimeError("secret-database-details")
    response = app.test_client().get("/dev/users")
    assert response.status_code == 503
    assert "secret-database-details" not in response.get_data(as_text=True)


def test_empty_database_explains_seeding(app, database):
    database[0].clear()
    response = app.test_client().get("/dev/users")
    assert response.status_code == 503
    assert "seed_users.sql" in response.json["error"]


def test_future_action_handler_can_use_shared_identity_helper(app, database):
    @app.post("/example-future-action")
    def future_action():
        user = require_acting_user()
        return {"created_by": user["id"]}

    client = app.test_client()
    assert client.post("/example-future-action").status_code == 401
    select_user(client, database[0][0]["id"])
    response = client.post("/example-future-action", json={"created_by": "forged"})
    assert response.json == {"created_by": database[0][0]["id"]}

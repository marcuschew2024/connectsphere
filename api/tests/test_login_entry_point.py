"""SCRUM-139: a password session is never replaced or cleared by the dev role switcher."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import create_app

from .conftest import ORIGIN, select_user

REAL_USER = {"id": 99, "display_name": "Real Attendee", "role": "Attendee"}


@pytest.fixture
def auth_lookup(monkeypatch):
    """Resolve session["user_id"] 99 to the real (non-demo) account in the shared fixture."""
    client = MagicMock()

    def table(name):
        assert name == "app_users"
        query = MagicMock()
        filters = {}

        def equals(column, value):
            filters[column] = value
            return query

        query.select.return_value = query
        query.eq.side_effect = equals
        query.limit.return_value = query
        query.execute.side_effect = lambda: SimpleNamespace(
            data=[REAL_USER] if filters.get("id") == REAL_USER["id"] else []
        )
        return query

    client.table.side_effect = table
    monkeypatch.setattr("app.auth.get_supabase_client", lambda: client)


def signed_in(app):
    client = app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = REAL_USER["id"]
    return client


@pytest.mark.usefixtures("auth_lookup")
def test_switching_while_signed_in_is_refused_and_keeps_the_real_identity(app):
    client = signed_in(app)

    response = select_user(client, 1)

    assert response.status_code == 409
    assert response.json == {"error": "Sign out before using the development role switcher."}
    assert client.get("/session").json == {"user": REAL_USER}
    with client.session_transaction() as session:
        assert session.get("user_id") == REAL_USER["id"]
        assert "acting_user_id" not in session


@pytest.mark.usefixtures("auth_lookup")
def test_clearing_the_switcher_cannot_sign_out_a_real_session(app):
    client = signed_in(app)

    response = client.delete("/dev/session", headers=ORIGIN)

    assert response.status_code == 409
    assert client.get("/session").json == {"user": REAL_USER}


@pytest.mark.usefixtures("auth_lookup")
def test_actions_stay_attributed_to_the_real_account_when_a_demo_cookie_is_also_present(app):
    client = signed_in(app)
    with client.session_transaction() as session:
        session["acting_user_id"] = 2  # Demo Coordinator left over from earlier testing.

    assert client.get("/session").json == {"user": REAL_USER}
    response = client.post("/dev/actions/test", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["actor"] == REAL_USER


@pytest.mark.usefixtures("auth_lookup")
def test_signed_out_development_switching_still_works(app):
    client = app.test_client()

    assert select_user(client, 2).status_code == 200
    assert client.get("/session").json["user"]["role"] == "Coordinator"
    assert client.delete("/dev/session", headers=ORIGIN).status_code == 200
    assert client.get("/session").json == {"user": None}


@pytest.mark.usefixtures("auth_lookup")
def test_production_ignores_demo_identities_but_honours_a_password_session(database):
    app = create_app({
        "TESTING": True, "APP_ENV": "production", "DEV_ROLE_SWITCHER_ENABLED": False,
        "SECRET_KEY": "test-only-secret", "FRONTEND_ORIGIN": ORIGIN["Origin"],
    })
    demo = app.test_client()
    with demo.session_transaction() as session:
        session["acting_user_id"] = 1

    assert demo.get("/session").json == {"user": None}
    assert select_user(demo, 1).status_code == 404
    assert signed_in(app).get("/session").json == {"user": REAL_USER}

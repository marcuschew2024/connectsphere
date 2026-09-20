"""Shared seeded-user database and Flask fixtures; no network or real credentials."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import create_app

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



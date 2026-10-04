"""SCRUM-25: edit permissions, validation, concurrency and safe errors."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import Conflict, Forbidden, NotFound, ServiceUnavailable

from app.venue_repository import update_venue

from .conftest import ORIGIN, select_user
from .test_venues import details

VENUE_ID = "11111111-1111-4111-8111-111111111111"
URL = f"/venues/{VENUE_ID}"


def changes():
    return {**{k: v for k, v in details().items() if k not in {"name", "location"}}, "revision": 1}


@pytest.fixture
def editing(app, monkeypatch):
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    monkeypatch.setattr("app.venues.get_venue", lambda _: {**details(), "revision": 1})
    save = MagicMock(return_value={**details(), "revision": 2})
    monkeypatch.setattr("app.venues.update_venue", save)
    client = app.test_client()
    select_user(client, 3)
    return client, save


def test_staff_update_normalises_fields_and_uses_session_actor(editing):
    client, save = editing
    data = changes()
    data["facilities"] = ["  New   projector ", "new projector"]
    result = client.put(URL, json=data, headers=ORIGIN)
    assert result.status_code == 200
    assert result.headers["Cache-Control"] == "no-store"
    assert result.json["venue"]["revision"] == 2
    venue_id, fields, actor, revision = save.call_args.args
    assert (venue_id, actor, revision) == (VENUE_ID, 3, 1)
    assert fields["facilities"] == ["New projector"]
    assert set(fields) == set(changes()) - {"revision"}


@pytest.mark.parametrize("user", [1, 2, 4, 5])
def test_other_roles_cannot_update(editing, user):
    client, save = editing
    select_user(client, user)
    assert client.put(URL, json=changes(), headers=ORIGIN).status_code == 403
    save.assert_not_called()


def test_update_requires_session(app):
    assert app.test_client().put(URL, json=changes(), headers=ORIGIN).status_code == 401


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://elsewhere.example"}])
def test_update_requires_origin(editing, headers):
    client, save = editing
    assert client.put(URL, json=changes(), headers=headers).status_code == 403
    save.assert_not_called()


@pytest.mark.parametrize(
    "field", ["name", "location", "actor_id", "updated_at", "created_by", "is_retired"]
)
def test_cannot_change_identity_or_supply_audit_fields(editing, field):
    client, save = editing
    assert client.put(URL, json={**changes(), field: "spoof"}, headers=ORIGIN).status_code == 400
    save.assert_not_called()


@pytest.mark.parametrize("revision", [None, True, 0, -1, "1", 2147483648])
def test_revision_is_required_and_valid(editing, revision):
    client, save = editing
    assert (
        client.put(URL, json={**changes(), "revision": revision}, headers=ORIGIN).status_code == 400
    )
    save.assert_not_called()


@pytest.mark.parametrize(
    "field,value,error_field",
    [
        ("capacity", 0, "capacity"),
        ("capacity", 1.5, "capacity"),
        ("supported_layouts", [], "supported_layouts"),
        ("facilities", [""], "facilities"),
        ("accessibility", "stairs", "accessibility"),
        (
            "operating_hours",
            {**details()["operating_hours"], "monday": {"opens": "18:00", "closes": "09:00"}},
            "operating_hours.monday",
        ),
    ],
)
def test_invalid_details_do_not_save(editing, field, value, error_field):
    client, save = editing
    result = client.put(URL, json={**changes(), field: value}, headers=ORIGIN)
    assert result.status_code == 400
    assert error_field in result.json["fields"]
    save.assert_not_called()


def test_missing_venue(editing, monkeypatch):
    client, save = editing
    monkeypatch.setattr("app.venues.get_venue", lambda _: None)
    assert client.put(URL, json=changes(), headers=ORIGIN).status_code == 404
    save.assert_not_called()


def test_stale_update_returns_conflict(editing):
    client, save = editing
    save.side_effect = Conflict("Reload the venue.")
    assert client.put(URL, json=changes(), headers=ORIGIN).status_code == 409


@pytest.mark.parametrize(
    "code,exception",
    [("PT409", Conflict), ("PT404", NotFound), ("PT403", Forbidden), ("23514", ServiceUnavailable)],
)
def test_repository_translates_errors_without_exposing_database_details(
    monkeypatch, code, exception
):
    db = MagicMock()
    db.rpc.return_value.execute.side_effect = APIError(
        {"code": code, "message": "private database details", "details": None, "hint": None}
    )
    monkeypatch.setattr("app.venue_repository.get_supabase_client", lambda: db)
    with pytest.raises(exception) as caught:
        update_venue(VENUE_ID, {}, 3, 1)
    assert "private" not in str(caught.value)


def test_repository_calls_atomic_update(monkeypatch):
    db = MagicMock()
    db.rpc.return_value.execute.return_value = SimpleNamespace(data=[{"revision": 2}])
    monkeypatch.setattr("app.venue_repository.get_supabase_client", lambda: db)
    assert update_venue(VENUE_ID, {"capacity": 120}, 3, 1) == {"revision": 2}
    db.rpc.assert_called_once_with(
        "update_venue_details",
        {"p_venue_id": VENUE_ID, "p_details": {"capacity": 120}, "p_actor_id": 3, "p_revision": 1},
    )

"""SCRUM-38: Tech Support updates, scoped reads and server-owned attribution."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from app.equipment_request_repository import update_request_status

from .conftest import ORIGIN, select_user

ID = "11111111-1111-4111-8111-111111111111"
PATH = f"/equipment/requests/{ID}"


def change(**fields):
    return {"status": "Reserved", "revision": 1, "notes": "  Arranged with AV team  ", **fields}


@pytest.fixture
def status_api(app, monkeypatch, database):
    database[0].append(
        {
            "id": 8,
            "display_name": "Safety",
            "role": "Safety Officer",
            "is_demo": True,
        }
    )
    monkeypatch.setattr("app.equipment_requests.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    saved = MagicMock(return_value={"id": ID, "status": "Reserved", "revision": 2, "updated_by": 4})
    detail = MagicMock(return_value={"id": ID, "status": "Requested", "revision": 1})
    history = MagicMock(return_value=([{"status": "Requested"}], False))
    monkeypatch.setattr("app.equipment_requests.update_request_status", saved, raising=False)
    monkeypatch.setattr("app.equipment_requests.get_request", detail, raising=False)
    monkeypatch.setattr("app.equipment_requests.list_request_history", history, raising=False)
    client = app.test_client()
    assert select_user(client, 4).status_code == 200
    return client, saved, detail, history


@pytest.mark.parametrize("status", ["Requested", "Reserved", "Partially fulfilled", "Unavailable"])
def test_status_update_uses_session_actor_and_trims_notes(status_api, status):
    client, saved, _, _ = status_api
    result = client.patch(PATH + "/status", json=change(status=status), headers=ORIGIN)
    assert result.status_code == 200
    assert result.headers["Cache-Control"] == "no-store"
    saved.assert_called_once_with(ID, status, "Arranged with AV team", 1, 4)


@pytest.mark.parametrize("actor", [1, 2, 3, 5, 8])
def test_other_roles_cannot_update(status_api, actor):
    client, saved, _, _ = status_api
    select_user(client, actor)
    assert client.patch(PATH + "/status", json=change(), headers=ORIGIN).status_code == 403
    saved.assert_not_called()


@pytest.mark.parametrize(
    "fields",
    [
        {"status": "Confirmed"},
        {"status": None},
        {"status": []},
        {"revision": True},
        {"revision": 0},
        {"revision": "1"},
        {"revision": 1.5},
        {"revision": 2147483648},
        {"notes": None},
        {"notes": "x" * 2001},
        {"updated_by": 2},
        {"updated_at": "2099-01-01"},
        {"requested_by": 4},
    ],
)
def test_invalid_or_forged_update_never_writes(status_api, fields):
    client, saved, _, _ = status_api
    assert client.patch(PATH + "/status", json=change(**fields), headers=ORIGIN).status_code == 400
    saved.assert_not_called()


@pytest.mark.parametrize("data", [[], {}, None])
def test_invalid_update_shape(status_api, data):
    client, saved, _, _ = status_api
    assert client.patch(PATH + "/status", json=data, headers=ORIGIN).status_code == 400
    saved.assert_not_called()


@pytest.mark.parametrize("actor", [2, 4])
def test_detail_and_history_pass_the_actor_for_record_scoping(status_api, actor):
    client, _, detail, history = status_api
    select_user(client, actor)
    assert client.get(PATH, headers=ORIGIN).status_code == 200
    result = client.get(PATH + "/history?page=2", headers=ORIGIN)
    assert result.status_code == 200
    assert result.json == {"history": [{"status": "Requested"}], "page": 2, "has_more": False}
    assert detail.call_args.args[0] == ID and detail.call_args.args[1]["id"] == actor
    assert history.call_args.args[0] == ID and history.call_args.args[1]["id"] == actor
    assert history.call_args.args[2] == 2


@pytest.mark.parametrize("actor", [1, 3, 5, 8])
def test_other_roles_cannot_read_request_or_history(status_api, actor):
    client, _, detail, history = status_api
    select_user(client, actor)
    for path in (PATH, PATH + "/history"):
        assert client.get(path, headers=ORIGIN).status_code == 403
    detail.assert_not_called()
    history.assert_not_called()


def test_history_validates_pagination_before_reading(status_api):
    client, _, _, history = status_api
    for query in ("page=0", "page=1&page=2", "page=10001", "page=１", "actor_id=7"):
        assert client.get(PATH + "/history?" + query, headers=ORIGIN).status_code == 400
    history.assert_not_called()


def test_missing_or_unrelated_request_has_no_detail(status_api):
    client, _, detail, history = status_api
    detail.side_effect = NotFound("Equipment request not found.")
    history.side_effect = NotFound("Equipment request not found.")
    for path in (PATH, PATH + "/history"):
        assert client.get(path, headers=ORIGIN).status_code == 404


def test_wrong_origin_and_signed_out_cannot_access(status_api):
    client, saved, detail, history = status_api
    for path in (PATH, PATH + "/history"):
        assert client.get(path).status_code == 403
    assert client.patch(PATH + "/status", json=change()).status_code == 403
    with client.session_transaction() as session:
        session.clear()
    assert client.patch(PATH + "/status", json=change(), headers=ORIGIN).status_code == 401
    assert client.get(PATH, headers=ORIGIN).status_code == 401
    assert client.get(PATH + "/history", headers=ORIGIN).status_code == 401
    for call in (saved, detail, history):
        call.assert_not_called()


def test_real_session_takes_precedence_over_demo_for_status_update(status_api, monkeypatch):
    client, saved, _, _ = status_api
    select_user(client, 2)
    monkeypatch.setattr(
        "app.equipment_requests.get_authenticated_user",
        lambda: {
            "id": 42,
            "role": "Tech Support",
            "display_name": "Real Tech Support",
        },
    )
    assert (
        client.patch(PATH + "/status", json=change(notes="x" * 2000), headers=ORIGIN).status_code
        == 200
    )
    assert saved.call_args.args[-1] == 42


@pytest.mark.parametrize(
    "code,exception",
    [
        ("PT403", Forbidden),
        ("PT404", NotFound),
        ("PT409", Conflict),
        ("22023", BadRequest),
        ("23514", BadRequest),
        ("XX000", ServiceUnavailable),
    ],
)
def test_database_errors_are_safe_and_correctly_classified(monkeypatch, code, exception):
    db = MagicMock()
    db.rpc.side_effect = APIError({"code": code, "message": "private database detail"})
    monkeypatch.setattr("app.equipment_request_repository.get_supabase_client", lambda: db)
    with pytest.raises(exception) as caught:
        update_request_status(ID, "Reserved", "", 1, 4)
    assert "private database detail" not in caught.value.description


def test_unconfirmed_save_is_not_reported_as_success(monkeypatch):
    db = MagicMock()
    db.rpc.return_value.execute.return_value = SimpleNamespace(data=[])
    monkeypatch.setattr("app.equipment_request_repository.get_supabase_client", lambda: db)
    with pytest.raises(ServiceUnavailable, match="Reload the request"):
        update_request_status(ID, "Reserved", "", 1, 4)

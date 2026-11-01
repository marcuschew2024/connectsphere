"""SCRUM-35: validation, access and safe failures without a database."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, ServiceUnavailable

from app import create_app
from app.equipment_request_repository import record_request

from .conftest import ORIGIN, select_user

ID = "11111111-1111-4111-8111-111111111111"


def payload(quantity=1):
    return {
        "event_id": ID,
        "items": [
            {
                "equipment_id": ID,
                "quantity": quantity,
                "technical_notes": " HDMI input ",
            }
        ],
    }


@pytest.fixture
def request_api(app, monkeypatch):
    monkeypatch.setattr("app.equipment_requests.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    saved = MagicMock(return_value={"id": ID, "requested_by": 2, "status": "Requested"})
    monkeypatch.setattr("app.equipment_requests.record_request", saved)
    listing = MagicMock(return_value=([], False))
    monkeypatch.setattr("app.equipment_requests.list_requests", listing)
    monkeypatch.setattr("app.equipment_requests.list_request_events", listing)
    notifications = []
    monkeypatch.setattr(
        "app.equipment_requests.create_notification",
        lambda *args, **kwargs: notifications.append((args, kwargs)),
    )
    client = app.test_client()
    assert select_user(client, 2).status_code == 200
    return client, saved, listing, notifications


@pytest.mark.parametrize("quantity", [1, 2147483647])
def test_positive_integer_and_trusted_actor(request_api, quantity):
    client, saved, _, _ = request_api
    response = client.post("/equipment/requests", json=payload(quantity), headers=ORIGIN)
    assert response.status_code == 201
    assert response.headers["Cache-Control"] == "no-store"
    saved.assert_called_once_with(
        ID,
        [
            {
                "equipment_id": ID,
                "quantity": quantity,
                "technical_notes": "HDMI input",
            }
        ],
        2,
    )


def test_submit_notifies_tech_support_pool(request_api):
    client, _, _, notifications = request_api
    response = client.post("/equipment/requests", json=payload(), headers=ORIGIN)
    assert response.status_code == 201
    # SCRUM-49 / R07: Tech Support reviews new requests as a role pool, not a user.
    assert notifications == [(
        (None, ID, "equipment_request_submitted",
         "A new equipment request needs review."),
        # SCRUM-155: the notice names the request, so its link opens that request.
        {"recipient_role": "Tech Support", "subject_id": response.json["request"].get("id")},
    )]


@pytest.mark.parametrize("quantity", [0, -1, 1.5, True, "1", None, 2147483648])
def test_invalid_quantity_never_writes(request_api, quantity):
    client, saved, _, _ = request_api
    result = client.post("/equipment/requests", json=payload(quantity), headers=ORIGIN)
    assert result.status_code == 400
    assert "items.0.quantity" in result.json["fields"]
    saved.assert_not_called()


@pytest.mark.parametrize("field", ["requested_by", "requested_at", "status", "routed_to"])
def test_client_cannot_spoof_attribution_or_routing(request_api, field):
    client, saved, _, _ = request_api
    assert (
        client.post(
            "/equipment/requests", json={**payload(), field: "spoof"}, headers=ORIGIN
        ).status_code
        == 400
    )
    saved.assert_not_called()


@pytest.mark.parametrize(
    "data",
    [
        [],
        {},
        {"event_id": ID, "items": []},
        {"event_id": ID, "items": [None]},
        {"event_id": ID, "items": payload()["items"] * 51},
        {"event_id": ID, "items": payload()["items"] * 2},
        {"event_id": "bad-id", "items": payload()["items"]},
        {"event_id": ID, "items": [{"equipment_id": "bad", "quantity": 1, "technical_notes": ""}]},
        {"event_id": ID, "items": [{"equipment_id": ID, "quantity": 1, "technical_notes": None}]},
        {
            "event_id": ID,
            "items": [{"equipment_id": ID, "quantity": 1, "technical_notes": "x" * 2001}],
        },
    ],
)
def test_invalid_request_shape_or_content(request_api, data):
    client, saved, _, _ = request_api
    assert client.post("/equipment/requests", json=data, headers=ORIGIN).status_code == 400
    saved.assert_not_called()


@pytest.mark.parametrize(
    "actor,read,write", [(1, 403, 403), (2, 200, 201), (3, 403, 403), (4, 200, 403), (5, 403, 403)]
)
def test_role_permissions(request_api, actor, read, write):
    client, saved, _, _ = request_api
    select_user(client, actor)
    assert client.get("/equipment/requests", headers=ORIGIN).status_code == read
    assert client.get("/equipment/requests/events", headers=ORIGIN).status_code == (
        200 if actor == 2 else 403
    )
    assert client.post("/equipment/requests", json=payload(), headers=ORIGIN).status_code == write
    if write == 403:
        saved.assert_not_called()


def test_origin_and_signed_out_access(request_api):
    client, saved, _, _ = request_api
    for path in ("/equipment/requests", "/equipment/requests/events"):
        assert client.get(path).status_code == 403
    assert (
        client.post(
            "/equipment/requests", json=payload(), headers={"Origin": "https://untrusted.example"}
        ).status_code
        == 403
    )
    with client.session_transaction() as session:
        session.clear()
    assert client.post("/equipment/requests", json=payload(), headers=ORIGIN).status_code == 401
    assert client.get("/equipment/requests", headers=ORIGIN).status_code == 401
    saved.assert_not_called()


@pytest.mark.parametrize(
    "query", ["page=0", "page=1.5", "page=10001", "page=１", "page=1&page=2", "requested_by=7"]
)
def test_invalid_query_never_reads(request_api, query):
    client, _, listing, _ = request_api
    for path in ("/equipment/requests", "/equipment/requests/events"):
        assert client.get(f"{path}?{query}", headers=ORIGIN).status_code == 400
    listing.assert_not_called()


def test_real_session_takes_precedence_in_production(monkeypatch):
    app = create_app(
        {
            "TESTING": True,
            "APP_ENV": "production",
            "SECRET_KEY": "test-only",
            "FRONTEND_ORIGIN": ORIGIN["Origin"],
        }
    )
    db = MagicMock()
    query = db.table.return_value.select.return_value.eq.return_value.limit.return_value
    query.execute.return_value = SimpleNamespace(
        data=[{"id": 42, "role": "Coordinator", "display_name": "Coordinator"}]
    )
    monkeypatch.setattr("app.auth.get_supabase_client", lambda: db)
    save = MagicMock(return_value={"requested_by": 42})
    monkeypatch.setattr("app.equipment_requests.record_request", save)
    monkeypatch.setattr("app.equipment_requests.create_notification", MagicMock())
    client = app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = 42
        session["acting_user_id"] = 4
    assert client.post("/equipment/requests", json=payload(), headers=ORIGIN).status_code == 201
    assert save.call_args.args[2] == 42


@pytest.mark.parametrize(
    "code,exception",
    [
        ("PT403", Forbidden),
        ("PT409", Conflict),
        ("23514", BadRequest),
        ("PT404", BadRequest),
        ("XX000", ServiceUnavailable),
    ],
)
def test_safe_database_errors(monkeypatch, code, exception):
    db = MagicMock()
    db.rpc.side_effect = APIError({"code": code, "message": "private detail"})
    monkeypatch.setattr("app.equipment_request_repository.get_supabase_client", lambda: db)
    with pytest.raises(exception) as caught:
        record_request(ID, payload()["items"], 2)
    assert "private detail" not in caught.value.description

"""SCRUM-34: stock validation, trusted identity, access control and safe errors."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from app import create_app
from app.equipment_repository import get_equipment, list_equipment, save_equipment
from app.equipment_validation import validate_equipment

from .conftest import ORIGIN, select_user

ID = "11111111-1111-4111-8111-111111111111"


def details():
    return {
        "equipment_type": "Wireless microphone",
        "description": "Handheld with receiver",
        "total_quantity": 8,
        "location": "AV store",
        "operational_status": "Operational",
    }


@pytest.fixture
def equipment_api(app, monkeypatch):
    monkeypatch.setattr("app.equipment.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    save = MagicMock(return_value={**details(), "id": ID, "created_by": 4})
    monkeypatch.setattr("app.equipment.save_equipment", save)
    listing = MagicMock(return_value=([save.return_value], False))
    monkeypatch.setattr("app.equipment.list_equipment", listing)
    monkeypatch.setattr("app.equipment.get_equipment", lambda _: save.return_value)
    client = app.test_client()
    assert select_user(client, 4).status_code == 200
    return client, save, listing


@pytest.mark.parametrize("quantity", [0, 1, 2147483647])
def test_tech_support_can_create_non_negative_stock(equipment_api, quantity):
    client, save, _ = equipment_api
    values = {**details(), "total_quantity": quantity, "location": "  AV store  "}
    response = client.post("/equipment", json=values, headers=ORIGIN)
    assert response.status_code == 201
    assert response.headers["Cache-Control"] == "no-store"
    save.assert_called_once_with({**values, "location": "AV store"}, 4, None, None)


@pytest.mark.parametrize("quantity", [-1, 1.5, True, "8", None, 2147483648])
def test_invalid_quantities_do_not_write(equipment_api, quantity):
    client, save, _ = equipment_api
    response = client.post(
        "/equipment", json={**details(), "total_quantity": quantity}, headers=ORIGIN
    )
    assert response.status_code == 400
    assert "total_quantity" in response.json["fields"]
    save.assert_not_called()


@pytest.mark.parametrize(
    "field,value",
    [
        ("equipment_type", " "),
        ("equipment_type", "x" * 101),
        ("description", None),
        ("description", "x" * 2001),
        ("location", "x" * 301),
        ("location", []),
        ("operational_status", "available"),
        ("operational_status", []),
    ],
)
def test_invalid_text_or_condition_is_explained(field, value):
    _, errors = validate_equipment({**details(), field: value})
    assert field in errors


@pytest.mark.parametrize(
    "field",
    [
        "id",
        "created_by",
        "created_at",
        "updated_by",
        "updated_at",
        "usable_quantity",
        "role",
    ],
)
def test_client_cannot_supply_identity_audit_or_computed_stock(equipment_api, field):
    client, save, _ = equipment_api
    assert (
        client.post("/equipment", json={**details(), field: "spoof"}, headers=ORIGIN).status_code
        == 400
    )
    save.assert_not_called()


@pytest.mark.parametrize("user_id", [1, 2, 3, 5])
def test_other_roles_cannot_create_or_update(equipment_api, user_id):
    client, save, _ = equipment_api
    select_user(client, user_id)
    assert client.post("/equipment", json=details(), headers=ORIGIN).status_code == 403
    assert (
        client.put(
            f"/equipment/{ID}", json={**details(), "revision": 1}, headers=ORIGIN
        ).status_code
        == 403
    )
    save.assert_not_called()


@pytest.mark.parametrize("user_id,expected", [(1, 403), (2, 200), (3, 403), (4, 200), (5, 403)])
def test_catalogue_and_detail_read_permissions(equipment_api, user_id, expected):
    client, _, _ = equipment_api
    select_user(client, user_id)
    for path in ("/equipment", f"/equipment/{ID}"):
        assert client.get(path, headers=ORIGIN).status_code == expected


def test_signed_out_and_wrong_origin_are_rejected(equipment_api):
    client, save, _ = equipment_api
    for headers in ({}, {"Origin": "https://untrusted.example"}):
        assert client.post("/equipment", json=details(), headers=headers).status_code == 403
        assert client.get("/equipment", headers=headers).status_code == 403
    with client.session_transaction() as session:
        session.clear()
    assert client.post("/equipment", json=details(), headers=ORIGIN).status_code == 401
    assert client.get("/equipment", headers=ORIGIN).status_code == 401
    save.assert_not_called()


@pytest.mark.parametrize("revision", [None, 0, -1, True, "1", 1.5, 2147483648])
def test_update_requires_valid_revision(equipment_api, revision):
    client, save, _ = equipment_api
    assert (
        client.put(
            f"/equipment/{ID}", json={**details(), "revision": revision}, headers=ORIGIN
        ).status_code
        == 400
    )
    save.assert_not_called()


def test_update_forwards_revision_and_server_identity(equipment_api):
    client, save, _ = equipment_api
    response = client.put(f"/equipment/{ID}", json={**details(), "revision": 2}, headers=ORIGIN)
    assert response.status_code == 200
    save.assert_called_once_with(details(), 4, ID, 2)


@pytest.mark.parametrize(
    "query",
    [
        "page=0",
        "page=-1",
        "page=10001",
        "page=abc",
        "page=1.5",
        "page=１２",
        "page=",
        "page=1&page=2",
        "operational_only=yes",
        "created_by=4",
    ],
)
def test_invalid_query_does_not_reach_database(equipment_api, query):
    client, _, listing = equipment_api
    assert client.get(f"/equipment?{query}", headers=ORIGIN).status_code == 400
    listing.assert_not_called()


def test_usable_stock_filter_is_forwarded(equipment_api):
    client, _, listing = equipment_api
    assert client.get("/equipment?page=2&operational_only=true", headers=ORIGIN).status_code == 200
    listing.assert_called_once_with(2, True)


def test_real_login_identity_takes_precedence_over_demo_session(monkeypatch):
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
        data=[{"id": 42, "role": "Tech Support", "display_name": "Support Manager"}]
    )
    monkeypatch.setattr("app.auth.get_supabase_client", lambda: db)
    save = MagicMock(return_value={"created_by": 42})
    monkeypatch.setattr("app.equipment.save_equipment", save)
    client = app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = 42
        session["acting_user_id"] = 2
    assert client.post("/equipment", json=details(), headers=ORIGIN).status_code == 201
    save.assert_called_once_with(details(), 42, None, None)


@pytest.mark.parametrize(
    "code,exception",
    [
        ("PT409", Conflict),
        ("PT404", NotFound),
        ("PT403", Forbidden),
        ("23514", BadRequest),
        ("22023", BadRequest),
        ("XX000", ServiceUnavailable),
    ],
)
def test_repository_maps_errors_without_exposing_database_details(monkeypatch, code, exception):
    db = MagicMock()
    monkeypatch.setattr("app.equipment_repository.get_supabase_client", lambda: db)
    db.rpc.side_effect = APIError({"code": code, "message": "private detail"})
    with pytest.raises(exception) as caught:
        save_equipment(details(), 4, ID, 1)
    assert "private detail" not in caught.value.description


def test_repository_reads_fail_safely(monkeypatch):
    db = MagicMock()
    db.table.side_effect = RuntimeError("private connection detail")
    monkeypatch.setattr("app.equipment_repository.get_supabase_client", lambda: db)
    with pytest.raises(ServiceUnavailable, match="Please try again"):
        list_equipment(1)
    with pytest.raises(ServiceUnavailable, match="Please try again"):
        get_equipment(ID)


def test_missing_equipment_returns_404(equipment_api, monkeypatch):
    client, _, _ = equipment_api
    monkeypatch.setattr("app.equipment.get_equipment", lambda _: None)
    assert client.get(f"/equipment/{ID}", headers=ORIGIN).status_code == 404


def test_availability_endpoint_success(equipment_api, monkeypatch):
    client, save, _ = equipment_api
    monkeypatch.setattr("app.equipment_repository.get_reservations_for_window", lambda s, e, eq: [])
    query = "?start_at=2099-10-20T10:00:00Z&end_at=2099-10-20T12:00:00Z&quantity=2"
    response = client.get(f"/equipment/{ID}/availability{query}", headers=ORIGIN)
    assert response.status_code == 200
    avail = response.json["availability"]
    assert avail["equipment_id"] == ID
    assert avail["available_quantity"] == 8
    assert avail["is_sufficient"] is True


def test_availability_endpoint_missing_params(equipment_api):
    client, _, _ = equipment_api
    response = client.get(f"/equipment/{ID}/availability", headers=ORIGIN)
    assert response.status_code == 400
    assert "start_at and end_at query parameters are required" in response.json["error"]


def test_availability_endpoint_invalid_quantity(equipment_api):
    client, _, _ = equipment_api
    query = "?start_at=2099-10-20T10:00:00Z&end_at=2099-10-20T12:00:00Z&quantity=-5"
    response = client.get(f"/equipment/{ID}/availability{query}", headers=ORIGIN)
    assert response.status_code == 400
    assert "Quantity must be a non-negative integer" in response.json["error"]


def test_reserve_equipment_endpoint_success(equipment_api, monkeypatch):
    client, _, _ = equipment_api
    monkeypatch.setattr("app.equipment_repository.get_reservations_for_window", lambda s, e, eq: [])
    created = {
        "id": "res-111",
        "equipment_id": ID,
        "quantity": 2,
        "start_at": "2099-10-20T10:00:00Z",
        "end_at": "2099-10-20T12:00:00Z",
        "status": "Reserved",
    }
    monkeypatch.setattr(
        "app.equipment_repository.create_equipment_reservation",
        lambda **kwargs: created,
    )
    payload = {
        "start_at": "2099-10-20T10:00:00Z",
        "end_at": "2099-10-20T12:00:00Z",
        "quantity": 2,
    }
    response = client.post(f"/equipment/{ID}/reservations", json=payload, headers=ORIGIN)
    assert response.status_code == 201
    assert response.json["reservation"]["id"] == "res-111"
    assert "Successfully reserved 2 unit(s)" in response.json["message"]


def test_reserve_equipment_over_reservation_returns_409(equipment_api, monkeypatch):
    client, _, _ = equipment_api
    # 8 available total, but 7 already reserved
    existing = [{
        "id": "res-existing",
        "equipment_id": ID,
        "quantity": 7,
        "start_at": "2099-10-20T10:00:00Z",
        "end_at": "2099-10-20T12:00:00Z",
        "status": "Reserved",
    }]
    monkeypatch.setattr(
        "app.equipment_repository.get_reservations_for_window",
        lambda s, e, eq: existing,
    )
    payload = {

        "start_at": "2099-10-20T10:00:00Z",
        "end_at": "2099-10-20T12:00:00Z",
        "quantity": 3,  # 8 - 7 = 1 available, requesting 3
    }
    response = client.post(f"/equipment/{ID}/reservations", json=payload, headers=ORIGIN)
    assert response.status_code == 409
    assert "Only 1 available" in response.json["error"]


def test_reserve_equipment_requires_tech_support(app, monkeypatch):
    monkeypatch.setattr("app.equipment.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    client = app.test_client()
    # User 2 is Coordinator, not Tech Support
    from .conftest import select_user
    select_user(client, 2)
    payload = {
        "start_at": "2099-10-20T10:00:00Z",
        "end_at": "2099-10-20T12:00:00Z",
        "quantity": 1,
    }
    response = client.post(f"/equipment/{ID}/reservations", json=payload, headers=ORIGIN)
    assert response.status_code == 403



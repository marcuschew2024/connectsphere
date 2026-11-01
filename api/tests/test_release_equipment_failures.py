"""SCRUM-161: rejected equipment operations must not reserve or expose stock."""
from unittest.mock import MagicMock

import pytest

from .conftest import ORIGIN, select_user

ID = "16116116-1111-4111-8111-111111111111"
EVENT = "16116116-2222-4222-8222-222222222222"
VALID = {"start_at": "2099-10-20T06:00:00Z", "end_at": "2099-10-20T07:00:00Z", "quantity": 1}


@pytest.fixture
def stock_api(app, monkeypatch):
    monkeypatch.setattr("app.equipment.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    item = MagicMock(return_value={"id": ID, "equipment_type": "Projector",
                                  "total_quantity": 5, "operational_status": "Operational"})
    reads = MagicMock(return_value=[])
    writes = MagicMock(return_value={"id": "reservation", "quantity": 1})
    monkeypatch.setattr("app.equipment.get_equipment", item)
    monkeypatch.setattr("app.equipment_repository.get_reservations_for_window", reads)
    monkeypatch.setattr("app.equipment_repository.create_equipment_reservation", writes)
    client = app.test_client()
    select_user(client, 4)
    return client, item, reads, writes


@pytest.mark.parametrize("operation", ["availability", "reservations"])
def test_missing_stock_is_not_available_or_reservable(stock_api, operation):
    client, item, reads, writes = stock_api
    item.return_value = None
    response = (client.get(f"/equipment/{ID}/availability", query_string=VALID, headers=ORIGIN)
                if operation == "availability" else
                client.post(f"/equipment/{ID}/reservations", json=VALID, headers=ORIGIN))
    assert response.status_code == 404
    assert response.json == {"error": "Equipment not found."}
    reads.assert_not_called()
    writes.assert_not_called()


@pytest.mark.parametrize("body", [[], "text", {}, {"quantity": 1},
                                    {**VALID, "created_by": 99},
                                    {k: v for k, v in VALID.items() if k != "start_at"},
                                    {k: v for k, v in VALID.items() if k != "end_at"},
                                    {k: v for k, v in VALID.items() if k != "quantity"}])
def test_incomplete_or_forged_reservation_does_not_write(stock_api, body):
    client, _, reads, writes = stock_api
    response = client.post(f"/equipment/{ID}/reservations", json=body, headers=ORIGIN)
    assert response.status_code == 400 and response.json["error"]
    reads.assert_not_called()
    writes.assert_not_called()


def test_malformed_json_does_not_write(stock_api):
    client, _, _, writes = stock_api
    response = client.post(f"/equipment/{ID}/reservations", data='{"quantity":',
                           content_type="application/json", headers=ORIGIN)
    assert response.status_code == 400
    writes.assert_not_called()


@pytest.mark.parametrize(
    "quantity", [0, -1, 2147483648, "invalid", "1", None, True, 1.0, 1.5, [], {}],
)
def test_reservation_requires_positive_whole_units_without_coercion(stock_api, quantity):
    client, _, _, writes = stock_api
    response = client.post(f"/equipment/{ID}/reservations",
                           json={**VALID, "quantity": quantity}, headers=ORIGIN)
    assert response.status_code == 400
    assert "quantity" in response.json["error"].lower()
    writes.assert_not_called()


@pytest.mark.parametrize("operation", ["availability", "reservations"])
@pytest.mark.parametrize("start,end", [
    ("invalid", VALID["end_at"]), (VALID["start_at"], VALID["start_at"]),
    (VALID["end_at"], VALID["start_at"]), ("2099-10-20T06:00:00", VALID["end_at"]),
])
def test_invalid_time_window_has_a_clear_refusal_and_no_write(stock_api, operation, start, end):
    client, _, reads, writes = stock_api
    body = {**VALID, "start_at": start, "end_at": end}
    response = (client.get(f"/equipment/{ID}/availability", query_string=body, headers=ORIGIN)
                if operation == "availability" else
                client.post(f"/equipment/{ID}/reservations", json=body, headers=ORIGIN))
    assert response.status_code == 400 and response.json["error"]
    reads.assert_not_called()
    writes.assert_not_called()


@pytest.mark.parametrize("user", [1, 3, 5])
def test_non_resource_roles_cannot_read_event_reservations(stock_api, monkeypatch, user):
    client, _, _, _ = stock_api
    listing = MagicMock(return_value=[{"technical_notes": "Private resource notes"}])
    monkeypatch.setattr("app.equipment_repository.list_event_equipment_reservations", listing)
    select_user(client, user)
    response = client.get(f"/equipment/reservations/event/{EVENT}", headers=ORIGIN)
    assert response.status_code == 403
    assert "Private resource notes" not in response.get_data(as_text=True)
    listing.assert_not_called()


@pytest.mark.parametrize("user", [2, 4])
@pytest.mark.parametrize("rows", [[], [{"id": "reservation", "quantity": 2, "event_id": EVENT}]])
def test_resource_roles_see_event_reservations_and_honest_empty_state(
    stock_api, monkeypatch, user, rows,
):
    client, _, _, _ = stock_api
    listing = MagicMock(return_value=rows)
    monkeypatch.setattr("app.equipment_repository.list_event_equipment_reservations", listing)
    select_user(client, user)
    response = client.get(f"/equipment/reservations/event/{EVENT}", headers=ORIGIN)
    assert response.status_code == 200 and response.json == {"reservations": rows}
    assert response.headers["Cache-Control"] == "no-store"
    listing.assert_called_once_with(EVENT)


@pytest.mark.parametrize("field", ["start_at", "end_at"])
@pytest.mark.parametrize("value", [None, True, 17, [], {}])
def test_non_text_reservation_times_fail_before_database_lookup(stock_api, field, value):
    client, _, reads, writes = stock_api
    response = client.post(f"/equipment/{ID}/reservations",
                           json={**VALID, field: value}, headers=ORIGIN)
    assert response.status_code == 400 and "date/time" in response.json["error"]
    reads.assert_not_called()
    writes.assert_not_called()

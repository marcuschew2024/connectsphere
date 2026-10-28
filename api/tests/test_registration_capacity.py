"""SCRUM-41 capacity boundaries and HTTP security/error behaviour."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, ServiceUnavailable

from app.registration_capacity import RegistrationCapacity, valid_capacity
from app.registration_repository import register_attendee, set_registration_capacity

from .conftest import ORIGIN, select_user

EVENT_ID = "41414141-4141-4141-8141-414141414141"


@pytest.mark.parametrize(("count", "remaining", "full"), [
    (99, 1, False), (100, 0, True), (101, 0, True),
])
def test_capacity_boundary_blocks_full_and_overfull_records(count, remaining, full):
    capacity = RegistrationCapacity(100, count)
    assert capacity.remaining == remaining
    assert capacity.is_full is full
    assert (capacity.refusal("Confirmed") is not None) is full


def test_unconfigured_or_unconfirmed_event_never_accepts_a_registration():
    assert "not been set" in RegistrationCapacity(None, 0).refusal("Confirmed")
    for status in ("Draft", "Planning", "Preparation", "Completed", "Cancelled", "Rejected"):
        assert "confirmed" in RegistrationCapacity(100, 0).refusal(status)


@pytest.mark.parametrize("value", [
    None, 0, -1, True, False, 1.5, "100", 10_001, 2_147_483_647, 2_147_483_648,
])
def test_capacity_requires_a_positive_postgres_integer(value):
    assert not valid_capacity(value)


def test_one_place_and_ten_thousand_are_valid():
    assert valid_capacity(1) and valid_capacity(10_000)


@pytest.fixture
def capacity_api(app, monkeypatch):
    event = {"id": EVENT_ID, "status": "Planning", "organiser_id": 1,
             "coordinator_id": 2, "registration_capacity": None, "registered_count": 0}
    monkeypatch.setattr("app.events.get_event_by_id", lambda _: dict(event))
    monkeypatch.setattr("app.rbac.is_event_participant", lambda *_: False)
    monkeypatch.setattr("app.rbac.log_access_denied", lambda *_, **__: None)
    calls = []

    def save(event_id, actor, capacity):
        calls.append((event_id, actor, capacity))
        return {**event, "registration_capacity": capacity}

    monkeypatch.setattr("app.events.set_registration_capacity", save)
    client = app.test_client()
    select_user(client, 1)
    return client, event, calls


def test_owner_sets_capacity_and_gets_an_aggregate_only(capacity_api):
    client, _, calls = capacity_api
    response = client.put(f"/events/{EVENT_ID}/registration-capacity",
                          json={"capacity": 100}, headers=ORIGIN)
    assert response.status_code == 200
    assert calls == [(EVENT_ID, 1, 100)]
    assert response.json == {"registration_capacity": {
        "capacity": 100, "registered_count": 0, "remaining": 100, "is_full": False,
    }}


@pytest.mark.parametrize("payload", [{"capacity": 0}, {"capacity": True}, {"capacity": 1.5}])
def test_invalid_capacity_never_reaches_storage(capacity_api, payload):
    client, _, calls = capacity_api
    response = client.put(f"/events/{EVENT_ID}/registration-capacity",
                          json=payload, headers=ORIGIN)
    assert response.status_code == 400 and "capacity" in response.json["fields"]
    assert calls == []


@pytest.mark.parametrize("role_id", [2, 3, 4, 5])
def test_other_roles_cannot_set_capacity(capacity_api, role_id):
    client, _, calls = capacity_api
    assert select_user(client, role_id).status_code == 200
    response = client.put(f"/events/{EVENT_ID}/registration-capacity",
                          json={"capacity": 100}, headers=ORIGIN)
    assert response.status_code == 403 and calls == []


def test_origin_and_session_are_required(capacity_api, app):
    client, _, calls = capacity_api
    path = f"/events/{EVENT_ID}/registration-capacity"
    assert client.put(path, json={"capacity": 100}).status_code == 403
    assert app.test_client().put(path, json={"capacity": 100}, headers=ORIGIN).status_code == 401
    assert calls == []


def test_missing_capacity_and_spoofed_actor_are_rejected(capacity_api):
    client, _, calls = capacity_api
    for payload in ({}, {"capacity": 100, "actor_id": 1}, [], None):
        assert client.put(f"/events/{EVENT_ID}/registration-capacity",
                          json=payload, headers=ORIGIN).status_code == 400
    assert calls == []


def test_registration_uses_attendee_session_and_not_event_membership(capacity_api, monkeypatch):
    client, event, _ = capacity_api
    event.update(status="Confirmed", registration_capacity=1)
    select_user(client, 5)
    saved = {"id": "registration-1", "attendee_id": 5, "status": "Registered"}
    register = MagicMock(return_value=saved)
    monkeypatch.setattr("app.events.register_attendee", register)
    path = f"/events/{EVENT_ID}/registrations"
    response = client.post(path, json={}, headers=ORIGIN)
    assert response.status_code == 201 and response.json == {"registration": saved}
    register.assert_called_once_with(EVENT_ID, 5)
    assert client.post(path, json={"attendee_id": 99}, headers=ORIGIN).status_code == 400


def test_full_event_does_not_attempt_a_write(capacity_api, monkeypatch):
    client, event, _ = capacity_api
    event.update(status="Confirmed", registration_capacity=1, registered_count=1)
    select_user(client, 5)
    register = MagicMock()
    monkeypatch.setattr("app.events.register_attendee", register)
    response = client.post(f"/events/{EVENT_ID}/registrations", json={}, headers=ORIGIN)
    assert response.status_code == 409 and "full" in response.json["error"]
    register.assert_not_called()


def test_storage_race_returns_a_clear_conflict(capacity_api, monkeypatch):
    client, event, _ = capacity_api
    event.update(status="Confirmed", registration_capacity=1)
    select_user(client, 5)

    def lost_race(*_):
        raise Conflict("This event is full. No places are currently available.")

    monkeypatch.setattr("app.events.register_attendee", lost_race)
    response = client.post(f"/events/{EVENT_ID}/registrations", json={}, headers=ORIGIN)
    assert response.status_code == 409 and "full" in response.json["error"]


def test_repository_calls_atomic_rpcs(monkeypatch):
    client = MagicMock()
    client.rpc.return_value.execute.return_value = SimpleNamespace(data={"saved": True})
    monkeypatch.setattr("app.registration_repository.get_supabase_client", lambda: client)
    assert set_registration_capacity(EVENT_ID, 1, 100) == {"saved": True}
    client.rpc.assert_called_with("set_registration_capacity", {
        "p_event_id": EVENT_ID, "p_actor_id": 1, "p_capacity": 100,
    })
    assert register_attendee(EVENT_ID, 5) == {"saved": True}
    client.rpc.assert_called_with("register_event_attendee", {
        "p_event_id": EVENT_ID, "p_attendee_id": 5,
    })


def test_database_errors_never_leak_internal_details(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr("app.registration_repository.get_supabase_client", lambda: client)
    client.rpc.return_value.execute.side_effect = APIError({
        "code": "PT409", "message": "event_full", "details": "secret", "hint": None,
    })
    with pytest.raises(Conflict, match="event is full"):
        register_attendee(EVENT_ID, 5)
    client.rpc.return_value.execute.side_effect = RuntimeError("secret database connection")
    with pytest.raises(ServiceUnavailable, match="Refresh the event") as unavailable:
        register_attendee(EVENT_ID, 5)
    assert "secret" not in str(unavailable.value)


@pytest.mark.parametrize("capacity", [1, 10_000, 10_001])
def test_capacity_api_enforces_ten_thousand_limit(capacity_api, capacity):
    client, _, calls = capacity_api
    response = client.put(f"/events/{EVENT_ID}/registration-capacity",
                          json={"capacity": capacity}, headers=ORIGIN)
    if capacity <= 10_000:
        assert response.status_code == 200
        assert response.json["registration_capacity"]["capacity"] == capacity
        assert calls == [(EVENT_ID, 1, capacity)]
    else:
        assert response.status_code == 400
        assert response.json["fields"]["capacity"] == "Enter a whole number between 1 and 10,000."
        assert calls == []


def test_database_capacity_validation_uses_the_public_input_range(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr("app.registration_repository.get_supabase_client", lambda: client)
    client.rpc.return_value.execute.side_effect = APIError({
        "code": "22023", "message": "Invalid capacity", "details": None, "hint": None,
    })
    with pytest.raises(BadRequest, match="between 1 and 10,000"):
        set_registration_capacity(EVENT_ID, 1, 0)

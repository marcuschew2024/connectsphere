"""Release v1 audit: refusal paths that had no test (SCRUM-130, SCRUM-46/138, SCRUM-139).

- SCRUM-130: how the Coordinator list and the assignment function report database
  refusals and outages, and the origin guard on the Coordinator list.
- SCRUM-46/138: the origin, unknown-event and malformed-body guards on change requests.
- SCRUM-139: identities are resolved once per request, so a later lookup in the same
  request cannot see a different user.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import g
from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from app.event_repository import assign_event_coordinator, list_coordinators

from .conftest import ORIGIN, select_user
from .test_change_requests import _event, _wire

UNTRUSTED = {"Origin": "https://attacker.example"}


# --- SCRUM-130: Coordinator list and assignment repository ---

def _rpc_client(data=None, error=None):
    def execute():
        if error:
            raise error
        return SimpleNamespace(data=data)

    return SimpleNamespace(rpc=lambda name, params: SimpleNamespace(execute=execute))


@pytest.mark.parametrize(("code", "message", "exception", "text"), [
    ("PT403", "Lead required", Forbidden, "Event Coordinator Lead"),
    ("PT404", "Event not found", NotFound, "Event not found"),
    ("PT409", "closed", Conflict, "closed"),
    ("PT409", "already_assigned", Conflict, "already assigned"),
    ("PT409", "something_new", Conflict, "Reload it"),
    ("22023", "Invalid coordinator", BadRequest, "existing Coordinator"),
    ("42883", "function does not exist", ServiceUnavailable, "Reload the event"),
])
def test_assignment_refusals_are_translated(monkeypatch, code, message, exception, text):
    error = APIError({"code": code, "message": message, "details": None, "hint": None})
    monkeypatch.setattr("app.event_repository.get_supabase_client",
                        lambda: _rpc_client(error=error))
    with pytest.raises(exception) as raised:
        assign_event_coordinator("event-1", 2, 8)
    assert text in raised.value.description


@pytest.mark.parametrize("make", [
    lambda: None,
    lambda: _rpc_client(data=["no", "event"]),
    lambda: _rpc_client(data={"history": []}),
    lambda: SimpleNamespace(rpc=lambda name, params: (_ for _ in ()).throw(OSError())),
])
def test_an_unconfirmed_assignment_is_reported(monkeypatch, make):
    monkeypatch.setattr("app.event_repository.get_supabase_client", make)
    with pytest.raises(ServiceUnavailable):
        assign_event_coordinator("event-1", 2, 8)


def test_a_confirmed_assignment_is_returned(monkeypatch):
    result = {"event": {"id": "event-1", "coordinator_id": 2}}
    monkeypatch.setattr("app.event_repository.get_supabase_client",
                        lambda: _rpc_client(data=result))
    assert assign_event_coordinator("event-1", 2, 8) == result


def test_coordinators_are_listed_by_name(monkeypatch):
    query = MagicMock()
    for step in ("select", "eq", "order"):
        getattr(query, step).return_value = query
    query.execute.return_value = SimpleNamespace(data=[{"id": 2, "display_name": "Demo"}])
    monkeypatch.setattr("app.event_repository.get_supabase_client",
                        lambda: SimpleNamespace(table=lambda name: query))
    assert list_coordinators() == [{"id": 2, "display_name": "Demo"}]
    query.eq.assert_called_once_with("role", "Coordinator")
    query.execute.return_value = SimpleNamespace(data=None)
    assert list_coordinators() == []


@pytest.mark.parametrize("make", [
    lambda: None,
    lambda: SimpleNamespace(table=lambda name: (_ for _ in ()).throw(OSError())),
])
def test_a_failed_coordinator_list_is_reported(monkeypatch, make):
    monkeypatch.setattr("app.event_repository.get_supabase_client", make)
    with pytest.raises(ServiceUnavailable):
        list_coordinators()


def test_the_coordinator_list_needs_the_trusted_origin(app):
    client = app.test_client()
    select_user(client, 2)
    assert client.get("/events/coordinators", headers=UNTRUSTED).status_code == 403


# --- SCRUM-46 / SCRUM-138: change-request guards ---

def test_change_request_routes_need_a_known_event(app, monkeypatch):
    _wire(monkeypatch, None)
    client = app.test_client()
    select_user(client, 1)
    assert client.get("/events/event-46/change-requests", headers=ORIGIN).status_code == 404
    select_user(client, 2)
    assert client.patch("/events/event-46/change-requests/1", json={"status": "Approved"},
                        headers=ORIGIN).status_code == 404


def test_reviewing_needs_the_trusted_origin(app, monkeypatch):
    _wire(monkeypatch, _event(), [{"id": 1, "event_id": "event-46", "status": "Pending"}])
    client = app.test_client()
    select_user(client, 2)
    assert client.patch("/events/event-46/change-requests/1", json={"status": "Approved"},
                        headers=UNTRUSTED).status_code == 403


@pytest.mark.parametrize("body", [
    {}, ["status"], "Approved", {"review_note": "No status"},
    {"status": "Approved", "applied_changes": {}},
])
def test_a_malformed_review_is_refused(app, monkeypatch, body):
    _wire(monkeypatch, _event(), [{"id": 1, "event_id": "event-46", "status": "Pending"}])
    monkeypatch.setattr("app.events.require_related_user", lambda user, event, action: user)
    client = app.test_client()
    select_user(client, 2)
    response = client.patch("/events/event-46/change-requests/1", json=body, headers=ORIGIN)
    assert response.status_code == 400
    assert response.json["error"] == "Send status and an optional review_note."


# --- SCRUM-139: identity is resolved once per request ---

def test_the_demo_identity_is_looked_up_once_per_request(app, monkeypatch):
    from app import acting_user

    lookups = []
    monkeypatch.setattr(acting_user, "dev_switcher_enabled", lambda: True)
    monkeypatch.setattr(acting_user, "get_demo_user",
                        lambda user_id: lookups.append(user_id) or {"id": user_id})
    with app.test_request_context():
        from flask import session
        session["acting_user_id"] = 2
        assert acting_user.get_acting_user() == {"id": 2}
        session["acting_user_id"] = 3  # A later change in the same request is ignored.
        assert acting_user.get_acting_user() == {"id": 2}
    assert lookups == [2]


def test_the_signed_in_user_is_looked_up_once_per_request(app, monkeypatch):
    from app import auth

    query = MagicMock()
    for step in ("select", "eq", "limit"):
        getattr(query, step).return_value = query
    query.execute.return_value = SimpleNamespace(data=[{"id": 5, "display_name": "A",
                                                        "role": "Attendee"}])
    client = SimpleNamespace(table=MagicMock(return_value=query))
    monkeypatch.setattr(auth, "get_supabase_client", lambda: client)
    with app.test_request_context():
        from flask import session
        session["user_id"] = 5
        first = auth.get_authenticated_user()
        assert auth.get_authenticated_user() is first
        assert g.auth_user["id"] == 5
    assert client.table.call_count == 1

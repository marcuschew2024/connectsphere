"""API tests for structured change requests and their atomic approval (SCRUM-138).

The proposal rules are unit-tested in test_change_request_proposal.py and the
transactional approve_change_request() function in
test_change_request_apply_acceptance.py. These tests cover the endpoint wiring: what an
Organiser may propose, which decisions apply values, and how database refusals are
reported. Database calls are monkeypatched.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from app.event_repository import approve_change_request_record, create_change_request

from .conftest import ORIGIN, select_user
from .test_change_requests import _wire

URL = "/events/event-46/change-requests"


def _event(**extra):
    return {
        "id": "event-46", "status": "Confirmed", "organiser_id": 1, "coordinator_id": 2,
        "title": "Campus workshop", "description": "Learn together",
        "purpose": "Share skills", "category": "Workshop", "expected_attendance": 50,
        "venue_requirements": "Seminar room", "accessibility_requirements": None,
        "equipment_requirements": None, "registration_requirements": None, **extra,
    }


@pytest.fixture
def proposing(app, monkeypatch):
    """An Organiser session whose created requests are recorded."""
    _wire(monkeypatch, _event())
    created = []

    def create(event_id, user_id, description, requested_changes=None):
        created.append((event_id, user_id, description, requested_changes))
        return {"id": 1, "event_id": event_id, "description": description,
                "status": "Pending", "requested_changes": requested_changes}

    monkeypatch.setattr("app.events.create_change_request", create)
    client = app.test_client()
    select_user(client, 1)
    return client, created


def test_an_organiser_proposes_values_with_the_request(proposing):
    client, created = proposing
    response = client.post(URL, json={
        "description": "More people signed up",
        "changes": {"expected_attendance": 120, "title": "  Campus workshop II "},
    }, headers=ORIGIN)

    assert response.status_code == 201
    assert response.json["change_request"]["requested_changes"] == {
        "expected_attendance": 120, "title": "Campus workshop II",
    }
    assert created == [("event-46", 1, "More people signed up",
                        {"expected_attendance": 120, "title": "Campus workshop II"})]


def test_a_described_request_without_values_still_works(proposing):
    client, created = proposing
    response = client.post(URL, json={"description": "Please call me"}, headers=ORIGIN)
    assert response.status_code == 201
    assert created == [("event-46", 1, "Please call me", None)]


@pytest.mark.parametrize(("changes", "field"), [
    ({"expected_attendance": 0}, "expected_attendance"),
    ({"title": ""}, "title"),
    ({"expected_attendance": 50}, "expected_attendance"),
])
def test_invalid_proposed_values_are_reported_by_field(proposing, changes, field):
    client, created = proposing
    response = client.post(URL, json={"description": "Change", "changes": changes},
                           headers=ORIGIN)
    assert response.status_code == 400
    assert response.json["error"] == "Please check the proposed changes."
    assert set(response.json["fields"]) == {field}
    assert created == []


@pytest.mark.parametrize("body", [
    {"description": "Change", "changes": {}},
    {"description": "Change", "changes": {"event_datetime": "2099-01-01T00:00:00Z"}},
    {"description": "Change", "changes": ["title"]},
    {"changes": {"title": "New"}},
    {"description": "", "changes": {"title": "New"}},
    {"description": "Change", "changes": {"title": "New"}, "status": "Approved"},
])
def test_malformed_proposals_are_refused(proposing, body):
    client, created = proposing
    assert client.post(URL, json=body, headers=ORIGIN).status_code == 400
    assert created == []


# --- Reviewing: Approved applies the values atomically; other decisions do not ---

STRUCTURED = {"id": 7, "event_id": "event-46", "status": "Pending",
              "requested_changes": {"expected_attendance": 120}}


@pytest.fixture
def reviewing(app, monkeypatch):
    """A Coordinator session with one structured request and the approval recorded."""
    _wire(monkeypatch, _event(), [dict(STRUCTURED)])
    monkeypatch.setattr("app.events.require_related_user", lambda user, event, action: user)
    calls = {"approve": [], "history": [], "notify": []}

    def approve(event_id, request_id, user_id, note):
        calls["approve"].append((event_id, request_id, user_id, note))
        return {
            "change_request": {**STRUCTURED, "status": "Approved", "reviewed_by": user_id,
                               "applied_changes": {"expected_attendance": {"from": 50, "to": 120}},
                               "significant": True},
            "event": _event(status="Submitted", expected_attendance=120),
            "affected": {"venue_bookings": 2, "equipment_reservations": 1},
        }

    monkeypatch.setattr("app.events.approve_change_request_record", approve)
    monkeypatch.setattr("app.events.add_status_history",
                        lambda *args, **kwargs: calls["history"].append(kwargs))
    monkeypatch.setattr("app.events.create_notification",
                        lambda *args, **kwargs: calls["notify"].append(args))
    legacy = MagicMock()
    monkeypatch.setattr("app.events.update_change_request", legacy)
    client = app.test_client()
    select_user(client, 2)
    return client, calls, legacy


def test_approving_a_structured_request_applies_it_in_one_step(reviewing):
    client, calls, legacy = reviewing
    response = client.patch(f"{URL}/7", json={
        "status": "Approved", "review_note": "  Bigger room needed  ",
    }, headers=ORIGIN)

    assert response.status_code == 200
    assert calls["approve"] == [("event-46", 7, 2, "Bigger room needed")]
    assert response.json["change_request"]["applied_changes"] == {
        "expected_attendance": {"from": 50, "to": 120},
    }
    assert response.json["change_request"]["significant"] is True
    assert response.json["event"]["expected_attendance"] == 120
    assert response.json["event"]["status"] == "Submitted"  # Coordinators see the real state.
    assert response.json["affected"] == {"venue_bookings": 2, "equipment_reservations": 1}
    # History and notifications are written by the same database transaction.
    assert calls["history"] == [] and calls["notify"] == []
    legacy.assert_not_called()


@pytest.mark.parametrize("status", ["Under Review", "Rejected"])
def test_other_decisions_apply_nothing(reviewing, status):
    client, calls, legacy = reviewing
    legacy.return_value = {**STRUCTURED, "status": status}
    response = client.patch(f"{URL}/7", json={"status": status}, headers=ORIGIN)
    assert response.status_code == 200
    assert calls["approve"] == []
    legacy.assert_called_once()


def test_a_described_request_is_approved_as_before(reviewing, monkeypatch):
    client, calls, legacy = reviewing
    monkeypatch.setattr("app.events.get_change_requests", lambda event_id: [
        {"id": 7, "event_id": "event-46", "status": "Pending", "requested_changes": None},
    ])
    legacy.return_value = {"id": 7, "status": "Approved"}
    assert client.patch(f"{URL}/7", json={"status": "Approved"}, headers=ORIGIN).status_code == 200
    assert calls["approve"] == []
    legacy.assert_called_once()


@pytest.mark.parametrize("status", ["Completed", "Cancelled"])
def test_closed_events_refuse_before_anything_is_applied(reviewing, monkeypatch, status):
    client, calls, _ = reviewing
    monkeypatch.setattr("app.events.get_event_by_id", lambda event_id: _event(status=status))
    assert client.patch(f"{URL}/7", json={"status": "Approved"}, headers=ORIGIN).status_code == 409
    assert calls["approve"] == []


def test_only_the_assigned_coordinator_can_apply(reviewing, monkeypatch):
    client, calls, _ = reviewing
    monkeypatch.setattr("app.events.get_event_by_id", lambda event_id: _event(coordinator_id=7))
    assert client.patch(f"{URL}/7", json={"status": "Approved"}, headers=ORIGIN).status_code == 403
    assert calls["approve"] == []


def test_a_database_refusal_reaches_the_coordinator(reviewing, monkeypatch):
    client, _, _ = reviewing

    def refuse(*args):
        raise ServiceUnavailable(
            "Could not apply the change. The event was not changed; contact the team."
        )

    monkeypatch.setattr("app.events.approve_change_request_record", refuse)
    response = client.patch(f"{URL}/7", json={"status": "Approved"}, headers=ORIGIN)
    assert response.status_code == 503
    assert "event was not changed" in response.json["error"]


# --- Repository ---

def _rpc_client(data=None, error=None):
    calls = []

    def rpc(name, params):
        calls.append((name, params))

        def execute():
            if error:
                raise error
            return SimpleNamespace(data=data)

        return SimpleNamespace(execute=execute)

    return SimpleNamespace(rpc=rpc), calls


def test_approval_calls_the_database_function(monkeypatch):
    result = {"change_request": {"id": 7}, "event": {}, "affected": {}}
    client, calls = _rpc_client(data=result)
    monkeypatch.setattr("app.event_repository.get_supabase_client", lambda: client)
    assert approve_change_request_record("event-46", 7, 2, "Note") == result
    assert calls == [("approve_change_request", {
        "p_event_id": "event-46", "p_request_id": 7, "p_actor_id": 2, "p_review_note": "Note",
    })]


@pytest.mark.parametrize(("code", "message", "exception", "text"), [
    ("PT403", "Assigned coordinator required", Forbidden, "assigned Coordinator"),
    ("PT404", "Event not found", NotFound, "Event not found"),
    ("PT404", "Change request not found", NotFound, "Change request not found"),
    ("PT409", "closed_event", Conflict, "closed"),
    ("PT409", "already_reviewed", Conflict, "already been reviewed"),
    ("PT409", "nothing_to_apply", Conflict, "no proposed values"),
    ("PT409", "something_new", Conflict, "Reload it"),
    ("22023", "Invalid review note", BadRequest, "2000 characters"),
    ("23514", "violates check constraint", ServiceUnavailable, "event was not changed"),
])
def test_database_refusals_are_translated(monkeypatch, code, message, exception, text):
    error = APIError({"code": code, "message": message, "details": None, "hint": None})
    client, _ = _rpc_client(error=error)
    monkeypatch.setattr("app.event_repository.get_supabase_client", lambda: client)
    with pytest.raises(exception) as raised:
        approve_change_request_record("event-46", 7, 2, None)
    assert text in raised.value.description


@pytest.mark.parametrize("make", [
    lambda: None,
    lambda: _rpc_client(data=["not", "a", "dict"])[0],
    lambda: SimpleNamespace(rpc=lambda name, params: (_ for _ in ()).throw(OSError())),
])
def test_an_unconfirmed_approval_says_to_reload(monkeypatch, make):
    monkeypatch.setattr("app.event_repository.get_supabase_client", make)
    with pytest.raises(ServiceUnavailable) as raised:
        approve_change_request_record("event-46", 7, 2, None)
    assert "event was not changed" not in raised.value.description


@pytest.mark.parametrize(("changes", "stored"), [
    ({"title": "New"}, {"title": "New"}), (None, None),
])
def test_proposed_values_are_stored_only_when_given(monkeypatch, changes, stored):
    inserted = []
    query = MagicMock()
    query.insert.side_effect = lambda row: inserted.append(row) or query
    query.execute.return_value = SimpleNamespace(data=[{"id": 1}])
    monkeypatch.setattr("app.event_repository.get_supabase_client",
                        lambda: SimpleNamespace(table=lambda name: query))
    create_change_request("event-46", 1, "Change", requested_changes=changes)
    assert inserted[0].get("requested_changes") == stored
    assert ("requested_changes" in inserted[0]) is (stored is not None)

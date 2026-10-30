"""API tests for POST /events/<id>/cancel and the cancellation gate (SCRUM-69).

The pure rules are unit-tested in test_event_cancellation.py and the transactional
database function in test_event_cancellation_acceptance.py. These tests cover the
endpoint wiring: who is authorised, which states can be cancelled, input checks, the
generic status route no longer cancelling or reopening, and how database refusals are
reported. The database call is monkeypatched because the shared fake event database
does not model RPC functions.
"""

from types import SimpleNamespace

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from app.event_repository import cancel_event_record

from .conftest import ORIGIN, select_user
from .test_events import _seed_planning_event

pytest_plugins = ("tests.test_events",)

LEAD_ID = 8
REASON = {"reason": "  Main hall flooded; no alternative venue.  "}


@pytest.fixture
def lead(database):
    """Add a demo Event Coordinator Lead to the fake user table."""
    database[0].append({
        "id": LEAD_ID, "display_name": "Demo Event Coordinator Lead",
        "role": "Event Coordinator Lead", "is_demo": True,
    })
    return LEAD_ID


@pytest.fixture
def cancelled(monkeypatch):
    """Record database cancellation calls and return a successful result."""
    calls = []

    def _cancel(event_id, user_id, reason):
        calls.append((event_id, user_id, reason))
        return {
            "event": {"id": event_id, "status": "Cancelled", "organiser_id": 1,
                      "coordinator_id": 2, "last_status_changed_by": user_id},
            "released_equipment_reservations": 2,
            "released_venue_bookings": 3,
            "notified_attendees": 4,
        }

    monkeypatch.setattr("app.events.cancel_event_record", _cancel)
    return calls


def _cancel(client, event, **kwargs):
    kwargs.setdefault("json", REASON)
    return client.post(f"/events/{event['id']}/cancel", headers=ORIGIN, **kwargs)


# AC1: the assigned Coordinator cancels; resources are released and attendees notified.
@pytest.mark.parametrize("status", ["Submitted", "Planning", "Confirmed", "Preparation"])
def test_assigned_coordinator_cancels_an_active_event(
    app, event_database, cancelled, status
):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status=status)

    response = _cancel(client, event)

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Cancelled"
    assert response.json["released"] == {"equipment_reservations": 2, "venue_bookings": 3}
    assert response.json["notified_attendees"] == 4
    assert cancelled == [(event["id"], 2, "Main hall flooded; no alternative venue.")]


def test_lead_cancels_any_event_including_an_unassigned_submission(
    app, event_database, cancelled, lead
):
    client = app.test_client()
    select_user(client, lead)
    unassigned = _seed_planning_event(event_database, status="Submitted", coordinator_id=None)
    someone_elses = _seed_planning_event(event_database, status="Confirmed", coordinator_id=7)

    assert _cancel(client, unassigned).status_code == 200
    assert _cancel(client, someone_elses).status_code == 200
    assert [call[:2] for call in cancelled] == [
        (unassigned["id"], lead), (someone_elses["id"], lead),
    ]


# Only authorised users may cancel (D32).
@pytest.mark.parametrize("user_id", [1, 3, 4, 5])
def test_other_roles_cannot_cancel(app, event_database, cancelled, user_id):
    client = app.test_client()
    select_user(client, user_id)
    event = _seed_planning_event(event_database, status="Confirmed")

    assert _cancel(client, event).status_code == 403
    assert cancelled == []
    assert event["status"] == "Confirmed"


def test_a_coordinator_cannot_cancel_another_coordinators_event(
    app, event_database, cancelled, monkeypatch
):
    monkeypatch.setattr("app.events.require_related_user", lambda user, event, action: user)
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Planning", coordinator_id=7)

    response = _cancel(client, event)

    assert response.status_code == 403
    assert "assigned Coordinator or the Event Coordinator Lead" in response.json["error"]
    assert cancelled == []


# Closed and private events cannot be cancelled.
@pytest.mark.parametrize(
    ("status", "message"),
    [
        ("Cancelled", "This event is already cancelled."),
        ("Completed", "A completed event is closed and cannot be cancelled."),
        ("Rejected", "A rejected event is closed and cannot be cancelled."),
    ],
)
def test_closed_events_cannot_be_cancelled(app, event_database, cancelled, status, message):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status=status)

    response = _cancel(client, event)

    assert response.status_code == 409
    assert response.json["error"] == message
    assert cancelled == []


def test_a_draft_is_not_visible_for_cancellation(app, event_database, cancelled, lead):
    client = app.test_client()
    select_user(client, lead)
    draft = _seed_planning_event(event_database, status="Draft", coordinator_id=None)

    assert _cancel(client, draft).status_code == 404
    assert cancelled == []


@pytest.mark.parametrize(
    "payload",
    [{}, {"reason": ""}, {"reason": "   "}, {"reason": "x" * 2001}, {"reason": 5},
     {"reason": "ok", "status": "Cancelled"}, ["reason"]],
)
def test_a_valid_reason_is_required(app, event_database, cancelled, payload):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Planning")

    assert _cancel(client, event, json=payload).status_code == 400
    assert cancelled == []


def test_missing_body_is_rejected(app, event_database, cancelled):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Planning")

    response = client.post(f"/events/{event['id']}/cancel", headers=ORIGIN)

    assert response.status_code == 400
    assert cancelled == []


def test_cancellation_requires_a_session_and_trusted_origin(app, event_database, cancelled):
    event = _seed_planning_event(event_database, status="Planning")
    client = app.test_client()

    assert _cancel(client, event).status_code == 401
    select_user(client, 2)
    untrusted = client.post(
        f"/events/{event['id']}/cancel", json=REASON,
        headers={"Origin": "https://attacker.example"},
    )
    assert untrusted.status_code == 403
    assert cancelled == []


def test_missing_event_returns_404(app, cancelled):
    client = app.test_client()
    select_user(client, 2)

    response = client.post(
        "/events/00000000-0000-4000-8000-000000000000/cancel", json=REASON, headers=ORIGIN,
    )

    assert response.status_code == 404


# The generic status route can no longer cancel, or reopen a cancelled event.
@pytest.mark.parametrize("user_id", [1, 2, 3, 4])
def test_generic_status_route_cannot_cancel(app, event_database, user_id):
    client = app.test_client()
    select_user(client, user_id)
    event = _seed_planning_event(event_database, status="Planning")

    response = client.patch(
        f"/events/{event['id']}/status", json={"status": "Cancelled"}, headers=ORIGIN,
    )

    assert response.status_code in (403, 409)
    assert event["status"] == "Planning"


def test_generic_status_route_points_coordinators_to_the_cancellation_step(app, event_database):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Planning")

    response = client.patch(
        f"/events/{event['id']}/status", json={"status": "Cancelled"}, headers=ORIGIN,
    )

    assert response.status_code == 409
    assert "cancellation step" in response.json["error"]


@pytest.mark.parametrize("target", ["Planning", "Submitted", "Rejected"])
def test_a_cancelled_event_cannot_be_reopened(app, event_database, target):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Cancelled")

    response = client.patch(
        f"/events/{event['id']}/status", json={"status": target}, headers=ORIGIN,
    )

    assert response.status_code == 409
    assert "cancelled" in response.json["error"]
    assert event["status"] == "Cancelled"


# --- Repository: how database refusals from cancel_event() are reported ---

def _client_returning(data=None, error=None):
    def execute():
        if error:
            raise error
        return SimpleNamespace(data=data)

    rpc = SimpleNamespace(execute=execute)
    return SimpleNamespace(rpc=lambda name, params: rpc)


@pytest.mark.parametrize(
    ("code", "message", "exception", "text"),
    [
        ("PT403", "Assigned coordinator required", Forbidden, "Event Coordinator Lead"),
        ("PT404", "Event not found", NotFound, "Event not found"),
        ("PT409", "already_cancelled", Conflict, "already cancelled"),
        ("PT409", "closed_event", Conflict, "closed"),
        ("PT409", "something_new", Conflict, "Reload it"),
        ("22023", "Invalid cancellation reason", BadRequest, "2000 characters"),
        ("42703", "column does not exist", ServiceUnavailable, "Contact the team"),
    ],
)
def test_database_refusals_are_translated(monkeypatch, code, message, exception, text):
    error = APIError({"code": code, "message": message, "details": None, "hint": None})
    monkeypatch.setattr(
        "app.event_repository.get_supabase_client", lambda: _client_returning(error=error),
    )

    with pytest.raises(exception) as raised:
        cancel_event_record("event-69", 2, "Reason")

    assert text in raised.value.description


@pytest.mark.parametrize("client", [None, "unexpected-data", "boom"])
def test_unavailable_database_is_reported(monkeypatch, client):
    def make():
        if client is None:
            return None
        if client == "boom":
            return SimpleNamespace(rpc=lambda name, params: (_ for _ in ()).throw(OSError()))
        return _client_returning(data=["not", "a", "dict"])

    monkeypatch.setattr("app.event_repository.get_supabase_client", make)

    with pytest.raises(ServiceUnavailable):
        cancel_event_record("event-69", 2, "Reason")


def test_successful_database_result_is_returned(monkeypatch):
    result = {"event": {"id": "event-69", "status": "Cancelled"}, "notified_attendees": 0}
    monkeypatch.setattr(
        "app.event_repository.get_supabase_client", lambda: _client_returning(data=result),
    )

    assert cancel_event_record("event-69", 2, "Reason") == result

"""SCRUM-46 change request route coverage."""

from datetime import UTC, datetime

import pytest

from .conftest import ORIGIN, select_user


def _event():
    return {
        "id": "event-46",
        "status": "Confirmed",
        "organiser_id": 1,
        "coordinator_id": 2,
    }


def _wire(monkeypatch, event, requests=None):
    saved = requests if requests is not None else []
    monkeypatch.setattr("app.events.get_event_by_id", lambda event_id: event)
    monkeypatch.setattr("app.events.require_event_access", lambda event_id, user: event)
    monkeypatch.setattr("app.events.get_change_requests", lambda event_id: saved)
    monkeypatch.setattr(
        "app.events.create_change_request",
        lambda event_id, user_id, description: {
            "id": 1, "event_id": event_id, "requested_by": user_id,
            "description": description, "status": "Pending",
            "reviewed_by": None, "review_note": None,
            "requested_at": datetime.now(UTC).isoformat(), "reviewed_at": None,
        },
    )
    monkeypatch.setattr("app.events.add_status_history", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.events.create_notification", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        "app.events.update_change_request",
        lambda event_id, request_id, current_status, status, reviewer_id, review_note: {
            "id": request_id, "event_id": event_id, "requested_by": 1,
            "description": "Move the event start time", "status": status,
            "reviewed_by": reviewer_id, "review_note": review_note,
            "requested_at": datetime.now(UTC).isoformat(),
            "reviewed_at": datetime.now(UTC).isoformat(),
        },
    )
    return saved


def test_organiser_can_raise_change_request_after_confirmation(app, monkeypatch):
    _wire(monkeypatch, _event())
    client = app.test_client()
    select_user(client, 1)

    response = client.post(
        "/events/event-46/change-requests",
        json={"description": "Move the event start time by one hour"},
        headers=ORIGIN,
    )

    assert response.status_code == 201
    assert response.json["change_request"]["status"] == "Pending"


def test_change_request_rejects_unknown_fields_and_boundary_length(app, monkeypatch):
    _wire(monkeypatch, _event())
    client = app.test_client()
    select_user(client, 1)

    unknown = client.post(
        "/events/event-46/change-requests",
        json={"description": "A valid request", "status": "Approved"},
        headers=ORIGIN,
    )
    too_long = client.post(
        "/events/event-46/change-requests",
        json={"description": "x" * 2001},
        headers=ORIGIN,
    )

    assert unknown.status_code == 400
    assert too_long.status_code == 400


def test_coordinator_can_view_and_review_change_request(app, monkeypatch):
    requests = [{
        "id": 1, "event_id": "event-46", "requested_by": 1,
        "description": "Move the event start time", "status": "Pending",
    }]
    _wire(monkeypatch, _event(), requests)
    client = app.test_client()
    select_user(client, 2)

    listing = client.get("/events/event-46/change-requests", headers=ORIGIN)
    review = client.patch(
        "/events/event-46/change-requests/1",
        json={"status": "Approved"},
        headers=ORIGIN,
    )

    assert listing.status_code == 200
    assert listing.json["change_requests"] == requests
    assert review.status_code == 200
    assert review.json["change_request"]["status"] == "Approved"


def test_coordinator_review_records_status_history_action(app, monkeypatch):
    requests = [{
        "id": 1, "event_id": "event-46", "requested_by": 1,
        "description": "Move the event start time", "status": "Pending",
    }]
    _wire(monkeypatch, _event(), requests)
    history = []
    monkeypatch.setattr(
        "app.events.add_status_history",
        lambda *args, **kwargs: history.append(kwargs),
    )
    client = app.test_client()
    select_user(client, 2)

    response = client.patch(
        "/events/event-46/change-requests/1",
        json={"status": "Under Review"},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert history[-1]["action"] == "change_request_under_review"


def test_legacy_review_is_visible_in_status_history(app, monkeypatch):
    requests = [{
        "id": 1, "event_id": "event-46", "requested_by": 1,
        "description": "Move the event start time", "status": "Approved",
        "reviewed_by": 2, "reviewed_at": "2026-10-25T00:00:00+00:00",
        "review_note": None,
    }]
    _wire(monkeypatch, _event(), requests)
    monkeypatch.setattr("app.event_repository.get_change_requests", lambda event_id: requests)
    monkeypatch.setattr(
        "app.event_repository.get_supabase_client",
        lambda: type("Client", (), {
            "table": lambda self, name: type("Query", (), {
                "select": lambda self, *_: self,
                "eq": lambda self, *_: self,
                "order": lambda self, *_args, **_kwargs: self,
                "execute": lambda self: type("Result", (), {"data": [{
                    "id": 1,
                    "event_id": "event-46",
                    "old_status": "Planning",
                    "new_status": "Planning",
                    "changed_by": 1,
                    "changed_at": "2026-10-24T23:00:00+00:00",
                    "action": "change_requested",
                    "note": "Move the event start time",
                }]})(),
            })(),
        })(),
    )

    from app.event_repository import get_status_history

    history = get_status_history("event-46")

    assert history[-1]["action"] == "change_request_approved"


def test_organiser_cannot_review_change_request(app, monkeypatch):
    _wire(monkeypatch, _event())
    client = app.test_client()
    select_user(client, 1)

    response = client.patch(
        "/events/event-46/change-requests/1",
        json={"status": "Approved"},
        headers=ORIGIN,
    )

    assert response.status_code == 403


def test_change_request_not_allowed_for_draft(app, monkeypatch):
    event = _event()
    event["status"] = "Draft"
    _wire(monkeypatch, event)
    client = app.test_client()
    select_user(client, 1)

    response = client.post(
        "/events/event-46/change-requests",
        json={"description": "This must be rejected"},
        headers=ORIGIN,
    )

    assert response.status_code == 409


def test_change_request_rejects_untrusted_origin(app, monkeypatch):
    _wire(monkeypatch, _event())
    client = app.test_client()
    select_user(client, 1)

    response = client.post(
        "/events/event-46/change-requests",
        json={"description": "Move the event start time"},
        headers={"Origin": "https://attacker.example"},
    )

    assert response.status_code == 403


def test_change_request_rejects_blank_description(app, monkeypatch):
    _wire(monkeypatch, _event())
    client = app.test_client()
    select_user(client, 1)

    response = client.post(
        "/events/event-46/change-requests",
        json={"description": "   "},
        headers=ORIGIN,
    )

    assert response.status_code == 400


def test_only_the_owning_organiser_can_raise_change_request(app, monkeypatch):
    event = _event()
    event["organiser_id"] = 5
    _wire(monkeypatch, event)
    client = app.test_client()
    select_user(client, 1)

    response = client.post(
        "/events/event-46/change-requests",
        json={"description": "Move the event start time"},
        headers=ORIGIN,
    )

    assert response.status_code == 403


def test_change_request_needs_an_assigned_coordinator(app, monkeypatch):
    event = _event()
    event["coordinator_id"] = None
    _wire(monkeypatch, event)
    client = app.test_client()
    select_user(client, 1)

    response = client.post(
        "/events/event-46/change-requests",
        json={"description": "Move the event start time"},
        headers=ORIGIN,
    )

    assert response.status_code == 409


@pytest.mark.parametrize("status", ["Rejected", "Cancelled", "Completed"])
def test_change_request_not_allowed_for_closed_events(app, monkeypatch, status):
    event = _event()
    event["status"] = status
    _wire(monkeypatch, event)
    client = app.test_client()
    select_user(client, 1)

    response = client.post(
        "/events/event-46/change-requests",
        json={"description": "This must be rejected"},
        headers=ORIGIN,
    )

    assert response.status_code == 409


@pytest.mark.parametrize("status", ["Submitted", "Planning", "Confirmed"])
def test_change_request_routes_to_coordinator_at_any_stage(app, monkeypatch, status):
    event = _event()
    event["status"] = status
    _wire(monkeypatch, event)
    notifications = []
    history = []
    monkeypatch.setattr(
        "app.events.create_notification",
        lambda *args, **kwargs: notifications.append(args),
    )
    monkeypatch.setattr(
        "app.events.add_status_history",
        lambda *args, **kwargs: history.append((args, kwargs)),
    )
    client = app.test_client()
    select_user(client, 1)

    response = client.post(
        "/events/event-46/change-requests",
        json={"description": "  Move the event start time  "},
        headers=ORIGIN,
    )

    assert response.status_code == 201
    assert response.json["change_request"]["description"] == "Move the event start time"
    assert notifications[-1][:3] == (2, "event-46", "event_change_request")
    (args, kwargs), = history
    assert args[1] == args[2] == status
    assert kwargs["action"] == "change_requested"


def test_organiser_cannot_edit_a_confirmed_event_directly(app, monkeypatch):
    _wire(monkeypatch, _event())
    client = app.test_client()
    select_user(client, 1)

    response = client.patch(
        "/events/event-46",
        json={"title": "Organiser rewrite"},
        headers=ORIGIN,
    )

    assert response.status_code == 403


@pytest.mark.parametrize("user_id", [3, 4, 5])
def test_unrelated_roles_cannot_view_change_requests(app, monkeypatch, user_id):
    _wire(monkeypatch, _event())
    client = app.test_client()
    select_user(client, user_id)

    response = client.get("/events/event-46/change-requests", headers=ORIGIN)

    assert response.status_code == 403


def test_organiser_can_view_change_request_status(app, monkeypatch):
    requests = [{
        "id": 1, "event_id": "event-46", "requested_by": 1,
        "description": "Move the event start time", "status": "Under Review",
    }]
    _wire(monkeypatch, _event(), requests)
    client = app.test_client()
    select_user(client, 1)

    response = client.get("/events/event-46/change-requests", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["change_requests"][0]["status"] == "Under Review"


def test_only_the_assigned_coordinator_can_review(app, monkeypatch):
    event = _event()
    event["coordinator_id"] = 7
    _wire(monkeypatch, event, [{"id": 1, "event_id": "event-46", "status": "Pending"}])
    monkeypatch.setattr("app.events.require_related_user", lambda user, event, action: user)
    client = app.test_client()
    select_user(client, 2)

    response = client.patch(
        "/events/event-46/change-requests/1",
        json={"status": "Approved"},
        headers=ORIGIN,
    )

    assert response.status_code == 403


def test_change_requests_of_a_completed_event_cannot_be_reviewed(app, monkeypatch):
    event = _event()
    event["status"] = "Completed"
    _wire(monkeypatch, event, [{"id": 1, "event_id": "event-46", "status": "Pending"}])
    monkeypatch.setattr("app.events.require_related_user", lambda user, event, action: user)
    client = app.test_client()
    select_user(client, 2)

    response = client.patch(
        "/events/event-46/change-requests/1",
        json={"status": "Approved"},
        headers=ORIGIN,
    )

    assert response.status_code == 409
    assert "read-only" in response.json["error"]


def test_reviewing_an_unknown_change_request_returns_404(app, monkeypatch):
    _wire(monkeypatch, _event(), [])
    monkeypatch.setattr("app.events.require_related_user", lambda user, event, action: user)
    client = app.test_client()
    select_user(client, 2)

    response = client.patch(
        "/events/event-46/change-requests/99",
        json={"status": "Approved"},
        headers=ORIGIN,
    )

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("current", "target", "expected"),
    [
        ("Pending", "Implemented", 409),
        ("Under Review", "Under Review", 409),
        ("Approved", "Rejected", 409),
        ("Rejected", "Approved", 409),
        ("Implemented", "Approved", 409),
        ("Approved", "Implemented", 200),
        ("Under Review", "Rejected", 200),
    ],
)
def test_review_follows_allowed_transitions(app, monkeypatch, current, target, expected):
    _wire(monkeypatch, _event(), [{"id": 1, "event_id": "event-46", "status": current}])
    monkeypatch.setattr("app.events.require_related_user", lambda user, event, action: user)
    notifications = []
    monkeypatch.setattr(
        "app.events.create_notification",
        lambda *args, **kwargs: notifications.append(args),
    )
    client = app.test_client()
    select_user(client, 2)

    response = client.patch(
        "/events/event-46/change-requests/1",
        json={"status": target, "review_note": "  Checked with venue  "},
        headers=ORIGIN,
    )

    assert response.status_code == expected
    if expected == 200:
        assert response.json["change_request"]["review_note"] == "Checked with venue"
        assert notifications[-1][:3] == (1, "event-46", "event_change_request_updated")
    else:
        assert notifications == []


def test_review_rejects_overlong_note_and_unknown_status(app, monkeypatch):
    _wire(monkeypatch, _event(), [{"id": 1, "event_id": "event-46", "status": "Pending"}])
    monkeypatch.setattr("app.events.require_related_user", lambda user, event, action: user)
    client = app.test_client()
    select_user(client, 2)

    long_note = client.patch(
        "/events/event-46/change-requests/1",
        json={"status": "Approved", "review_note": "x" * 2001},
        headers=ORIGIN,
    )
    bad_status = client.patch(
        "/events/event-46/change-requests/1",
        json={"status": "Done"},
        headers=ORIGIN,
    )

    assert long_note.status_code == 400
    assert bad_status.status_code == 400

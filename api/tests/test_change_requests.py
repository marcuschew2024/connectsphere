"""SCRUM-46 change request route coverage."""

from datetime import UTC, datetime

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
                "execute": lambda self: type("Result", (), {"data": []})(),
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

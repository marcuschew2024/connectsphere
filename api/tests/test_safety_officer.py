"""SCRUM-127: the Safety Officer has only the safety workflow permissions."""

import pytest

from .conftest import ORIGIN, select_user
from .test_events import _seed_planning_event
from .test_safety_check_route import _as_safety_officer

pytest_plugins = ("tests.test_events",)


@pytest.mark.parametrize("user_id", range(1, 6))
def test_all_existing_roles_cannot_make_safety_decisions(app, event_database, user_id):
    client = app.test_client()
    select_user(client, user_id)
    event = _seed_planning_event(event_database, status="Confirmed")
    response = client.post(
        f"/events/{event['id']}/safety-check", json={"decision": "approve"}, headers=ORIGIN,
    )
    assert response.status_code == 403
    assert event["status"] == "Confirmed"
    assert event_database[1].history == []


@pytest.mark.parametrize("status", ["Planning", "Completed", "Cancelled"])
def test_even_related_safety_officer_cannot_read_outside_review_window(
    app, event_database, database, status,
):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status=status, coordinator_id=6)
    assert client.get(f"/events/{event['id']}", headers=ORIGIN).status_code == 403
    assert client.get(f"/events/{event['id']}/history", headers=ORIGIN).status_code == 403


def test_related_safety_officer_cannot_use_generic_status_mutation(app, event_database, database):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed", coordinator_id=6)
    response = client.patch(
        f"/events/{event['id']}/status", json={"status": "Cancelled"}, headers=ORIGIN,
    )
    assert response.status_code == 403
    assert event["status"] == "Confirmed"


@pytest.mark.parametrize("method,path,body", [
    ("post", "/events", {"action": "draft"}),
    ("post", "/venues", {}),
    ("post", "/venues/bookings", {}),
    ("post", "/equipment", {}),
])
def test_safety_officer_cannot_mutate_other_workflows(app, database, method, path, body):
    client = _as_safety_officer(app, database)
    assert getattr(client, method)(path, json=body, headers=ORIGIN).status_code == 403


@pytest.mark.parametrize("user_id", [None, 1, 2, 3, 4, 5])
def test_queue_rejects_every_other_identity(app, user_id):
    client = app.test_client()
    if user_id is not None:
        select_user(client, user_id)
    response = client.get("/events/safety-review", headers=ORIGIN)
    assert response.status_code == (401 if user_id is None else 403)


def test_queue_uses_bounded_page_and_requires_origin(app, database, monkeypatch):
    client = _as_safety_officer(app, database)
    calls = []

    def queue(page):
        calls.append(page)
        return [{"id": "confirmed", "status": "Confirmed"}], True

    monkeypatch.setattr("app.events.list_safety_review_events", queue)
    response = client.get("/events/safety-review?page=2", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json == {
        "events": [{"id": "confirmed", "status": "Confirmed", "request_status": "Confirmed"}],
        "page": 2, "has_more": True,
    }
    assert calls == [2]
    assert client.get("/events/safety-review").status_code == 403
    for page in ["0", "-1", "1.5", "10001", "x"]:
        assert client.get(f"/events/safety-review?page={page}", headers=ORIGIN).status_code == 400


def test_safety_officer_cannot_use_generic_event_list(app, database):
    client = _as_safety_officer(app, database)
    assert client.get("/events", headers=ORIGIN).status_code == 403

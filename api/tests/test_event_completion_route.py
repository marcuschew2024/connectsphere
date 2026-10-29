"""API tests for POST /events/<id>/complete and the read-only rules (SCRUM-132).

The pure gate is unit-tested in test_event_completion.py and the transactional
database function in test_event_completion_acceptance.py. These tests cover the
endpoint wiring: assigned-Coordinator only, Preparation only, input checks, the
blocked message, and that a Completed event can no longer be changed through
other routes. The repository calls are monkeypatched because the shared fake
event database does not model bookings, equipment requests or RPC functions.
"""

import pytest

from .conftest import ORIGIN, select_user
from .test_events import _seed_planning_event

pytest_plugins = ("tests.test_events",)


@pytest.fixture
def arrangements(monkeypatch):
    """Control the bookings, equipment requests and database completion result."""
    calls = []

    def _set(bookings=(), requests=()):
        monkeypatch.setattr(
            "app.events.list_bookings_for_event",
            lambda event_id: [{"status": status} for status in bookings],
        )
        monkeypatch.setattr(
            "app.events.list_event_equipment_requests",
            lambda event_id: [{"status": status} for status in requests],
        )

    def _complete(event_id, user_id, note):
        calls.append((event_id, user_id, note))
        return {
            "event": {"id": event_id, "status": "Completed", "last_status_changed_by": user_id},
            "released_equipment_reservations": 2,
            "released_venue_bookings": 1,
        }

    monkeypatch.setattr("app.events.complete_event_record", _complete)
    _set()
    _set.calls = calls
    return _set


def _complete(client, event, **kwargs):
    return client.post(f"/events/{event['id']}/complete", headers=ORIGIN, **kwargs)


# AC1/AC2: the assigned Coordinator completes a delivered event; resources are released.
def test_coordinator_completes_a_preparation_event(app, event_database, arrangements):
    arrangements(["Confirmed", "Cancelled"], ["Reserved", "Unavailable"])
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Preparation")

    response = _complete(client, event)

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Completed"
    assert response.json["released"] == {"equipment_reservations": 2, "venue_bookings": 1}
    assert arrangements.calls == [(event["id"], 2, None)]


# AC4 (optional): post-event notes are trimmed and passed to the audited record.
def test_post_event_notes_are_recorded(app, event_database, arrangements):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Preparation")

    response = _complete(client, event, json={"note": "  Projector failed for 10 minutes.  "})

    assert response.status_code == 200
    assert arrangements.calls[-1][2] == "Projector failed for 10 minutes."


def test_blank_notes_are_stored_as_no_note(app, event_database, arrangements):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Preparation")

    assert _complete(client, event, json={"note": "   "}).status_code == 200
    assert arrangements.calls[-1][2] is None


@pytest.mark.parametrize(
    "payload",
    [{"note": "x" * 2001}, {"note": 42}, {"note": "ok", "status": "Completed"}, ["note"]],
)
def test_invalid_completion_payloads_are_rejected(app, event_database, arrangements, payload):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Preparation")

    assert _complete(client, event, json=payload).status_code == 400
    assert arrangements.calls == []


# AC6: an ineligible state is blocked with a clear message.
@pytest.mark.parametrize(
    "status", ["Submitted", "Planning", "Confirmed", "Rejected", "Cancelled"],
)
def test_events_outside_preparation_cannot_be_completed(
    app, event_database, arrangements, status
):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status=status)

    response = _complete(client, event)

    assert response.status_code == 409
    assert "Only an event in Preparation can be completed." in response.json["error"]
    assert arrangements.calls == []


def test_completing_twice_explains_it_is_already_completed(app, event_database, arrangements):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Completed")

    response = _complete(client, event)

    assert response.status_code == 409
    assert "already completed" in response.json["error"]


# AC6: incomplete arrangements are blocked with the outstanding items listed.
def test_incomplete_arrangements_block_completion(app, event_database, arrangements):
    arrangements(["Confirmed", "Requested"], ["Requested"])
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Preparation")

    response = _complete(client, event)

    assert response.status_code == 409
    assert response.json["error"] == (
        "This event cannot be completed yet. "
        "1 venue booking(s) still awaiting approval. "
        "1 equipment request(s) still awaiting Tech Support."
    )
    assert arrangements.calls == []


# Only the assigned Coordinator may complete; other roles and coordinators are denied.
@pytest.mark.parametrize("user_id", [1, 3, 4, 5])
def test_non_coordinators_cannot_complete(app, event_database, arrangements, user_id):
    client = app.test_client()
    select_user(client, user_id)
    event = _seed_planning_event(event_database, status="Preparation")

    assert _complete(client, event).status_code == 403
    assert arrangements.calls == []


def test_a_different_coordinator_cannot_complete(app, event_database, arrangements, monkeypatch):
    monkeypatch.setattr(
        "app.events.require_related_user", lambda user, event, action: user,
    )
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Preparation", coordinator_id=99)

    assert _complete(client, event).status_code == 403
    assert arrangements.calls == []


def test_completion_requires_a_session_and_trusted_origin(app, event_database, arrangements):
    event = _seed_planning_event(event_database, status="Preparation")
    client = app.test_client()

    assert _complete(client, event).status_code == 401
    select_user(client, 2)
    untrusted = client.post(
        f"/events/{event['id']}/complete", headers={"Origin": "https://attacker.example"},
    )
    assert untrusted.status_code == 403
    assert arrangements.calls == []


def test_missing_event_returns_404(app, arrangements):
    client = app.test_client()
    select_user(client, 2)

    response = client.post(
        "/events/00000000-0000-4000-8000-000000000000/complete", headers=ORIGIN,
    )

    assert response.status_code == 404


# AC2/AC3: completion cannot be skipped and a Completed event is read-only elsewhere.
def test_generic_status_route_cannot_set_completed(app, event_database):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Preparation")

    response = client.patch(
        f"/events/{event['id']}/status", json={"status": "Completed"}, headers=ORIGIN,
    )

    assert response.status_code == 409
    assert "completion step" in response.json["error"]
    assert event["status"] == "Preparation"


@pytest.mark.parametrize("target", ["Planning", "Cancelled", "Rejected"])
def test_completed_event_status_cannot_change(app, event_database, target):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Completed")

    response = client.patch(
        f"/events/{event['id']}/status", json={"status": target}, headers=ORIGIN,
    )

    assert response.status_code == 409
    assert "read-only" in response.json["error"]
    assert event["status"] == "Completed"


def test_completed_event_details_cannot_be_edited(app, event_database):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Completed")

    response = client.patch(
        f"/events/{event['id']}", json={"title": "Rewritten after close"}, headers=ORIGIN,
    )

    assert response.status_code == 409
    assert event["title"] == "Original title"


# AC5: completed events stay visible to related users after closing.
def test_completed_event_remains_visible(app, event_database):
    client = app.test_client()
    select_user(client, 1)
    event = _seed_planning_event(event_database, status="Completed")

    detail = client.get(f"/events/{event['id']}", headers=ORIGIN)
    listing = client.get("/events", headers=ORIGIN)

    assert detail.json["event"]["status"] == "Completed"
    assert any(row["id"] == event["id"] for row in listing.json["events"])

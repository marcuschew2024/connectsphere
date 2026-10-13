"""API integration tests for POST /events/<id>/safety-check (SCRUM-128).

The pure decision rule is unit-tested in test_safety_decision.py. These tests cover the
endpoint: Safety Officer only, Confirmed-only, the three decisions and the status each
produces, and the audited history entry (actor + timestamp + reason).

The Safety Officer role (SCRUM-127) is not yet in the shared seed, so each test appends a
Safety Officer demo user (id 6) to the app_users rows rather than editing the conftest.
"""


from .conftest import ORIGIN, select_user
from .test_events import _seed_planning_event

pytest_plugins = ("tests.test_events",)


def _as_safety_officer(app, database):
    database[0].append({
        "id": 6, "display_name": "Demo Safety Officer", "role": "Safety Officer", "is_demo": True,
    })
    client = app.test_client()
    select_user(client, 6)
    return client


# approve -> the event proceeds to Preparation (AC: approval lets it proceed).
def test_safety_officer_approval_moves_event_to_preparation(app, event_database, database):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.post(
        f"/events/{event['id']}/safety-check", json={"decision": "approve"}, headers=ORIGIN
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Preparation"


# The decision is audited with the actor + safety action (AC: recorded with actor/timestamp).
def test_approval_is_recorded_in_history_with_actor(app, event_database, database):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")

    client.post(f"/events/{event['id']}/safety-check", json={"decision": "approve"}, headers=ORIGIN)
    # Read the audit trail as the related Coordinator (a Safety Officer is role-authorised
    # to act but is not a related viewer of the event).
    coordinator = app.test_client()
    select_user(coordinator, 2)
    history = coordinator.get(f"/events/{event['id']}/history", headers=ORIGIN)

    entry = history.json["history"][0]
    assert entry["old_status"] == "Confirmed"
    assert entry["new_status"] == "Preparation"
    assert entry["changed_by"] == 6
    assert entry["action"] == "safety_approved"
    assert entry["changed_at"]


# request_changes -> back to Planning with the reason recorded (AC: returns to earlier stage).
def test_request_changes_returns_event_to_planning_with_reason(app, event_database, database):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.post(
        f"/events/{event['id']}/safety-check",
        json={"decision": "request_changes", "reason": "Add a second emergency exit."},
        headers=ORIGIN,
    )
    coordinator = app.test_client()
    select_user(coordinator, 2)
    history = coordinator.get(f"/events/{event['id']}/history", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Planning"
    assert history.json["history"][0]["note"] == "Add a second emergency exit."
    assert history.json["history"][0]["action"] == "safety_changes_requested"


# reject -> back to Planning with a safety-reject reason (PO decision).
def test_reject_returns_event_to_planning_with_reason(app, event_database, database):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.post(
        f"/events/{event['id']}/safety-check",
        json={"decision": "reject", "reason": "Crowd movement is unsafe for this layout."},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Planning"


# A send-back decision without a reason is rejected (AC: reason required).
def test_request_changes_without_reason_is_rejected(app, event_database, database):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.post(
        f"/events/{event['id']}/safety-check", json={"decision": "request_changes"}, headers=ORIGIN
    )

    assert response.status_code == 400
    assert event["status"] == "Confirmed"


# Only a Safety Officer may run the safety check (AC: unauthorised access denied).
def test_non_safety_officer_cannot_submit_safety_check(app, event_database):
    client = app.test_client()
    select_user(client, 2)  # Coordinator
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.post(
        f"/events/{event['id']}/safety-check", json={"decision": "approve"}, headers=ORIGIN
    )

    assert response.status_code == 403
    assert event["status"] == "Confirmed"


# The safety check is available only after the event is confirmed (AC: follows SCRUM-39).
def test_safety_check_rejected_when_event_not_confirmed(app, event_database, database):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Planning")

    response = client.post(
        f"/events/{event['id']}/safety-check", json={"decision": "approve"}, headers=ORIGIN
    )

    assert response.status_code == 409
    assert event["status"] == "Planning"

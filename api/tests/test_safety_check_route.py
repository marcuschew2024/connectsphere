"""API integration tests for POST /events/<id>/safety-check (SCRUM-128).

The pure decision rule is unit-tested in test_safety_decision.py. These tests cover the
endpoint: Safety Officer only, Confirmed-only, the three decisions and the status each
produces, and the audited history entry (actor + timestamp + reason).

The Safety Officer role (SCRUM-127) is not yet in the shared seed, so each test appends a
Safety Officer demo user (id 6) to the app_users rows rather than editing the conftest.
"""


from datetime import datetime, timedelta

import pytest
from werkzeug.exceptions import ServiceUnavailable

from .conftest import ORIGIN, select_user
from .test_events import _seed_planning_event

pytest_plugins = ("tests.test_events",)


@pytest.fixture(autouse=True)
def _valid_arrangements(monkeypatch):
    """SCRUM-171 / audit A2: approving a safety check now re-runs the confirmation gate.

    Default every test to a valid arrangement - one Confirmed venue and no outstanding
    equipment - so an approval still reaches Preparation. The A2 tests below override this
    to model an arrangement that lapsed after confirmation (e.g. the only venue cancelled).
    The shared event DB fixture does not model venue_bookings, so the gate's reads are
    monkeypatched here exactly as the confirm-route tests do.
    """
    monkeypatch.setattr(
        "app.events.list_bookings_for_event", lambda event_id: [{"status": "Confirmed"}]
    )
    monkeypatch.setattr("app.events.list_confirmation_requests", lambda event_id: [])


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
    # Read the audit trail as the related Coordinator (always permitted, regardless of the
    # status the decision leaves the event in).
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


# --- SCRUM-171 / audit A2: approval re-validates the event's current arrangements ---

# The only Confirmed venue was cancelled after confirmation. Approval must be refused and
# the event returned to Planning so the Coordinator can re-arrange and re-confirm. The
# cancelled booking is left intact (Week 7 #6): nothing here un-books it.
def test_approval_refused_and_returned_to_planning_when_no_valid_venue_remains(
    app, event_database, database, monkeypatch
):
    monkeypatch.setattr(
        "app.events.list_bookings_for_event", lambda event_id: [{"status": "Cancelled"}]
    )
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.post(
        f"/events/{event['id']}/safety-check", json={"decision": "approve"}, headers=ORIGIN
    )

    assert response.status_code == 409
    assert "returned to Planning" in response.json["error"]
    assert event["status"] == "Planning"  # the stale Confirmed state was reset
    entry = event_database[1].history[-1]
    assert entry["old_status"] == "Confirmed"
    assert entry["new_status"] == "Planning"
    assert entry["action"] == "safety_arrangements_invalidated"


# Cancelling one of several venues still leaves a valid approved venue: approval proceeds.
def test_approval_proceeds_when_a_valid_venue_still_remains(
    app, event_database, database, monkeypatch
):
    monkeypatch.setattr(
        "app.events.list_bookings_for_event",
        lambda event_id: [{"status": "Confirmed"}, {"status": "Cancelled"}],
    )
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.post(
        f"/events/{event['id']}/safety-check", json={"decision": "approve"}, headers=ORIGIN
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Preparation"


# A send-back decision never runs the gate - request_changes already returns to Planning,
# so a lapsed arrangement does not change its outcome (only an approval is re-validated).
def test_request_changes_still_works_without_a_valid_arrangement(
    app, event_database, database, monkeypatch
):
    monkeypatch.setattr("app.events.list_bookings_for_event", lambda event_id: [])
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.post(
        f"/events/{event['id']}/safety-check",
        json={"decision": "request_changes", "reason": "Block the rear corridor."},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Planning"
    assert event_database[1].history[-1]["action"] == "safety_changes_requested"


# --- SCRUM-175: the re-gate must be the SAME gate as confirm_event (incl. SCRUM-166 span) ---

# A booking covering only the event's start hour (not its full start-end span) must not pass
# safety approval: the re-gate now passes event_end, so the full-coverage check runs.
def test_approval_refused_when_bookings_do_not_cover_the_full_event_span(
    app, event_database, database, monkeypatch
):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")  # 3h span (start .. start+3h)
    start = datetime.fromisoformat(event["event_datetime"])
    monkeypatch.setattr(
        "app.events.list_bookings_for_event",
        lambda event_id: [{
            "status": "Confirmed",
            "start_at": event["event_datetime"],
            "end_at": (start + timedelta(hours=1)).isoformat(),  # covers only the first hour
        }],
    )

    response = client.post(
        f"/events/{event['id']}/safety-check", json={"decision": "approve"}, headers=ORIGIN
    )

    assert response.status_code == 409
    assert event["status"] == "Planning"  # refused and returned to Planning
    assert "returned to Planning" in response.json["error"]


# SCRUM-175 / A4 parity: a failed audit-history write must not 500 an event that already moved.
def test_approval_survives_a_failed_history_write(app, event_database, database, monkeypatch):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")
    monkeypatch.setattr(
        "app.events.add_status_history",
        lambda *a, **k: (_ for _ in ()).throw(ServiceUnavailable("history down")),
    )

    response = client.post(
        f"/events/{event['id']}/safety-check", json={"decision": "approve"}, headers=ORIGIN
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Preparation"
    assert event["status"] == "Preparation"  # persisted state agrees with the response


# A Safety Officer can read a Confirmed event to review it, without being related to it.
def test_safety_officer_can_view_a_confirmed_event(app, event_database, database):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.get(f"/events/{event['id']}", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["event"]["id"] == event["id"]


# That role-based read is scoped to the safety-review window, not every event.
def test_safety_officer_cannot_view_a_planning_event(app, event_database, database):
    client = _as_safety_officer(app, database)
    event = _seed_planning_event(event_database, status="Planning")

    response = client.get(f"/events/{event['id']}", headers=ORIGIN)

    assert response.status_code == 403

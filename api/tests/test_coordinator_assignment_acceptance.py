"""SCRUM-130 acceptance tests against real PostgreSQL and PostgREST (TC-130-01..04).

Start compose.acceptance.yml and run supabase/tests/run.sh first. These tests use
only disposable local records, never hosted data. Demo users: 1 Organiser,
2 and 7 Coordinators, 6 a second Organiser; the Lead is found via /dev/users.
Reassignment targets the seeded password account coordinator.b (SCRUM-139), so these
tests never leave events assigned to the demo Coordinators other suites inspect.
"""

import os

import pytest

from . import test_request_acceptance as request_acceptance
from .conftest import ORIGIN, select_user
from .test_role_accounts_acceptance import PASSWORD

live = request_acceptance.live

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


@pytest.fixture
def lead(live):
    app, _, _ = live
    client = app.test_client()
    demo_users = client.get("/dev/users").json["users"]
    lead_id = next(user["id"] for user in demo_users if user["role"] == "Event Coordinator Lead")
    assert select_user(client, lead_id).status_code == 200
    client.user_id = lead_id
    return client


@pytest.fixture
def other(live):
    """A second Coordinator, signed in with a real password session."""
    app, _, _ = live
    client = app.test_client()
    response = client.post("/auth/login", json={
        "email": "coordinator.b@connectsphere.test", "password": PASSWORD}, headers=ORIGIN)
    assert response.status_code == 200, response.json
    client.user_id = response.json["user"]["id"]
    return client


def submitted(users):
    draft = request_acceptance.new_draft(users, request_acceptance.details())
    return request_acceptance.submit(users, draft).json["event"]


def assign(lead, event, coordinator_id):
    return lead.post(f"/events/{event['id']}/coordinator",
                     json={"coordinator_id": coordinator_id}, headers=ORIGIN)


def notifications_for(client, event):
    response = client.get("/notifications", headers=ORIGIN)
    assert response.status_code == 200
    return [row for row in response.json["notifications"] if row["event_id"] == event["id"]]


def test_tc_130_01_submission_enters_the_unassigned_queue_the_lead_can_see(live, lead):
    _, database, users = live
    event = submitted(users)

    stored = database.table("events").select("*").eq("id", event["id"]).execute().data[0]
    assert stored["status"] == "Submitted" and stored["coordinator_id"] is None
    for coordinator in (2, 7):
        # SCRUM-54: a Coordinator now sees the unassigned request in their list, but it is
        # not theirs to action yet (is_mine False); routing still belongs to the Lead.
        queue = users[coordinator].get("/events", headers=ORIGIN).json["events"]
        row = next(row for row in queue if row["id"] == event["id"])
        assert row["is_mine"] is False
    supervised = lead.get("/events", headers=ORIGIN).json["events"]
    row = next(row for row in supervised if row["id"] == event["id"])
    # Basic event info the Lead needs to route the request.
    assert row["coordinator_id"] is None and row["status"] == "Submitted"
    assert row["title"] == event["title"] and row["category"] == "Workshop"
    assert row["event_datetime"] and row["expected_attendance"] == 50 and row["submitted_at"]


def test_tc_130_02_lead_assigns_and_the_coordinator_is_notified(live, lead):
    _, database, users = live
    event = submitted(users)
    coordinators = lead.get("/events/coordinators", headers=ORIGIN).json["coordinators"]
    assert {2, 7} <= {row["id"] for row in coordinators}
    assert set(coordinators[0]) == {"id", "display_name"}

    response = assign(lead, event, 2)

    assert response.status_code == 200, response.json
    assert response.json["outcome"] == "assigned"
    assert response.json["event"]["coordinator_id"] == 2
    assert response.json["event"]["status"] == "Submitted"
    queue = users[2].get("/events", headers=ORIGIN).json["events"]
    assert any(row["id"] == event["id"] for row in queue)
    [note] = notifications_for(users[2], event)
    assert note["notification_type"] == "coordinator_assigned"
    assert event["title"] in note["message"]
    [organiser_note] = notifications_for(users[1], event)
    assert organiser_note["notification_type"] == "request_assigned"
    assert event["title"] in organiser_note["message"]
    assert "will review it" in organiser_note["message"]
    history = database.table("event_status_history").select("*").eq(
        "event_id", event["id"]).eq("action", "coordinator_assigned").execute().data
    assert len(history) == 1 and history[0]["changed_by"] == lead.user_id
    # The Coordinator can now act on it (the existing SCRUM-18 decision flow).
    decided = users[2].post(f"/events/{event['id']}/decision",
                            json={"decision": "approve"}, headers=ORIGIN)
    assert decided.status_code == 200


def test_tc_130_03_lead_reassigns_and_both_coordinators_are_notified(live, lead, other):
    _, database, users = live
    event = submitted(users)
    assert assign(lead, event, 2).status_code == 200
    users[2].post(f"/events/{event['id']}/decision", json={"decision": "approve"},
                  headers=ORIGIN)  # Planning: reassignment works after a decision too.

    response = assign(lead, event, other.user_id)

    assert response.status_code == 200, response.json
    assert response.json["outcome"] == "reassigned"
    assert response.json["previous_coordinator_id"] == 2
    stored = database.table("events").select("*").eq("id", event["id"]).execute().data[0]
    assert stored["coordinator_id"] == other.user_id and stored["status"] == "Planning"
    members = database.table("event_participants").select("user_id").eq(
        "event_id", event["id"]).eq("role", "Coordinator").execute().data
    assert members == [{"user_id": other.user_id}]
    assert [n["notification_type"] for n in notifications_for(other, event)] == [
        "coordinator_assigned"]
    assert "coordinator_unassigned" in [
        n["notification_type"] for n in notifications_for(users[2], event)]
    # The Organiser heard once, on first assignment; the reassignment stays internal.
    organiser_types = [n["notification_type"] for n in notifications_for(users[1], event)]
    assert organiser_types.count("request_assigned") == 1
    assert not [kind for kind in organiser_types if kind.startswith("coordinator_")]


def test_tc_130_04_coordinators_only_manage_events_assigned_to_them(live, lead, other):
    _, _, users = live
    unassigned = submitted(users)
    moved = submitted(users)
    assert assign(lead, moved, 2).status_code == 200
    assert assign(lead, moved, other.user_id).status_code == 200

    for event in (unassigned, moved):
        # Coordinator 2 was never assigned the first, and lost the second.
        assert users[2].get(f"/events/{event['id']}", headers=ORIGIN).status_code == 403
        assert users[2].post(f"/events/{event['id']}/decision", json={"decision": "approve"},
                             headers=ORIGIN).status_code == 403
        assert users[2].patch(f"/events/{event['id']}", json={"title": "Taken over"},
                              headers=ORIGIN).status_code == 403
        # SCRUM-54: coordinator 2 now sees both events in the list, but neither is theirs
        # to manage (is_mine False) — the 403s above prove read does not grant edit.
        row = next(row for row in users[2].get("/events", headers=ORIGIN).json["events"]
                   if row["id"] == event["id"])
        assert row["is_mine"] is False
    assert other.post(f"/events/{moved['id']}/decision", json={"decision": "approve"},
                      headers=ORIGIN).status_code == 200


def test_refusals_leave_the_assignment_unchanged(live, lead):
    _, database, users = live
    event = submitted(users)
    assert assign(lead, event, 2).status_code == 200

    assert assign(lead, event, 2).status_code == 409  # Already assigned.
    assert assign(lead, event, 1).status_code == 400  # Organiser is not a Coordinator.
    assert assign(lead, event, 999999).status_code == 400
    assert lead.post(f"/events/{event['id']}/coordinator", json={"coordinator_id": "7"},
                     headers=ORIGIN).status_code == 400
    assert lead.post("/events/00000000-0000-4000-8000-000000000000/coordinator",
                     json={"coordinator_id": 7}, headers=ORIGIN).status_code == 404
    draft = request_acceptance.new_draft(users, {"title": "Private"})
    assert assign(lead, draft, 7).status_code == 404  # Drafts stay private.
    users[2].post(f"/events/{event['id']}/decision",
                  json={"decision": "reject", "reason": "No venue fits."}, headers=ORIGIN)
    assert assign(lead, event, 7).status_code == 409  # Rejected is closed.
    stored = database.table("events").select("coordinator_id").eq(
        "id", event["id"]).execute().data[0]
    assert stored["coordinator_id"] == 2
    assert len(database.table("event_status_history").select("id").eq(
        "event_id", event["id"]).like("action", "coordinator_%").execute().data) == 1

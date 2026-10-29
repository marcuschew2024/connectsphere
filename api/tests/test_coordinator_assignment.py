"""SCRUM-130 unit tests: the assignment rule and the route's access checks."""

import pytest

from app.coordinator_assignment import (
    ASSIGNABLE_STATUSES,
    CLOSED_STATUSES,
    AssignmentRefused,
    CoordinatorAssignment,
)

from .conftest import ORIGIN, select_user

EVENT_ID = "11111111-1111-4111-8111-111111111111"


# --- Value object ---------------------------------------------------------------

def test_unassigned_request_is_assigned_and_assigned_event_is_reassigned():
    assignment = CoordinatorAssignment(7)
    assert assignment.outcome(status="Submitted", current_coordinator_id=None) == "assigned"
    assert assignment.outcome(status="Planning", current_coordinator_id=2) == "reassigned"


@pytest.mark.parametrize("status", sorted(ASSIGNABLE_STATUSES))
def test_every_active_state_can_be_rerouted(status):
    assert CoordinatorAssignment(7).outcome(status=status, current_coordinator_id=2) == "reassigned"


@pytest.mark.parametrize("status", sorted(CLOSED_STATUSES | {"Draft", "Unknown"}))
def test_closed_draft_and_unknown_states_are_refused(status):
    with pytest.raises(AssignmentRefused):
        CoordinatorAssignment(7).outcome(status=status, current_coordinator_id=2)


def test_assigning_the_current_coordinator_again_is_refused():
    with pytest.raises(AssignmentRefused, match="already assigned"):
        CoordinatorAssignment(2).outcome(status="Submitted", current_coordinator_id=2)


@pytest.mark.parametrize("payload", [
    None, [], {}, {"coordinator_id": "2"}, {"coordinator_id": True}, {"coordinator_id": 0},
    {"coordinator_id": 2_147_483_648}, {"coordinator_id": 2.0},
    {"coordinator_id": 2, "status": "Planning"},
])
def test_payload_must_be_exactly_one_valid_coordinator_id(payload):
    with pytest.raises(ValueError):
        CoordinatorAssignment.from_payload(payload)


def test_valid_payload_is_parsed():
    assert CoordinatorAssignment.from_payload({"coordinator_id": 7}) == CoordinatorAssignment(7)


# --- Route access (server-side RBAC) --------------------------------------------

@pytest.fixture
def no_audit(monkeypatch):
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)


@pytest.mark.usefixtures("no_audit")
@pytest.mark.parametrize("user_id", [1, 2, 3, 4, 5])  # Every non-Lead demo role.
def test_only_the_lead_may_assign_or_list_coordinators(app, user_id, monkeypatch):
    called = []
    monkeypatch.setattr("app.events.assign_event_coordinator", lambda *a: called.append(a))
    client = app.test_client()
    select_user(client, user_id)

    assert client.post(f"/events/{EVENT_ID}/coordinator", json={"coordinator_id": 7},
                       headers=ORIGIN).status_code == 403
    assert client.get("/events/coordinators", headers=ORIGIN).status_code == 403
    assert called == []


def test_assignment_requires_a_signed_in_user_and_trusted_origin(app):
    client = app.test_client()
    assert client.post(f"/events/{EVENT_ID}/coordinator", json={"coordinator_id": 7},
                       headers=ORIGIN).status_code == 401
    assert client.post(f"/events/{EVENT_ID}/coordinator", json={"coordinator_id": 7},
                       headers={"Origin": "https://untrusted.example"}).status_code == 403

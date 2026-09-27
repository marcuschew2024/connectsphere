"""Unit and API integration tests for coordinator event decisions."""

import pytest

from app.event_decision import EventDecision

from .conftest import ORIGIN, select_user
from .test_events import _seed_planning_event

pytest_plugins = ("tests.test_events",)



# --------------- Unit Tests for EventDecision Class ---------------

@pytest.mark.parametrize(
    ("payload", "status"),
    [
        ({"decision": "approve"}, "Planning"),
        ({"decision": "reject", "reason": "The venue is unavailable."}, "Rejected"),
    ],
)


# Map approval to "Planning"; map rejection to "Rejected"
def test_valid_payload_builds_expected_decision(payload, status):
    decision = EventDecision.from_payload(payload)

    assert decision.status == status
    assert decision.is_rejection is (payload["decision"] == "reject")


# Approval ignores a rejection reason
def test_approval_discards_optional_reason():
    decision = EventDecision.from_payload({"decision": "approve", "reason": "ignored"})

    assert decision.reason is None


# Rejection reasons are trimmed
def test_rejection_strips_reason_whitespace():
    decision = EventDecision.from_payload({"decision": "reject", "reason": "  Not suitable.  "})

    assert decision.reason == "Not suitable."


@pytest.mark.parametrize("reason", [None, "", " \t ", 7, [], {}])
# Missing, blank, or non-text rejection reasons are rejected
def test_rejection_requires_nonblank_text_reason(reason):
    with pytest.raises(ValueError, match="reason is required"):
        EventDecision.from_payload({"decision": "reject", "reason": reason})


@pytest.mark.parametrize("action", ["defer", "", None, 1, [], {}])
# Unsupported decisions and non-string values are rejected
def test_unknown_or_non_string_action_is_rejected(action):
    with pytest.raises(ValueError, match="Decision must be approve or reject"):
        EventDecision(action)


@pytest.mark.parametrize(
    "payload",
    [None, [], "approve", {"decision": "approve", "status": "Planning"}],
)


# Non-object payloads and extra fields are rejected
def test_invalid_payload_shape_is_rejected(payload):
    with pytest.raises(ValueError, match="Send a decision"):
        EventDecision.from_payload(payload)


# Decision field is required
def test_payload_without_decision_is_rejected():
    with pytest.raises(ValueError, match="Decision must be approve or reject"):
        EventDecision.from_payload({})



# --------------- Integration Tests for EventDecision Class ---------------

# Approval records the actor/time, moves the request to Planning, and notifies the organiser
def test_coordinator_can_approve_submitted_request(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "approve"},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Planning"
    assert response.json["event"]["decision_by"] == 2
    assert response.json["event"]["decision_at"]
    notification = event_database[1].notifications[0]
    assert notification["recipient_id"] == 1
    assert notification["event_id"] == event["id"]
    assert notification["notification_type"] == "event_approved"
    assert "accepted" in notification["message"]


# Rejection without a reason fails and leaves the request unchanged
def test_reject_without_reason_is_blocked(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "reject"},
        headers=ORIGIN,
    )

    assert response.status_code == 400
    assert event_database[0][0]["status"] == "Submitted"


# Rejection stores its reason and sends a notification
def test_rejection_stores_reason_and_notifies_organiser(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "reject", "reason": "The venue is unavailable."},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Rejected"
    assert response.json["event"]["decision_reason"] == "The venue is unavailable."
    assert event_database[1].notifications[0]["recipient_id"] == 1


# Organisers can see their rejection notification and reason, but not another user’s notification
def test_organiser_can_read_rejection_notification_and_reason(
    organiser, coordinator, event_database
):
    event = _seed_planning_event(event_database, status="Submitted")
    assert coordinator.post(f"/events/{event['id']}/decision", json={
        "decision": "reject", "reason": "The venue is unavailable.",
    }, headers=ORIGIN).status_code == 200
    event_database[1].notifications.append({
        "id": 99, "recipient_id": 6, "message": "Another organiser's private message",
    })

    # A query-string recipient cannot replace the identity in the signed session.
    response = organiser.get("/notifications?recipient_id=6", headers=ORIGIN)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert len(response.json["notifications"]) == 1
    notification = response.json["notifications"][0]
    assert notification["event_id"] == event["id"]
    assert notification["message"] == "Your event request was rejected: The venue is unavailable."
    assert notification["created_at"]
    fetched = organiser.get(f"/events/{event['id']}", headers=ORIGIN).json["event"]
    assert fetched["status"] == "Rejected"
    assert fetched["decision_reason"] == "The venue is unavailable."


# Notifications require a signed-in user.
def test_notifications_require_selected_user(app):
    response = app.test_client().get("/notifications", headers=ORIGIN)
    assert response.status_code == 401
    assert "notifications" not in response.json


# Only Organisers may read decision notifications.
@pytest.mark.parametrize("user_id", [2, 3, 4, 5])
def test_notifications_are_only_available_to_organisers(app, user_id, monkeypatch):
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    client = app.test_client()
    select_user(client, user_id)
    response = client.get("/notifications", headers=ORIGIN)
    assert response.status_code == 403
    assert "notifications" not in response.json


# Notification reads reject missing and untrusted origins.
@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example"}])
def test_notifications_reject_untrusted_origin(organiser, headers):
    response = organiser.get("/notifications", headers=headers)
    assert response.status_code == 403
    assert "notifications" not in response.json


# An Organiser with no decisions sees the notification empty state.
def test_notifications_empty_state(organiser):
    response = organiser.get("/notifications", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json == {"notifications": []}


# Database errors return a safe response without leaking internal details.
def test_notifications_database_failure_is_safe(organiser, event_database):
    event_database[1].table.side_effect = RuntimeError("private database connection details")
    response = organiser.get("/notifications", headers=ORIGIN)
    assert response.status_code == 503
    assert response.json == {"error": "Could not load notifications. Please try again."}


# A decided request cannot be approved or rejected again
def test_decided_request_cannot_be_decided_again(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Rejected")

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "approve"},
        headers=ORIGIN,
    )

    assert response.status_code == 409


# An organiser cannot use the coordinator decision endpoint
def test_non_coordinator_cannot_decide_request(organiser, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = organiser.post(
        f"/events/{event['id']}/decision",
        json={"decision": "approve"},
        headers=ORIGIN,
    )

    assert response.status_code == 403
    assert event_database[0][0]["status"] == "Submitted"


# A request without a selected user is unauthorised
def test_decision_requires_a_session(app, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = app.test_client().post(
        f"/events/{event['id']}/decision",
        json={"decision": "approve"},
        headers=ORIGIN,
    )

    assert response.status_code == 401


# Coordinators retain Submitted in the review queue until they decide the request.
def test_coordinator_queue_keeps_submitted_internal_status(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.get("/events", headers=ORIGIN)

    assert response.status_code == 200
    queued_event = next(row for row in response.json["events"] if row["id"] == event["id"])
    assert queued_event["status"] == "Submitted"


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example"}])
# Missing or untrusted origins are forbidden
def test_decision_rejects_untrusted_origin(coordinator, event_database, headers):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "approve"},
        headers=headers,
    )

    assert response.status_code == 403
    assert event_database[0][0]["status"] == "Submitted"


# An unknown event ID returns 404
def test_decision_returns_not_found_for_unknown_event(coordinator):
    response = coordinator.post(
        "/events/00000000-0000-0000-0000-000000000000/decision",
        json={"decision": "approve"},
        headers=ORIGIN,
    )

    assert response.status_code == 404


# A coordinator not assigned to the event cannot decide it
def test_coordinator_cannot_decide_another_coordinators_event(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted", coordinator_id=3)

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "approve"},
        headers=ORIGIN,
    )

    assert response.status_code == 403
    assert event_database[0][0]["status"] == "Submitted"


@pytest.mark.parametrize("status", ["Draft", "Planning", "Confirmed", "Rejected", "Cancelled"])
# Draft and terminal/non-submitted states cannot be decided
def test_only_submitted_requests_can_be_decided(coordinator, event_database, status):
    event = _seed_planning_event(event_database, status=status)

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "approve"},
        headers=ORIGIN,
    )

    assert response.status_code == 409
    assert event_database[0][0]["status"] == status


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {"decision": "defer"},
        {"decision": "reject", "reason": "  "},
        {"decision": "approve", "unexpected": True},
    ],
)


# Malformed payloads fail without changing the event
def test_decision_endpoint_returns_bad_request_for_invalid_payload(
    coordinator, event_database, payload
):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json=payload,
        headers=ORIGIN,
    )

    assert response.status_code == 400
    assert event_database[0][0]["status"] == "Submitted"

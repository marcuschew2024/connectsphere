"""Unit tests for EventCancellation (SCRUM-69).

Pure domain-logic tests - no database, no Flask. They encode who is an authorised
user (Decision Log D34), which states can be cancelled, and the reason rules.
Endpoint wiring is covered in test_event_cancellation_route.py and the real
database behaviour in test_event_cancellation_acceptance.py.
"""

import pytest

from app.event_cancellation import MAX_REASON_LENGTH, EventCancellation

EVENT = {"id": "event-69", "status": "Confirmed", "organiser_id": 1, "coordinator_id": 2}


# --- Reason validation ---

def test_reason_is_trimmed():
    assert EventCancellation.from_payload({"reason": "  Venue flooded.  "}).reason == (
        "Venue flooded."
    )


def test_reason_at_the_length_limit_is_accepted():
    reason = "x" * MAX_REASON_LENGTH
    assert EventCancellation.from_payload({"reason": reason}).reason == reason


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (None, "only reason"),
        (["reason"], "only reason"),
        ({}, "only reason"),
        ({"reason": "ok", "status": "Cancelled"}, "only reason"),
        ({"reason": ""}, "Give a reason"),
        ({"reason": "   "}, "Give a reason"),
        ({"reason": 42}, "Give a reason"),
        ({"reason": "x" * (MAX_REASON_LENGTH + 1)}, "at most 2000"),
    ],
)
def test_invalid_payloads_are_rejected(payload, message):
    with pytest.raises(ValueError, match=message):
        EventCancellation.from_payload(payload)


# --- AC1: who is an authorised user ---

def test_assigned_coordinator_may_cancel():
    assert EventCancellation.actor_may_cancel({"id": 2, "role": "Coordinator"}, EVENT)


def test_event_coordinator_lead_may_cancel_any_event():
    lead = {"id": 8, "role": "Event Coordinator Lead"}
    assert EventCancellation.actor_may_cancel(lead, EVENT)
    assert EventCancellation.actor_may_cancel(lead, {**EVENT, "coordinator_id": None})


def test_a_different_coordinator_may_not_cancel():
    assert not EventCancellation.actor_may_cancel({"id": 7, "role": "Coordinator"}, EVENT)


def test_a_coordinator_cannot_cancel_an_unassigned_event():
    unassigned = {**EVENT, "coordinator_id": None}
    assert not EventCancellation.actor_may_cancel({"id": None, "role": "Coordinator"}, unassigned)
    assert not EventCancellation.actor_may_cancel({"id": 2, "role": "Coordinator"}, unassigned)


@pytest.mark.parametrize(
    "role", ["Organiser", "Venue Staff", "Tech Support", "Attendee", "Safety Officer", None],
)
def test_other_roles_may_not_cancel(role):
    assert not EventCancellation.actor_may_cancel({"id": 2, "role": role}, EVENT)


@pytest.mark.parametrize(("actor", "event"), [(None, EVENT), ({"id": 2}, None), ("x", "y")])
def test_malformed_inputs_are_not_authorised(actor, event):
    assert not EventCancellation.actor_may_cancel(actor, event)


# --- Which states can be cancelled ---

@pytest.mark.parametrize(
    "status",
    ["Submitted", "Assigned", "Under review", "Under Review", "Approved",
     "Planning", "Confirmed", "Preparation", " Planning "],
)
def test_active_events_can_be_cancelled(status):
    assert EventCancellation.blocking_reason(status) is None


def test_already_cancelled_event_explains_itself():
    assert EventCancellation.blocking_reason("Cancelled") == "This event is already cancelled."


@pytest.mark.parametrize("status", ["Completed", "Rejected"])
def test_closed_events_cannot_be_cancelled(status):
    assert EventCancellation.blocking_reason(status) == (
        f"A {status.lower()} event is closed and cannot be cancelled."
    )


@pytest.mark.parametrize("status", ["Draft", "", None, "Unknown"])
def test_drafts_and_unknown_states_cannot_be_cancelled(status):
    assert EventCancellation.blocking_reason(status) == (
        "Only a submitted or active event can be cancelled."
    )

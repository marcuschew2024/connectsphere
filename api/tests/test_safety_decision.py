"""Unit tests for SafetyDecision (SCRUM-128).

Pure domain-logic tests - no database, no Flask. They encode the acceptance criteria
that live in the decision object: a valid Safety Officer action (approve / request_changes
/ reject), the event status each produces, and the reason required when the event is sent
back. Endpoint-level ACs (Safety Officer role, Confirmed-only precondition, actor/timestamp
audit, preparation gate) are covered by the route suite.

Each test traces to an acceptance criterion and is written to fail for a plausible wrong
implementation (Week 6 five-question review).
"""

import pytest

from app.safety_decision import SafetyDecision

# --- approve -> the event may proceed to Preparation ---

def test_approve_maps_to_preparation_and_drops_reason():
    decision = SafetyDecision("approve", reason="ignored")
    assert decision.status == "Preparation"
    assert decision.approved is True
    assert decision.reason is None


# --- request_changes -> back to Planning with a reason (AC: returns to earlier stage) ---

def test_request_changes_maps_to_planning_and_trims_reason():
    decision = SafetyDecision("request_changes", reason="  add emergency exits  ")
    assert decision.status == "Planning"
    assert decision.approved is False
    assert decision.reason == "add emergency exits"


# --- reject -> back to Planning with a safety-reject reason (PO decision) ---

def test_reject_maps_to_planning_and_trims_reason():
    decision = SafetyDecision("reject", reason="  crowd flow unsafe  ")
    assert decision.status == "Planning"
    assert decision.approved is False
    assert decision.reason == "crowd flow unsafe"


# --- reason is required when the event is sent back ---

@pytest.mark.parametrize("action", ["request_changes", "reject"])
@pytest.mark.parametrize("reason", [None, "", "   ", 7, [], {}])
def test_send_back_requires_a_nonblank_text_reason(action, reason):
    with pytest.raises(ValueError):
        SafetyDecision(action, reason=reason)


# --- an unknown action is rejected ---

@pytest.mark.parametrize("action", ["maybe", "", None, 1, "Approve"])
def test_unknown_action_is_rejected(action):
    with pytest.raises(ValueError):
        SafetyDecision(action, reason="whatever")


# --- from_payload maps client JSON ---

def test_from_payload_builds_approval():
    decision = SafetyDecision.from_payload({"decision": "approve"})
    assert decision.status == "Preparation"
    assert decision.approved is True


def test_from_payload_builds_rejection_with_reason():
    decision = SafetyDecision.from_payload({"decision": "reject", "reason": "no fire exits"})
    assert decision.status == "Planning"
    assert decision.reason == "no fire exits"


def test_from_payload_rejects_unknown_keys():
    with pytest.raises(ValueError):
        SafetyDecision.from_payload({"decision": "approve", "force": True})


def test_from_payload_rejects_non_dict():
    with pytest.raises(ValueError):
        SafetyDecision.from_payload("approve")

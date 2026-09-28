"""Unit tests for BookingDecision (SCRUM-32 / SCRUM-123).

Pure domain-logic tests — no database, no Flask. These encode the acceptance
criteria that live entirely in the decision object (valid action, reason
required on reject, optional alternative). The DB/endpoint-level ACs (audit,
notification, conflict block, slot boundaries) are covered by the acceptance
suite once venue_bookings (SCRUM-31) lands.
"""

import pytest

from app.booking_decision import BookingDecision


def test_approve_maps_to_confirmed_and_drops_reason():
    decision = BookingDecision("approve", reason="ignored")
    assert decision.status == "Confirmed"
    assert decision.is_rejection is False
    assert decision.reason is None


def test_reject_with_reason_maps_to_rejected_and_trims_reason():
    decision = BookingDecision("reject", reason="  double-booked  ")
    assert decision.status == "Rejected"
    assert decision.is_rejection is True
    assert decision.reason == "double-booked"


def test_reject_without_reason_is_rejected():
    with pytest.raises(ValueError):
        BookingDecision("reject")


def test_reject_with_blank_reason_is_rejected():
    with pytest.raises(ValueError):
        BookingDecision("reject", reason="   ")


def test_unknown_action_is_rejected():
    with pytest.raises(ValueError):
        BookingDecision("maybe", reason="whatever")


def test_optional_alternative_is_captured_and_trimmed():
    decision = BookingDecision("reject", reason="clash", alternative="  Room B 4-6pm  ")
    assert decision.alternative == "Room B 4-6pm"


def test_blank_alternative_collapses_to_none():
    decision = BookingDecision("approve", alternative="   ")
    assert decision.alternative is None


def test_non_text_alternative_is_rejected():
    with pytest.raises(ValueError):
        BookingDecision("approve", alternative={"venue": 1})


def test_from_payload_builds_valid_decision():
    decision = BookingDecision.from_payload(
        {"decision": "reject", "reason": "clash", "alternative": "Room B"}
    )
    assert decision.status == "Rejected"
    assert decision.alternative == "Room B"


def test_from_payload_rejects_unknown_keys():
    with pytest.raises(ValueError):
        BookingDecision.from_payload({"decision": "approve", "confirm": True})


def test_from_payload_rejects_non_dict():
    with pytest.raises(ValueError):
        BookingDecision.from_payload("approve")

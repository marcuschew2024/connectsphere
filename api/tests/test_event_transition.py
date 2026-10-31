"""Acceptance intent: explicit forward steps, no role shortcuts or hidden gates."""

import pytest

from app.event_transition import EventTransition, TransitionRefused


@pytest.mark.parametrize(
    "source,target",
    [
        ("Submitted", "Assigned"),
        ("Submitted", "Under review"),
        ("Submitted", "Planning"),
        ("Assigned", "Under review"),
        ("Assigned", "Planning"),
        ("Under review", "Planning"),
        ("Under Review", "Planning"),
        ("Approved", "Planning"),
    ],
)
def test_assigned_coordinator_can_advance_intake(source, target):
    EventTransition(target).validate(source)


@pytest.mark.parametrize(
    "source",
    [
        "Draft",
        "Planning",
        "Confirmed",
        "Preparation",
        "Rejected",
        "Cancelled",
        "Completed",
        "unknown",
        None,
    ],
)
@pytest.mark.parametrize(
    "target", ["Submitted", "Assigned", "Under review", "Approved", "Planning", "Rejected"]
)
def test_generic_route_cannot_reopen_or_rewind_lifecycle(source, target):
    with pytest.raises(TransitionRefused):
        EventTransition(target).validate(source)


@pytest.mark.parametrize(
    "target", ["Confirmed", "Preparation", "Completed", "Cancelled", "Rejected"]
)
def test_dedicated_steps_cannot_be_skipped(target):
    with pytest.raises(TransitionRefused):
        EventTransition(target).validate("Submitted")


@pytest.mark.parametrize("source", ["Submitted", "Assigned", "Under review", "Approved"])
def test_rejection_is_available_through_the_reasoned_decision(source):
    EventTransition("Rejected").validate(source, decision=True)


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {},
        {"status": []},
        {"status": {}},
        {"status": None},
        {"status": "unknown"},
        {"status": "Planning", "actor_id": 2},
    ],
)
def test_invalid_status_payloads_fail_cleanly(payload):
    with pytest.raises(ValueError):
        EventTransition.from_payload(payload)


@pytest.mark.parametrize(
    "role",
    [
        "Organiser",
        "Venue Staff",
        "Tech Support",
        "Attendee",
        "Event Coordinator Lead",
        "Safety Officer",
        None,
    ],
)
def test_relationship_or_assignment_alone_is_not_mutation_authority(role):
    assert not EventTransition.actor_allowed({"role": role, "id": 2}, {"coordinator_id": 2})


def test_only_current_coordinator_has_intake_authority():
    assert EventTransition.actor_allowed({"role": "Coordinator", "id": 2}, {"coordinator_id": 2})
    assert not EventTransition.actor_allowed(
        {"role": "Coordinator", "id": 2}, {"coordinator_id": 3}
    )
    assert not EventTransition.actor_allowed({"role": "Coordinator"}, {"coordinator_id": None})

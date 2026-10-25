"""Unit tests for EventCompletion (SCRUM-132).

Pure domain-logic tests - no database, no Flask. They encode the completion gate
from the story's acceptance criteria: only a delivered (Preparation) event may be
completed, and incomplete arrangements block it with a clear message. Endpoint
wiring is covered in test_event_completion_route.py and the real database
behaviour in test_event_completion_acceptance.py.
"""

import pytest

from app.event_completion import EventCompletion

# --- AC1 happy path: a delivered event with settled arrangements can be completed ---

def test_preparation_event_with_settled_arrangements_can_complete():
    gate = EventCompletion(
        "Preparation",
        ["Confirmed", "Rejected", "Cancelled"],
        ["Reserved", "Partially fulfilled", "Unavailable"],
    )
    assert gate.can_complete is True
    assert gate.outstanding == []


def test_preparation_event_without_arrangements_can_complete():
    assert EventCompletion("Preparation").can_complete is True


# --- AC6 wrong state: only Preparation is eligible ---

@pytest.mark.parametrize(
    "status",
    ["Draft", "Submitted", "Planning", "Confirmed", "Rejected", "Cancelled", "", None],
)
def test_events_outside_preparation_cannot_complete(status):
    gate = EventCompletion(status)
    assert gate.can_complete is False
    assert gate.outstanding == ["Only an event in Preparation can be completed."]


def test_already_completed_event_explains_itself():
    gate = EventCompletion("Completed")
    assert gate.can_complete is False
    assert gate.outstanding == ["This event is already completed."]


def test_wrong_state_is_reported_before_arrangements():
    gate = EventCompletion("Confirmed", ["Requested"], ["Requested"])
    assert gate.outstanding == ["Only an event in Preparation can be completed."]


# --- AC6 incomplete arrangements block completion with counts ---

@pytest.mark.parametrize("booking_status", ["Requested", "Pending", " Requested "])
def test_pending_venue_booking_blocks_completion(booking_status):
    gate = EventCompletion("Preparation", ["Confirmed", booking_status])
    assert gate.can_complete is False
    assert gate.outstanding == ["1 venue booking(s) still awaiting approval."]


def test_unactioned_equipment_request_blocks_completion():
    gate = EventCompletion("Preparation", ["Confirmed"], ["Requested", "Requested", "Reserved"])
    assert gate.can_complete is False
    assert gate.outstanding == ["2 equipment request(s) still awaiting Tech Support."]


def test_all_outstanding_reasons_are_listed():
    gate = EventCompletion("Preparation", ["Requested"], ["Requested"])
    assert gate.outstanding == [
        "1 venue booking(s) still awaiting approval.",
        "1 equipment request(s) still awaiting Tech Support.",
    ]


def test_unknown_or_blank_statuses_do_not_count_as_pending():
    gate = EventCompletion("Preparation", ["", None, 7], [None, "Blocked"])
    assert gate.can_complete is True


# --- Building the gate from repository rows ---

def test_from_records_reads_status_fields():
    gate = EventCompletion.from_records(
        {"status": "Preparation"},
        [{"status": "Confirmed"}, {"status": "Requested"}, "not a row"],
        [{"status": "Reserved"}],
    )
    assert gate.outstanding == ["1 venue booking(s) still awaiting approval."]


@pytest.mark.parametrize(
    ("bookings", "requests"), [(None, []), ([], None), ("rows", [])],
)
def test_from_records_rejects_non_list_inputs(bookings, requests):
    with pytest.raises(ValueError):
        EventCompletion.from_records({"status": "Preparation"}, bookings, requests)


def test_from_records_handles_a_missing_event():
    assert EventCompletion.from_records(None, [], []).can_complete is False

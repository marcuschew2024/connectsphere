"""Unit tests for SCRUM-138 proposed change values (Decision Log D36).

Pure rules only. The endpoints are covered in test_change_request_apply_route.py and
the transactional approve_change_request() function in
test_change_request_apply_acceptance.py.
"""

import pytest

from app.change_request_proposal import (
    CHANGEABLE_FIELDS,
    SIGNIFICANT_FIELDS,
    ChangeRequestProposal,
)

EVENT = {
    "id": "event-138", "title": "Campus workshop", "description": "Learn together",
    "purpose": "Share skills", "category": "Workshop", "expected_attendance": 50,
    "venue_requirements": "Seminar room", "accessibility_requirements": None,
    "equipment_requirements": None, "registration_requirements": None,
    "event_datetime": "2099-10-20T06:00:00Z", "status": "Confirmed",
}


def test_proposed_values_are_trimmed_and_kept():
    proposal = ChangeRequestProposal.from_payload(
        {"title": "  Campus workshop II  ", "expected_attendance": 120}, EVENT,
    )
    assert proposal.changes == {"title": "Campus workshop II", "expected_attendance": 120}


def test_an_optional_detail_can_be_cleared():
    event = {**EVENT, "equipment_requirements": "Two microphones"}
    proposal = ChangeRequestProposal.from_payload({"equipment_requirements": "  "}, event)
    assert proposal.changes == {"equipment_requirements": None}


@pytest.mark.parametrize("changes", [None, {}, [], "title", 5])
def test_changes_must_list_at_least_one_value(changes):
    with pytest.raises(ValueError, match="at least one proposed change"):
        ChangeRequestProposal.from_payload(changes, EVENT)


# SCRUM-48 made date/time requestable; status, ownership and audit fields are never requestable.
@pytest.mark.parametrize("field", [
    "status", "organiser_id", "coordinator_id", "registration_capacity",
    "updated_at",
])
def test_only_changeable_event_details_can_be_proposed(field):
    with pytest.raises(ValueError, match=field):
        ChangeRequestProposal.from_payload({field: "x"}, EVENT)


@pytest.mark.parametrize(("changes", "field", "message"), [
    ({"title": "   "}, "title", "required"),
    ({"category": ""}, "category", "required"),
    ({"title": "x" * 201}, "title", "200 characters"),
    ({"expected_attendance": 0}, "expected_attendance", "between 1 and 10,000"),
    ({"expected_attendance": 10_001}, "expected_attendance", "between 1 and 10,000"),
    ({"expected_attendance": True}, "expected_attendance", "between 1 and 10,000"),
    ({"expected_attendance": "60"}, "expected_attendance", "between 1 and 10,000"),
    ({"venue_requirements": 7}, "venue_requirements", "Enter text"),
    ({"title": "Campus workshop"}, "title", "already the current value"),
    ({"expected_attendance": 50}, "expected_attendance", "already the current value"),
])
def test_invalid_or_unchanged_values_are_reported_by_field(changes, field, message):
    with pytest.raises(ValueError) as raised:
        ChangeRequestProposal.from_payload(changes, EVENT)
    problems = raised.value.args[0]
    assert set(problems) == {field}
    assert message in problems[field]


def test_problems_in_details_not_being_changed_are_ignored():
    """A legacy event missing a required detail can still have another detail changed."""
    proposal = ChangeRequestProposal.from_payload(
        {"expected_attendance": 80}, {**EVENT, "purpose": None},
    )
    assert proposal.changes == {"expected_attendance": 80}


@pytest.mark.parametrize(("changes", "significant"), [
    ({"expected_attendance": 80}, True),
    ({"venue_requirements": "Lecture theatre"}, True),
    ({"event_datetime": "2099-12-20T06:00:00Z"}, True),  # SCRUM-48: a reschedule is significant
    ({"title": "New title", "expected_attendance": 80}, True),
    ({"title": "New title"}, False),
    ({"equipment_requirements": "Projector", "category": "Talk"}, False),
])
def test_pax_venue_and_datetime_are_the_significant_changes(changes, significant):
    assert ChangeRequestProposal.from_payload(changes, EVENT).is_significant() is significant


def test_a_new_date_time_can_be_proposed_as_a_reschedule():
    # SCRUM-48: date/time is a requestable field, and changing it is significant.
    proposal = ChangeRequestProposal.from_payload({"event_datetime": "2099-12-20T06:00:00Z"}, EVENT)
    assert "event_datetime" in proposal.changes
    assert proposal.is_significant() is True


def test_field_lists_match_the_database_contract():
    assert CHANGEABLE_FIELDS == {
        "title", "description", "purpose", "category", "expected_attendance",
        "venue_requirements", "facility_requirements", "accessibility_requirements",
        "equipment_requirements", "registration_requirements", "event_datetime",
    }
    assert SIGNIFICANT_FIELDS == {
        "expected_attendance",
        "venue_requirements",
        "facility_requirements",
        "event_datetime",
    }

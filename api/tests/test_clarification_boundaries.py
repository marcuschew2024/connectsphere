"""SCRUM-22 clarification refusals and input boundaries (release v1 audit).

The clarification workflow itself is covered in test_events.py. These tests pin each
refusal: wrong origin, wrong role or event, wrong state, a second pending
clarification, invalid notes and invalid resubmissions, so none of them can silently
start succeeding.
"""

import pytest

from .conftest import ORIGIN
from .test_events import _edit_payload, _seed_planning_event

pytest_plugins = ("tests.test_events",)

MISSING = "00000000-0000-4000-8000-000000000000"
UNTRUSTED = {"Origin": "https://attacker.example"}


def _pending(event_database, event):
    event_database[1].clarifications.append({
        "id": 1, "event_id": event["id"], "note": "Please clarify.", "status": "Pending",
    })


# --- Requesting a clarification (AC1, AC3) ---

def test_requesting_needs_the_trusted_origin(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    response = coordinator.post(f"/events/{event['id']}/clarification",
                                json={"note": "Why?"}, headers=UNTRUSTED)
    assert response.status_code == 403
    assert event_database[1].clarifications == []


def test_only_coordinators_request_clarification(organiser, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    response = organiser.post(f"/events/{event['id']}/clarification",
                              json={"note": "Why?"}, headers=ORIGIN)
    assert response.status_code == 403
    assert event_database[1].clarifications == []


def test_an_unknown_event_cannot_be_returned(coordinator):
    assert coordinator.post(f"/events/{MISSING}/clarification", json={"note": "Why?"},
                            headers=ORIGIN).status_code == 404


@pytest.mark.parametrize("status", ["Planning", "Confirmed", "Rejected", "Completed"])
def test_only_a_submitted_request_can_be_returned(coordinator, event_database, status):
    event = _seed_planning_event(event_database, status=status)
    response = coordinator.post(f"/events/{event['id']}/clarification",
                                json={"note": "Why?"}, headers=ORIGIN)
    assert response.status_code == 409
    assert "submitted request" in response.json["error"]
    assert event_database[1].clarifications == []


def test_a_second_pending_clarification_is_refused(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    _pending(event_database, event)
    response = coordinator.post(f"/events/{event['id']}/clarification",
                                json={"note": "And another?"}, headers=ORIGIN)
    assert response.status_code == 409
    assert "already has a pending clarification" in response.json["error"]
    assert len(event_database[1].clarifications) == 1


@pytest.mark.parametrize("body", [
    {"note": "x" * 2001}, {"note": 5}, {"note": None}, {}, ["note"], "note",
])
def test_an_invalid_note_is_refused(coordinator, event_database, body):
    event = _seed_planning_event(event_database, status="Submitted")
    response = coordinator.post(f"/events/{event['id']}/clarification", json=body,
                                headers=ORIGIN)
    assert response.status_code == 400
    assert "1 to 2000 characters" in response.json["error"]
    assert event_database[1].clarifications == []


def test_a_note_of_exactly_2000_characters_is_accepted(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    response = coordinator.post(f"/events/{event['id']}/clarification",
                                json={"note": "  " + "n" * 2000 + "  "}, headers=ORIGIN)
    assert response.status_code == 201
    assert response.json["clarification"]["note"] == "n" * 2000


# --- Reading it (AC2) ---

def test_reading_needs_the_trusted_origin_and_a_known_event(organiser, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    assert organiser.get(f"/events/{event['id']}/clarification",
                         headers=UNTRUSTED).status_code == 403
    assert organiser.get(f"/events/{MISSING}/clarification", headers=ORIGIN).status_code == 404


# --- Resubmitting (AC2, AC3) ---

def test_resubmitting_needs_the_trusted_origin(organiser, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    _pending(event_database, event)
    response = organiser.post(f"/events/{event['id']}/resubmit", json=_edit_payload(event),
                              headers=UNTRUSTED)
    assert response.status_code == 403
    assert event_database[1].clarifications[0]["status"] == "Pending"


def test_an_unknown_event_cannot_be_resubmitted(organiser):
    assert organiser.post(f"/events/{MISSING}/resubmit", json={},
                          headers=ORIGIN).status_code == 404


def test_only_the_owning_organiser_can_resubmit(organiser, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    event["organiser_id"] = 7
    _pending(event_database, event)
    response = organiser.post(f"/events/{event['id']}/resubmit", json=_edit_payload(event),
                              headers=ORIGIN)
    assert response.status_code == 403
    assert event_database[1].clarifications[0]["status"] == "Pending"


def test_resubmitting_without_a_pending_clarification_is_refused(organiser, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    response = organiser.post(f"/events/{event['id']}/resubmit", json=_edit_payload(event),
                              headers=ORIGIN)
    assert response.status_code == 409
    assert "does not have a pending clarification" in response.json["error"]


@pytest.mark.parametrize(("body", "message"), [
    (["title"], "JSON object"),
    ("title", "JSON object"),
    ({"status": "Approved"}, "unsupported fields"),
    ({"organiser_id": 2}, "unsupported fields"),
])
def test_a_malformed_resubmission_is_refused(organiser, event_database, body, message):
    event = _seed_planning_event(event_database, status="Submitted")
    _pending(event_database, event)
    response = organiser.post(f"/events/{event['id']}/resubmit", json=body, headers=ORIGIN)
    assert response.status_code == 400
    assert message in response.json["error"]
    assert event_database[1].clarifications[0]["status"] == "Pending"


@pytest.mark.parametrize(("override", "field"), [
    ({"title": ""}, "title"), ({"expected_attendance": 0}, "expected_attendance"),
    ({"event_datetime": "2001-01-01T00:00:00Z"}, "event_datetime"),
])
def test_an_invalid_resubmission_is_explained_by_field(organiser, event_database, override, field):
    event = _seed_planning_event(event_database, status="Submitted")
    _pending(event_database, event)
    response = organiser.post(f"/events/{event['id']}/resubmit",
                              json=_edit_payload(event, **override), headers=ORIGIN)
    assert response.status_code == 400
    assert field in response.json["fields"]
    assert event_database[1].clarifications[0]["status"] == "Pending"
    assert event["title"] == "Original title"

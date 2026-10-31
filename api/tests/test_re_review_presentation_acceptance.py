"""SCRUM-156 against real PostgreSQL and PostgREST: a significant change awaiting re-review
is recorded and announced as such, not as a plain approval (D36 status model unchanged)."""

import os

import pytest

from .conftest import ORIGIN
from .test_equipment_request_acceptance import live_requests  # noqa: F401
from .test_event_completion_acceptance import live  # noqa: F401
from .test_venue_too_small_acceptance import approve_attendance, booking, capacity_of

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


def actions(db, event):
    return [row["action"] for row in db.table("event_status_history").select("action").eq(
        "event_id", event["id"]).order("changed_at").execute().data if row["action"]]


def organiser_notice(db, event):
    [note] = db.table("notifications").select("message").eq("event_id", event["id"]).eq(
        "notification_type", "event_change_request_updated").eq("recipient_id", 1).execute().data
    return note["message"]


def test_significant_approval_is_recorded_and_announced_as_re_review(live):  # noqa: F811
    db, users, _, make_event, venue = live
    capacity = capacity_of(db, venue)
    event = make_event()
    booking(db, event, venue)

    result = approve_attendance(users, event, capacity + 20)

    assert result["change_request"]["status"] == "Approved"  # D36: stored status unchanged.
    assert "change_request_approved_re_review" in actions(db, event)
    assert "change_request_approved" not in actions(db, event)
    message = organiser_notice(db, event)
    assert "Coordinator is re-reviewing the venue and equipment arrangements" in message
    assert (f"The booked venue is too small for {capacity + 20} attendees: "
            f"{venue['name']} (capacity {capacity}).") in message


def test_ordinary_approval_stays_a_plain_approval(live):  # noqa: F811
    db, users, _, make_event, _ = live
    event = make_event()
    request = users[1].post(f"/events/{event['id']}/change-requests", json={
        "description": "New name", "changes": {"title": "Renamed workshop"},
    }, headers=ORIGIN).json["change_request"]
    users[2].patch(f"/events/{event['id']}/change-requests/{request['id']}",
                   json={"status": "Approved"}, headers=ORIGIN)

    assert "change_request_approved" in actions(db, event)
    assert "change_request_approved_re_review" not in actions(db, event)
    assert organiser_notice(db, event).endswith("was approved and applied.")


def test_significant_venue_change_reads_as_re_review_without_a_capacity_flag(live):  # noqa: F811
    db, users, _, make_event, venue = live
    event = make_event()
    booking(db, event, venue)
    request = users[1].post(f"/events/{event['id']}/change-requests", json={
        "description": "Need a lecture theatre",
        "changes": {"venue_requirements": "Lecture theatre"},
    }, headers=ORIGIN).json["change_request"]

    response = users[2].patch(f"/events/{event['id']}/change-requests/{request['id']}",
                              json={"status": "Approved"}, headers=ORIGIN)

    assert response.status_code == 200, response.json
    assert "change_request_approved_re_review" in actions(db, event)
    message = organiser_notice(db, event)
    assert "Coordinator is re-reviewing" in message
    assert "too small" not in message  # Attendance did not change, so no capacity flag.


def test_marking_a_re_review_implemented_keeps_the_re_review_record(live):  # noqa: F811
    db, users, _, make_event, venue = live
    capacity = capacity_of(db, venue)
    event = make_event()
    booking(db, event, venue)
    result = approve_attendance(users, event, capacity + 5)

    done = users[2].patch(
        f"/events/{event['id']}/change-requests/{result['change_request']['id']}",
        json={"status": "Implemented"}, headers=ORIGIN)

    assert done.status_code == 200, done.json
    assert done.json["change_request"]["status"] == "Implemented"
    history = actions(db, event)
    assert history.index("change_request_approved_re_review") < history.index(
        "change_request_implemented")

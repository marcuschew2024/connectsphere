"""SCRUM-46 change requests against real PostgreSQL and PostgREST.

Start compose.acceptance.yml and run supabase/tests/run.sh first. These tests use
only disposable local records, never hosted data.
"""

import os

import pytest
from postgrest.exceptions import APIError

from . import test_request_acceptance as request_acceptance
from .conftest import ORIGIN

live = request_acceptance.live

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


def submitted_event(users):
    draft = request_acceptance.new_draft(users, request_acceptance.details())
    event = request_acceptance.submit(users, draft).json["event"]
    assert event["coordinator_id"] == 2
    return event


def raise_change(users, event, description="Move the start time to 10am"):
    response = users[1].post(
        f"/events/{event['id']}/change-requests",
        json={"description": description},
        headers=ORIGIN,
    )
    assert response.status_code == 201, response.json
    return response.json["change_request"]


def review(users, event, saved, status):
    return users[2].patch(
        f"/events/{event['id']}/change-requests/{saved['id']}",
        json={"status": status},
        headers=ORIGIN,
    )


def test_change_request_is_recorded_without_changing_the_event(live):
    _, database, users = live
    event = submitted_event(users)
    before = database.table("events").select("*").eq("id", event["id"]).execute().data[0]

    saved = raise_change(users, event, "  Move the start time to 10am  ")

    stored = database.table("event_change_requests").select("*").eq(
        "id", saved["id"]
    ).execute().data[0]
    assert stored["event_id"] == event["id"] and stored["requested_by"] == 1
    assert stored["description"] == "Move the start time to 10am"
    assert stored["status"] == "Pending" and stored["reviewed_by"] is None
    after = database.table("events").select("*").eq("id", event["id"]).execute().data[0]
    assert after == before


def test_both_parties_see_status_and_outsiders_are_denied(live):
    _, _, users = live
    event = submitted_event(users)
    saved = raise_change(users, event)
    path = f"/events/{event['id']}/change-requests"

    for user_id in (1, 2):
        response = users[user_id].get(path, headers=ORIGIN)
        assert response.status_code == 200
        assert [row["id"] for row in response.json["change_requests"]] == [saved["id"]]
    for user_id in (6, 7):
        assert users[user_id].get(path, headers=ORIGIN).status_code == 403
    other_organiser = users[6].post(
        path, json={"description": "Not my event"}, headers=ORIGIN
    )
    other_coordinator = users[7].patch(
        f"{path}/{saved['id']}", json={"status": "Approved"}, headers=ORIGIN
    )
    assert other_organiser.status_code == 403
    assert other_coordinator.status_code == 403


def test_review_lifecycle_is_audited_and_notifies_each_party(live):
    _, database, users = live
    event = submitted_event(users)
    saved = raise_change(users, event)

    for status in ("Under Review", "Approved", "Implemented"):
        response = review(users, event, saved, status)
        assert response.status_code == 200, response.json
        assert response.json["change_request"]["status"] == status
    assert review(users, event, saved, "Rejected").status_code == 409

    stored = database.table("event_change_requests").select("*").eq(
        "id", saved["id"]
    ).execute().data[0]
    assert stored["status"] == "Implemented"
    assert stored["reviewed_by"] == 2 and stored["reviewed_at"]
    history = users[1].get(f"/events/{event['id']}/history", headers=ORIGIN).json["history"]
    actions = [row["action"] for row in history if row.get("action")]
    assert actions == [
        "change_requested",
        "change_request_under_review",
        "change_request_approved",
        "change_request_implemented",
    ]
    notifications = database.table("notifications").select(
        "recipient_id,notification_type"
    ).eq("event_id", event["id"]).execute().data
    assert {"recipient_id": 2, "notification_type": "event_change_request"} in notifications
    updates = [
        row for row in notifications
        if row["notification_type"] == "event_change_request_updated"
    ]
    assert len(updates) == 3 and {row["recipient_id"] for row in updates} == {1}


def test_database_rejects_blank_descriptions_and_unknown_statuses(live):
    _, database, users = live
    event = submitted_event(users)
    base = {"event_id": event["id"], "requested_by": 1}

    with pytest.raises(APIError):
        database.table("event_change_requests").insert({**base, "description": "   "}).execute()
    with pytest.raises(APIError):
        database.table("event_change_requests").insert(
            {**base, "description": "Valid", "status": "Done"}
        ).execute()

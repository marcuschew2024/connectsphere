"""SCRUM-161: venue block lifecycle persisted in disposable PostgreSQL."""

import os
from uuid import uuid4

import pytest

from .conftest import ORIGIN
from .test_venue_acceptance import live_venues as block_database  # noqa: F401
from .test_venue_acceptance import unique_venue

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


def test_venue_block_lists_only_overlaps_notifies_and_preserves_unblock_audit(request, monkeypatch):
    db, users = request.getfixturevalue("block_database")
    monkeypatch.setattr("app.event_repository.get_supabase_client", lambda: db)
    venue = users[3].post("/venues", json=unique_venue(), headers=ORIGIN).json["venue"]
    vid, eid = venue["id"], str(uuid4())
    start, end = "2099-10-20T06:00:00Z", "2099-10-20T07:00:00Z"
    try:
        db.table("events").insert(
            {
                "id": eid,
                "title": "Block acceptance",
                "description": "Venue maintenance test",
                "purpose": "Testing",
                "category": "Workshop",
                "event_datetime": start,
                "submitted_at": "2026-10-01T00:00:00Z",
                "expected_attendance": 10,
                "status": "Planning",
                "organiser_id": 1,
                "coordinator_id": 2,
            }
        ).execute()
        booking = (
            db.table("venue_bookings")
            .insert(
                {
                    "event_id": eid,
                    "venue_id": vid,
                    "start_at": start,
                    "end_at": end,
                    "expected_attendance": 10,
                    "layout": "Classroom",
                    "requested_by": 2,
                }
            )
            .execute()
            .data[0]
        )
        response = users[3].post(
            f"/venues/{vid}/unavailability",
            json={
                "start_at": start,
                "end_at": end,
                "reason": "Maintenance",
                "note": "Repair",
            },
            headers=ORIGIN,
        )
        assert response.status_code == 201, response.json
        block = response.json["block"]
        assert response.json["affected_booking_ids"] == [booking["id"]]
        assert block["created_by"] == 3 and block["created_at"] and block["status"] == "Active"
        notices = db.table("notifications").select("*").eq("event_id", eid).execute().data
        assert len(notices) == 1
        assert (
            notices[0]["recipient_id"] == 2
            and notices[0]["notification_type"] == "venue_unavailable"
        )
        for params, expected in [
            ({}, [block["id"]]),
            ({"from": start, "to": end}, [block["id"]]),
            ({"from": end, "to": "2099-10-20T08:00:00Z"}, []),
        ]:
            listed = users[2].get(
                f"/venues/{vid}/unavailability", query_string=params, headers=ORIGIN
            )
            assert listed.status_code == 200
            assert [row["id"] for row in listed.json["blocks"]] == expected
        cleared = users[3].delete(f"/venues/{vid}/unavailability/{block['id']}", headers=ORIGIN)
        assert cleared.status_code == 200
        assert cleared.json["block"]["status"] == "Unblocked"
        stored = (
            db.table("venue_unavailability").select("*").eq("id", block["id"]).execute().data[0]
        )
        assert stored["unblocked_by"] == 3 and stored["unblocked_at"]
        assert users[2].get(f"/venues/{vid}/unavailability", headers=ORIGIN).json == {"blocks": []}
        assert (
            users[3]
            .delete(f"/venues/{vid}/unavailability/{block['id']}", headers=ORIGIN)
            .status_code
            == 409
        )
        assert db.table("notifications").select("id").eq("event_id", eid).execute().data == [
            {"id": notices[0]["id"]}
        ]
    finally:
        db.table("venue_unavailability").delete().eq("venue_id", vid).execute()
        db.table("events").delete().eq("id", eid).execute()

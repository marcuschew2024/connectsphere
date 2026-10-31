"""SCRUM-155 against real PostgreSQL and PostgREST: a pool notification names the exact
venue booking / equipment request it is about, and its recipient can open that record."""

import os

import pytest

from .conftest import ORIGIN
from .test_equipment_request_acceptance import live_requests  # noqa: F401
from .test_equipment_request_status_acceptance import create_request
from .test_event_completion_acceptance import live  # noqa: F401

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


def pool_notice(client, event, notification_type):
    feed = client.get("/notifications", headers=ORIGIN).json["notifications"]
    [notice] = [n for n in feed
                if n["event_id"] == event["id"] and n["notification_type"] == notification_type]
    return notice


def test_venue_staff_notice_opens_the_exact_booking_request(live, monkeypatch):  # noqa: F811
    db, users, _, make_event, venue = live
    monkeypatch.setattr("app.venue_repository.get_supabase_client", lambda: db)
    event = make_event()
    response = users[2].post("/venues/bookings", json={
        "event_id": event["id"], "venue_id": venue["id"],
        "start_at": "2099-10-20T02:00:00Z", "end_at": "2099-10-20T04:00:00Z",
        "expected_attendance": 20, "layout": "Classroom", "special_requirements": "",
    }, headers=ORIGIN)
    assert response.status_code == 201, response.json
    booking_id = response.json["booking"]["id"]

    notice = pool_notice(users[3], event, "venue_booking_requested")

    assert notice["subject_id"] == booking_id
    opened = users[3].get(f"/venues/bookings/{notice['subject_id']}", headers=ORIGIN)
    assert opened.status_code == 200 and opened.json["booking"]["id"] == booking_id


def test_tech_support_notice_opens_the_exact_equipment_request(live):  # noqa: F811
    _, users, items, make_event, _ = live
    event = make_event()
    saved = create_request(users, event, [items[0]])

    notice = pool_notice(users[4], event, "equipment_request_submitted")

    assert notice["subject_id"] == saved["id"]
    opened = users[4].get(f"/equipment/requests/{notice['subject_id']}", headers=ORIGIN)
    assert opened.status_code == 200 and opened.json["request"]["id"] == saved["id"]

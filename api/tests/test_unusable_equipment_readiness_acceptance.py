"""SCRUM-153 (SCRUM-63) against real PostgreSQL and PostgREST.

A reservation made while an item was Operational must stop counting as ready once
Tech Support marks the item Damaged or Under Maintenance, and count again once repaired.
"""

import os

import pytest

from .conftest import ORIGIN
from .test_equipment_request_acceptance import live_requests  # noqa: F401
from .test_equipment_request_reservations_acceptance import allocation, reserve
from .test_equipment_request_status_acceptance import create_request
from .test_event_completion_acceptance import live  # noqa: F401

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


def set_condition(users, equipment_id, status):
    current = users[4].get(f"/equipment/{equipment_id}", headers=ORIGIN).json["equipment"]
    body = {key: current[key] for key in
            ("equipment_type", "description", "total_quantity", "location", "revision")}
    response = users[4].put(f"/equipment/{equipment_id}",
                            json={**body, "operational_status": status}, headers=ORIGIN)
    assert response.status_code == 200, response.json


def approved_booking(db, event, venue):
    db.table("venue_bookings").insert({
        "venue_id": venue["id"], "event_id": event["id"], "requested_by": 2,
        "start_at": "2099-12-01T06:00:00Z", "end_at": "2099-12-01T07:00:00Z",
        "expected_attendance": 20, "layout": "Classroom", "status": "Confirmed",
    }).execute()


@pytest.mark.parametrize("condition", ["Damaged", "Under Maintenance"])
def test_reserved_stock_that_becomes_unusable_blocks_confirmation(live, condition):  # noqa: F811
    db, users, items, make_event, venue = live
    item = {**items[0], "quantity": 1}
    event = make_event()
    approved_booking(db, event, venue)
    saved = create_request(users, event, [item])
    reserved = reserve(users, saved, allocation(saved, [item], [1]))
    assert reserved.status_code == 200 and reserved.json["request"]["status"] == "Reserved"

    set_condition(users, item["equipment_id"], condition)
    try:
        detail = users[2].get(f"/equipment/requests/{saved['id']}", headers=ORIGIN).json["request"]
        assert detail["status"] == "Requested"
        assert detail["items"][0]["reserved_quantity"] == 0
        assert detail["items"][0]["unusable_reserved_quantity"] == 1
        refused = users[2].post(f"/events/{event['id']}/confirm", json={}, headers=ORIGIN)
        assert refused.status_code == 409
        assert "Technical arrangements" in refused.json["error"]
        stored = db.table("events").select("status").eq("id", event["id"]).execute().data[0]
        assert stored["status"] == "Planning"
        # Nothing was released automatically: the booking is still there to repair.
        holds = db.table("equipment_reservations").select("status").eq(
            "request_id", saved["id"]).execute().data
        assert [hold["status"] for hold in holds] == ["Reserved"]
    finally:
        set_condition(users, item["equipment_id"], "Operational")

    # Repaired stock is ready again, and confirmation goes through.
    confirmed = users[2].post(f"/events/{event['id']}/confirm", json={}, headers=ORIGIN)
    assert confirmed.status_code == 200, confirmed.json
    assert confirmed.json["event"]["status"] == "Confirmed"

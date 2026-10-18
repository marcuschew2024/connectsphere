"""A request's reserved quantities, availability and status must agree."""

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from . import test_equipment_request_acceptance as request_acceptance
from .conftest import ORIGIN
from .test_equipment_request_status_acceptance import create_request, update

live_requests = request_acceptance.live_requests

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"), reason="Disposable DB required"
)
START, END = "2099-10-20T06:00:00Z", "2099-10-20T07:00:00Z"


def allocation(saved, items, quantities, **fields):
    return {
        "start_at": START,
        "end_at": END,
        "revision": saved["revision"],
        "notes": "AV arranged",
        "items": [
            {"equipment_id": item["equipment_id"], "quantity": quantity}
            for item, quantity in zip(items, quantities, strict=False)
        ],
        **fields,
    }


def reserve(users, saved, body, actor=4):
    return users[actor].put(
        f"/equipment/requests/{saved['id']}/reservations", json=body, headers=ORIGIN
    )


def read(users, saved):
    return users[2].get(f"/equipment/requests/{saved['id']}", headers=ORIGIN).json["request"]


def availability(users, item, start=START, end=END):
    result = users[4].get(
        f"/equipment/{item['equipment_id']}/availability",
        query_string={"start_at": start, "end_at": end, "quantity": 1},
        headers=ORIGIN,
    )
    assert result.status_code == 200, result.json
    return result.json["availability"]


def test_partial_full_reduction_release_and_audit(live_requests):
    db, users, event, items, _ = live_requests
    items[1]["quantity"] = 3
    saved = create_request(users, event, items)
    for quantities, status in [
        ([1, 1], "Partially fulfilled"),
        ([1, 3], "Reserved"),
        ([0, 2], "Partially fulfilled"),
        ([0, 0], "Requested"),
    ]:
        response = reserve(users, saved, allocation(saved, items, quantities))
        assert response.status_code == 200, response.json
        saved = response.json["request"]
        detail = read(users, saved)
        assert detail["status"] == status
        assert [i["reserved_quantity"] for i in detail["items"]] == quantities
        assert [i["quantity"] for i in detail["items"]] == [1, 3]
        for item, quantity in zip(items, quantities, strict=False):
            assert availability(users, item)["available_quantity"] == 8 - quantity
        if any(quantities):
            assert update(users[4], saved, "Unavailable").status_code == 409
    history = (
        users[2].get(f"/equipment/requests/{saved['id']}/history", headers=ORIGIN).json["history"]
    )
    assert len(history) == 4 and all(h["actor_id"] == 4 for h in history)
    assert history[0]["reservation_snapshot"]["items"][1]["quantity"] == 0
    assert all(
        row["total_quantity"] == 8
        for row in db.table("equipment_items")
        .select("total_quantity")
        .in_("id", [i["equipment_id"] for i in items])
        .execute()
        .data
    )


def test_capacity_failure_rolls_back_every_item_and_stale_retry_cannot_double_book(live_requests):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    assert reserve(users, saved, allocation(saved, items, [1, 9])).status_code == 409
    assert read(users, saved)["revision"] == 1
    assert (
        db.table("equipment_reservations").select("id").eq("event_id", event["id"]).execute().data
        == []
    )
    body = allocation(saved, items, [1, 2])
    assert reserve(users, saved, body).status_code == 200
    assert reserve(users, saved, body).status_code == 409
    assert availability(users, items[1])["available_quantity"] == 6
    # Adjacent [start, end) windows do not share capacity.
    assert availability(users, items[1], END, "2099-10-20T08:00:00Z")["available_quantity"] == 8


def test_link_existing_booking_without_reserving_twice(live_requests):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items[:1])
    booking = users[4].post(
        f"/equipment/{items[0]['equipment_id']}/reservations",
        headers=ORIGIN,
        json={"event_id": event["id"], "start_at": START, "end_at": END, "quantity": 1},
    )
    assert booking.status_code == 201, booking.json
    reservation_id = booking.json["reservation"]["id"]
    assert read(users, saved)["existing_reservations"][0]["id"] == reservation_id
    body = allocation(saved, items[:1], [1])
    body["items"][0]["reservation_id"] = reservation_id
    assert reserve(users, saved, body).status_code == 200
    rows = db.table("equipment_reservations").select("*").eq("event_id", event["id"]).execute().data
    assert len(rows) == 1 and rows[0]["request_id"] == saved["id"]
    assert read(users, saved)["status"] == "Reserved"
    assert availability(users, items[0])["available_quantity"] == 7


@pytest.mark.parametrize("status", ["Cancelled", "Completed", "Rejected"])
def test_closed_event_and_roles_cannot_reserve(live_requests, status):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    body = allocation(saved, items, [1, 1])
    for actor in (1, 2, 3, 5, 7):
        assert reserve(users, saved, body, actor).status_code == 403
    db.table("events").update({"status": status}).eq("id", event["id"]).execute()
    assert reserve(users, saved, body).status_code == 409


def test_event_cancellation_releases_linked_stock_and_read_status(live_requests):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items[:1])
    assert reserve(users, saved, allocation(saved, items[:1], [1])).status_code == 200
    db.table("events").update({"status": "Cancelled"}).eq("id", event["id"]).execute()
    detail = read(users, saved)
    assert detail["status"] == "Requested" and detail["items"][0]["reserved_quantity"] == 0
    assert availability(users, items[0])["available_quantity"] == 8


def test_request_and_catalogue_compete_for_same_stock(live_requests):
    db, users, event, items, _ = live_requests
    items[0]["quantity"] = 8
    saved = create_request(users, event, items[:1])
    barrier = Barrier(2)

    def attempt(kind):
        with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as client:
            barrier.wait(timeout=10)
            try:
                if kind == "request":
                    body = allocation(saved, items[:1], [8])
                    client.rpc(
                        "save_equipment_request_reservations",
                        {
                            "p_request_id": saved["id"],
                            "p_actor_id": 4,
                            **{"p_" + key: value for key, value in body.items()},
                        },
                    ).execute()
                else:
                    client.table("equipment_reservations").insert(
                        {
                            "event_id": event["id"],
                            "equipment_id": items[0]["equipment_id"],
                            "start_at": START,
                            "end_at": END,
                            "quantity": 8,
                            "created_by": 4,
                        }
                    ).execute()
                return "saved"
            except APIError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt, ["request", "catalogue"])) == ["PT409", "saved"]
    rows = (
        db.table("equipment_reservations")
        .select("quantity")
        .eq("event_id", event["id"])
        .execute()
        .data
    )
    assert sum(row["quantity"] for row in rows) == 8


@pytest.mark.parametrize(
    "changes",
    [
        {"quantity": -1},
        {"quantity": True},
        {"quantity": 1.5},
        {"quantity": "1"},
        {"quantity": 2147483648},
        {"quantity": 2},
        {"equipment_id": "not-an-id"},
        {"reservation_id": "not-an-id"},
        {"actor_id": 2},
    ],
)
def test_bad_allocation_is_rejected_by_api_and_database(live_requests, changes):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items[:1])
    body = allocation(saved, items[:1], [1])
    body["items"][0].update(changes)
    assert reserve(users, saved, body).status_code == 400
    with pytest.raises(APIError):
        db.rpc(
            "save_equipment_request_reservations",
            {
                "p_request_id": saved["id"],
                "p_actor_id": 4,
                **{"p_" + key: value for key, value in body.items()},
            },
        ).execute()
    assert read(users, saved)["revision"] == 1
    assert (
        db.table("equipment_reservations").select("id").eq("event_id", event["id"]).execute().data
        == []
    )


@pytest.mark.parametrize("status", ["Reserved", "Partially fulfilled"])
def test_derived_status_cannot_be_set_manually(live_requests, status):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    assert update(users[4], saved, status).status_code == 400
    with pytest.raises(APIError) as error:
        db.rpc(
            "update_equipment_request_status",
            {
                "p_request_id": saved["id"],
                "p_status": status,
                "p_notes": "",
                "p_revision": 1,
                "p_actor_id": 4,
            },
        ).execute()
    assert error.value.code == "22023"


def test_cannot_adopt_another_events_booking(live_requests):
    db, users, event, items, make_event = live_requests
    other = make_event()
    saved = create_request(users, event, items[:1])
    booking = (
        db.table("equipment_reservations")
        .insert(
            {
                "event_id": other["id"],
                "equipment_id": items[0]["equipment_id"],
                "start_at": START,
                "end_at": END,
                "quantity": 1,
                "created_by": 4,
            }
        )
        .execute()
        .data[0]
    )
    body = allocation(saved, items[:1], [1])
    body["items"][0]["reservation_id"] = booking["id"]
    assert reserve(users, saved, body).status_code == 409
    assert read(users, saved)["existing_reservations"] == []
    assert read(users, saved)["revision"] == 1


@pytest.mark.parametrize(
    "fields",
    [
        {"start_at": None},
        {"start_at": "2099-10-20T06:00:00"},
        {"end_at": START},
        {"revision": True},
        {"revision": 0},
        {"notes": None},
        {"notes": "x" * 2001},
        {"items": []},
        {"created_by": 4},
    ],
)
def test_invalid_reservation_header_does_not_change_request(live_requests, fields):
    _, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    assert reserve(users, saved, {**allocation(saved, items, [1, 1]), **fields}).status_code == 400
    assert read(users, saved)["revision"] == 1

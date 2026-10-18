"""SCRUM-38 real persistence, isolation and concurrent update evidence."""

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from . import test_equipment_request_acceptance as request_acceptance
from .conftest import ORIGIN, select_user

live_requests = request_acceptance.live_requests

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


def create_request(users, event, items):
    response = users[2].post(
        "/equipment/requests",
        json={"event_id": event["id"], "items": items},
        headers=ORIGIN,
    )
    assert response.status_code == 201, response.json
    return response.json["request"]


def update(client, saved, status="Unavailable", notes="Arrangements recorded", revision=None):
    return client.patch(
        f"/equipment/requests/{saved['id']}/status",
        headers=ORIGIN,
        json={
            "status": status,
            "notes": notes,
            "revision": saved["revision"] if revision is None else revision,
        },
    )


def test_all_statuses_persist_for_coordinator_with_complete_audit(live_requests):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    original = saved.copy()
    path = f"/equipment/requests/{saved['id']}"
    assert users[2].get(path + "/history", headers=ORIGIN).json["history"] == []
    expected = ["Unavailable", "Requested"]
    for number, status in enumerate(expected, start=2):
        response = update(users[4], saved, status, "  Follow-up with AV team  ")
        assert response.status_code == 200, response.json
        saved = response.json["request"]
        assert saved["revision"] == number and saved["updated_by"] == 4
        for actor in (2, 4):
            detail = users[actor].get(path, headers=ORIGIN).json["request"]
            assert detail["status"] == status and detail["update_notes"] == "Follow-up with AV team"
            assert [item["quantity"] for item in detail["items"]] == [1, 12]
            queue = users[actor].get("/equipment/requests", headers=ORIGIN).json["requests"]
            assert next(row for row in queue if row["id"] == saved["id"])["status"] == status
        history = users[2].get(path + "/history", headers=ORIGIN).json["history"]
        assert len(history) == number - 1
        latest = history[0]
        assert latest["status"] == status and latest["revision"] == number
        assert latest["from_status"] == ("Requested" if number == 2 else expected[number - 3])
        assert latest["actor_id"] == 4 and latest["actor_name"] == "Demo Tech Support"
        assert latest["changed_at"] == saved["updated_at"]
        assert latest["notes"] == "Follow-up with AV team"
        assert "request" not in latest
    assert saved["requested_by"] == original["requested_by"]
    assert saved["requested_at"] == original["requested_at"]
    assert (
        db.table("equipment_reservations").select("id").eq("event_id", event["id"]).execute().data
        == []
    )
    stocks = (
        db.table("equipment_items")
        .select("total_quantity,revision")
        .in_(
            "id",
            [item["equipment_id"] for item in items],
        )
        .execute()
        .data
    )
    assert all(row == {"total_quantity": 8, "revision": 1} for row in stocks)


def test_other_roles_and_unrelated_coordinator_cannot_mutate_or_read(live_requests):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    safety = db.table("app_users").select("id").eq("role", "Safety Officer").execute().data[0]["id"]
    users[safety] = users[2].application.test_client()
    assert select_user(users[safety], safety).status_code == 200
    for actor in (1, 2, 3, 5, 7, safety):
        assert update(users[actor], saved).status_code == 403
        with pytest.raises(APIError) as caught:
            db.rpc(
                "update_equipment_request_status",
                {
                    "p_request_id": saved["id"],
                    "p_status": "Unavailable",
                    "p_notes": "",
                    "p_revision": 1,
                    "p_actor_id": actor,
                },
            ).execute()
        assert caught.value.code == "PT403"
    path = f"/equipment/requests/{saved['id']}"
    for suffix in ("", "/history"):
        assert users[7].get(path + suffix, headers=ORIGIN).status_code == 404
        assert (
            users[4].get(f"/equipment/requests/{uuid4()}" + suffix, headers=ORIGIN).status_code
            == 404
        )
    db.table("events").update({"coordinator_id": 7}).eq("id", event["id"]).execute()
    for suffix in ("", "/history"):
        assert users[2].get(path + suffix, headers=ORIGIN).status_code == 404
        assert users[7].get(path + suffix, headers=ORIGIN).status_code == 200
    persisted = db.table("equipment_requests").select("*").eq("id", saved["id"]).execute().data[0]
    assert persisted == saved


@pytest.mark.parametrize("status", ["Cancelled", "Completed", "Rejected"])
def test_closed_events_are_readable_but_cannot_be_changed(live_requests, status):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    db.table("events").update({"status": status}).eq("id", event["id"]).execute()
    response = update(users[4], saved)
    assert response.status_code == 409 and "read-only" in response.json["error"]
    path = f"/equipment/requests/{saved['id']}"
    assert users[4].get(path, headers=ORIGIN).json["request"]["status"] == "Requested"
    assert users[4].get(path + "/history", headers=ORIGIN).json["history"] == []


@pytest.mark.parametrize("status", ["Confirmed", "Preparation"])
def test_ongoing_arrangements_can_be_updated_after_planning(live_requests, status):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    db.table("events").update({"status": status}).eq("id", event["id"]).execute()
    assert update(users[4], saved).status_code == 200


def test_stale_or_unchanged_status_adds_no_history(live_requests):
    _, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    assert update(users[4], saved, "Requested").status_code == 409
    assert update(users[4], saved).status_code == 200
    stale = update(users[4], saved, "Unavailable")
    assert stale.status_code == 409 and "Someone else" in stale.json["error"]
    path = f"/equipment/requests/{saved['id']}"
    assert users[2].get(path, headers=ORIGIN).json["request"]["status"] == "Unavailable"
    assert len(users[2].get(path + "/history", headers=ORIGIN).json["history"]) == 1


def test_competing_updates_cannot_overwrite_each_other(live_requests):
    _, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    barrier = Barrier(2)

    def attempt(status):
        with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as db:
            barrier.wait(timeout=10)
            try:
                db.rpc(
                    "update_equipment_request_status",
                    {
                        "p_request_id": saved["id"],
                        "p_status": status,
                        "p_notes": "Race test",
                        "p_revision": 1,
                        "p_actor_id": 4,
                    },
                ).execute()
                return "saved"
            except APIError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(attempt, ["Unavailable", "Unavailable"]))
    assert sorted(outcomes) == ["PT409", "saved"]
    path = f"/equipment/requests/{saved['id']}"
    detail = users[2].get(path, headers=ORIGIN).json["request"]
    history = users[2].get(path + "/history", headers=ORIGIN).json["history"]
    assert detail["revision"] == 2 and len(history) == 1
    assert detail["status"] == history[0]["status"]


def test_history_is_bounded_and_ordered_by_revision(live_requests):
    _, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    for index in range(21):
        response = update(users[4], saved, "Unavailable" if index % 2 == 0 else "Requested")
        assert response.status_code == 200
        saved = response.json["request"]
    path = f"/equipment/requests/{saved['id']}/history"
    first = users[2].get(path, headers=ORIGIN).json
    second = users[2].get(path + "?page=2", headers=ORIGIN).json
    assert first["has_more"] is True and len(first["history"]) == 20
    assert second["has_more"] is False and len(second["history"]) == 1
    assert [row["revision"] for row in first["history"] + second["history"]] == list(
        range(22, 1, -1)
    )


@pytest.mark.parametrize(
    "fields",
    [
        {"p_status": "Fulfilled"},
        {"p_status": None},
        {"p_notes": None},
        {"p_notes": "x" * 2001},
        {"p_revision": None},
        {"p_revision": 0},
    ],
)
def test_database_validates_direct_rpc_input_without_partial_write(live_requests, fields):
    db, users, event, items, _ = live_requests
    saved = create_request(users, event, items)
    with pytest.raises(APIError) as caught:
        db.rpc(
            "update_equipment_request_status",
            {
                "p_request_id": saved["id"],
                "p_status": "Unavailable",
                "p_notes": "",
                "p_revision": 1,
                "p_actor_id": 4,
                **fields,
            },
        ).execute()
    assert caught.value.code == "22023"
    assert db.table("equipment_requests").select("*").eq("id", saved["id"]).execute().data == [
        saved
    ]
    assert (
        users[2].get(f"/equipment/requests/{saved['id']}/history", headers=ORIGIN).json["history"]
        == []
    )

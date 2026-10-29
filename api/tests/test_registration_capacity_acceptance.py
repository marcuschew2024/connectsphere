"""SCRUM-41: real Flask/PostgREST/Postgres writes, including competing final signups."""

import importlib
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from app import create_app

from .conftest import ORIGIN, select_user

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


@pytest.fixture
def live_capacity(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in ("http://127.0.0.1:55433", "http://localhost:55433")
    with SyncPostgrestClient(url) as db:
        for name in ("users", "event_repository", "registration_repository", "rbac", "auth"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        app = create_app({"TESTING": True, "APP_ENV": "development",
                          "DEV_ROLE_SWITCHER_ENABLED": True, "SECRET_KEY": "test-only",
                          "FRONTEND_ORIGIN": ORIGIN["Origin"]})
        users = {number: app.test_client() for number in (1, 2, 5, 6, 41001, 41002)}
        for number, client in users.items():
            assert select_user(client, number).status_code == 200
        ids = []

        def make_event(status="Planning", capacity=None):
            event = db.table("events").insert({
                "title": f"Capacity acceptance {uuid4()}", "description": "Test",
                "purpose": "Test", "category": "Workshop", "expected_attendance": 120,
                "event_datetime": "2099-10-20T06:00:00Z", "organiser_id": 1,
                "coordinator_id": 2, "status": status,
                "submitted_at": "2026-10-01T06:00:00Z", "registration_capacity": capacity,
            }).execute().data[0]
            ids.append(event["id"])
            return event

        yield db, users, make_event
        for event_id in ids:
            db.table("event_edit_log").delete().eq("event_id", event_id).execute()
            db.table("access_denied_log").delete().eq("event_id", event_id).execute()
            db.table("events").delete().eq("id", event_id).execute()


def register(users, event, actor=41001):
    return users[actor].post(f"/events/{event['id']}/registrations", json={}, headers=ORIGIN)


def stored(db, event):
    return db.table("events").select("*").eq("id", event["id"]).execute().data[0]


def test_capacity_save_is_persistent_audited_and_independent_of_attendance(live_capacity):
    db, users, make_event = live_capacity
    event = make_event()
    response = users[1].put(f"/events/{event['id']}/registration-capacity",
                            json={"capacity": 1}, headers=ORIGIN)
    assert response.status_code == 200, response.json
    result = stored(db, event)
    assert result["registration_capacity"] == 1 and result["expected_attendance"] == 120
    summary = users[1].get(f"/events/{event['id']}/registration-capacity", headers=ORIGIN)
    assert summary.json["registration_capacity"]["remaining"] == 1
    audit = db.table("event_edit_log").select("*").eq("event_id", event["id"]).execute().data
    assert len(audit) == 1 and audit[0]["editor_id"] == 1
    assert audit[0]["changed_fields"] == ["registration_capacity"]


def test_one_slot_is_taken_once_and_full_signup_persists_nothing(live_capacity):
    db, users, make_event = live_capacity
    event = make_event("Confirmed", 1)
    accepted = register(users, event)
    assert accepted.status_code == 201, accepted.json
    assert accepted.json["registration"]["attendee_id"] == 41001
    full = register(users, event, 41002)
    assert full.status_code == 409 and "full" in full.json["error"]
    assert stored(db, event)["registered_count"] == 1
    rows = db.table("event_registrations").select("*").eq("event_id", event["id"]).execute().data
    assert len(rows) == 1 and rows[0]["attendee_id"] == 41001


def test_two_simultaneous_requests_cannot_take_the_same_final_place(live_capacity):
    db, _, make_event = live_capacity
    event = make_event("Confirmed", 1)
    barrier = Barrier(2)

    def attempt(actor):
        with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as client:
            barrier.wait(timeout=10)
            try:
                return client.rpc("register_event_attendee", {
                    "p_event_id": event["id"], "p_attendee_id": actor,
                }).execute().data
            except APIError as error:
                return error.message

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, [41001, 41002]))
    assert len([result for result in results if isinstance(result, dict)]) == 1
    assert "event_full" in results
    assert stored(db, event)["registered_count"] == 1
    assert len(db.table("event_registrations").select("id").eq(
        "event_id", event["id"],
    ).execute().data) == 1


def test_direct_inserts_cannot_bypass_capacity(live_capacity):
    db, users, make_event = live_capacity
    event = make_event("Confirmed", 1)
    assert register(users, event).status_code == 201
    with pytest.raises(APIError) as refused:
        db.table("event_registrations").insert({
            "event_id": event["id"], "attendee_id": 41002,
        }).execute()
    assert (refused.value.code, refused.value.message) == ("PT409", "event_full")
    assert stored(db, event)["registered_count"] == 1


def test_duplicate_signup_does_not_consume_another_slot(live_capacity):
    db, users, make_event = live_capacity
    event = make_event("Confirmed", 2)
    assert register(users, event).status_code == 201
    duplicate = register(users, event)
    assert duplicate.status_code == 409 and "already registered" in duplicate.json["error"]
    assert stored(db, event)["registered_count"] == 1


def test_unconfigured_and_nonconfirmed_events_cannot_register(live_capacity):
    db, users, make_event = live_capacity
    for event in (make_event("Confirmed"), make_event("Planning", 10),
                  make_event("Cancelled", 10), make_event("Completed", 10)):
        assert register(users, event).status_code == 409
        assert stored(db, event)["registered_count"] == 0


def test_capacity_is_owner_only_and_locked_after_confirmation(live_capacity):
    db, users, make_event = live_capacity
    event = make_event("Planning", 10)
    path = f"/events/{event['id']}/registration-capacity"
    assert users[6].put(path, json={"capacity": 20}, headers=ORIGIN).status_code == 403
    assert users[2].put(path, json={"capacity": 20}, headers=ORIGIN).status_code == 403
    db.table("events").update({"status": "Confirmed"}).eq("id", event["id"]).execute()
    locked = users[1].put(path, json={"capacity": 20}, headers=ORIGIN)
    assert locked.status_code == 409 and "before" in locked.json["error"]
    assert stored(db, event)["registration_capacity"] == 10


def test_database_rechecks_role_status_capacity_and_ownership(live_capacity):
    db, _, make_event = live_capacity
    event = make_event("Planning", 10)
    calls = [
        ("register_event_attendee", {"p_event_id": event["id"], "p_attendee_id": 1}, "PT403"),
        ("register_event_attendee", {"p_event_id": event["id"], "p_attendee_id": 5}, "PT409"),
        ("set_registration_capacity", {"p_event_id": event["id"], "p_actor_id": 6,
                                       "p_capacity": 20}, "PT403"),
        ("set_registration_capacity", {"p_event_id": event["id"], "p_actor_id": 1,
                                       "p_capacity": 0}, "22023"),
    ]
    for name, parameters, code in calls:
        with pytest.raises(APIError) as refused:
            db.rpc(name, parameters).execute()
        assert refused.value.code == code
    assert stored(db, event)["registered_count"] == 0

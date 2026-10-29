"""Real database proof that initial setup is owner-only, audited and one-time."""

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from . import test_attendee_registration_acceptance
from .conftest import ORIGIN

signup_db = test_attendee_registration_acceptance.signup_db

pytestmark = pytest.mark.skipif(not os.environ.get("POSTGREST_TEST_URL"),
                                reason="Disposable acceptance services are not running")


@pytest.fixture
def initial_setup_db(signup_db):
    db, clients, make_event = signup_db
    ids = []

    def event(**overrides):
        row = make_event(**overrides)
        ids.append(row["id"])
        return row

    yield db, clients, event
    # Capacity changes create durable audit rows. Remove only these test events'
    # audit fixtures before the shared fixture removes their parent events.
    for event_id in ids:
        db.table("event_edit_log").delete().eq("event_id", event_id).execute()


def test_initial_setup_opens_signup_without_changing_the_event_status(initial_setup_db):
    db, clients, make_event = initial_setup_db
    event = make_event(registration_capacity=None)
    path = f"/events/{event['id']}/registration-capacity"
    response = clients[1].put(path, json={"capacity": 72}, headers=ORIGIN)
    assert response.status_code == 200, response.json
    stored = db.table("events").select("*").eq("id", event["id"]).execute().data[0]
    assert stored["status"] == "Confirmed" and stored["registration_capacity"] == 72
    assert stored["registered_count"] == 0
    audit = db.table("event_edit_log").select("*").eq("event_id", event["id"]).execute().data
    assert len(audit) == 1 and audit[0]["editor_id"] == 1
    assert audit[0]["changed_fields"] == ["registration_capacity"]
    signup = clients[41001].post(f"/events/{event['id']}/registrations",
                                json={"information": "IS year 2"}, headers=ORIGIN)
    assert signup.status_code == 201, signup.json
    assert clients[1].put(path, json={"capacity": 100}, headers=ORIGIN).status_code == 409
    assert db.table("events").select("registration_capacity,registered_count").eq(
        "id", event["id"]).execute().data[0] == {
            "registration_capacity": 72, "registered_count": 1,
        }


def test_database_still_requires_the_owning_organiser_for_initial_setup(initial_setup_db):
    db, _, make_event = initial_setup_db
    event = make_event(registration_capacity=None)
    for actor in (2, 6, 41001):
        with pytest.raises(APIError) as refused:
            db.rpc("set_registration_capacity", {
                "p_event_id": event["id"], "p_actor_id": actor, "p_capacity": 72,
            }).execute()
        assert refused.value.code == "PT403"
    assert db.table("events").select("registration_capacity").eq(
        "id", event["id"]).execute().data[0]["registration_capacity"] is None


def test_database_never_unlocks_an_established_limit_or_later_state(initial_setup_db):
    db, _, make_event = initial_setup_db
    for status, capacity in (("Confirmed", 10), ("Preparation", None),
                             ("Completed", None), ("Cancelled", None), ("Rejected", None)):
        event = make_event(status=status, registration_capacity=capacity)
        with pytest.raises(APIError) as refused:
            db.rpc("set_registration_capacity", {
                "p_event_id": event["id"], "p_actor_id": 1, "p_capacity": 72,
            }).execute()
        assert refused.value.message == "capacity_locked"
        assert db.table("events").select("registration_capacity").eq(
            "id", event["id"]).execute().data[0]["registration_capacity"] == capacity


def test_simultaneous_initial_saves_cannot_replace_each_others_first_limit(initial_setup_db):
    db, _, make_event = initial_setup_db
    event = make_event(registration_capacity=None)
    barrier = Barrier(2)

    def attempt(capacity):
        with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as connection:
            barrier.wait(timeout=10)
            try:
                return connection.rpc("set_registration_capacity", {
                    "p_event_id": event["id"], "p_actor_id": 1, "p_capacity": capacity,
                }).execute().data
            except APIError as error:
                return error.message

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(attempt, (72, 100)))
    successful = [value for value in outcomes if isinstance(value, dict)]
    assert len(successful) == 1 and "capacity_locked" in outcomes
    assert db.table("events").select("registration_capacity").eq(
        "id", event["id"]).execute().data[0]["registration_capacity"] == successful[
            0]["registration_capacity"]
    assert len(db.table("event_edit_log").select("id").eq(
        "event_id", event["id"]).execute().data) == 1

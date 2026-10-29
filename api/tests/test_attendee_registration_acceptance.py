"""Real database verification of SCRUM-40 persistence, isolation and atomicity."""

import importlib
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from app import create_app

from .conftest import ORIGIN

pytestmark = pytest.mark.skipif(not os.environ.get("POSTGREST_TEST_URL"),
                                reason="Disposable acceptance services are not running")


@pytest.fixture
def signup_db(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in ("http://127.0.0.1:55433", "http://localhost:55433")
    with SyncPostgrestClient(url) as db:
        for name in ("auth", "users", "event_repository", "registration_repository", "rbac"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        app = create_app({"TESTING": True, "APP_ENV": "production",
                          "DEV_ROLE_SWITCHER_ENABLED": False, "SECRET_KEY": "test-only",
                          "FRONTEND_ORIGIN": ORIGIN["Origin"]})
        clients = {actor: app.test_client() for actor in (1, 41001, 41002)}
        for actor, client in clients.items():
            with client.session_transaction() as session:
                session["user_id"] = actor
        ids = []

        def event(**overrides):
            row = db.table("events").insert({
                "title": f"Attendee signup {uuid4()}", "description": "Campus workshop",
                "purpose": "Private planning", "category": "Workshop", "expected_attendance": 10,
                "event_datetime": "2099-10-20T06:00:00Z", "organiser_id": 1,
                "submitted_at": "2026-10-01T06:00:00Z",
                "coordinator_id": 2, "status": "Confirmed", "registration_capacity": 2,
                "registration_requirements": "Course and year", **overrides,
            }).execute().data[0]
            ids.append(row["id"])
            return row

        yield db, clients, event
        for event_id in ids:
            db.table("events").delete().eq("id", event_id).execute()


def signup(client, event, information="IS year 2"):
    return client.post(f"/events/{event['id']}/registrations",
                       json={"information": information}, headers=ORIGIN)


def test_real_account_books_once_receives_notification_and_retains_access(signup_db):
    db, clients, make_event = signup_db
    event = make_event()
    attendee = clients[41001]
    response = signup(attendee, event)
    assert response.status_code == 201, response.json
    receipt = response.json["registration"]
    assert receipt["attendee_id"] == 41001 and receipt["information"] == "IS year 2"
    assert receipt["status"] == "Registered" and receipt["registered_at"]
    assert signup(attendee, event).status_code == 409
    assert db.table("events").select("registered_count").eq("id", event["id"]).execute().data[
        0]["registered_count"] == 1
    db.table("notifications").insert({
        "recipient_id": 41001, "event_id": event["id"],
        "notification_type": "event_rejected", "message": "Private organiser decision",
    }).execute()
    notes = attendee.get("/events/registration-confirmations", headers=ORIGIN).json["confirmations"]
    matching = [note for note in notes if note["event_id"] == event["id"]]
    assert len(matching) == 1
    assert event["title"] in matching[0]["message"] and "Singapore" in matching[0]["message"]
    assert not [note for note in clients[41002].get(
        "/events/registration-confirmations", headers=ORIGIN).json[
        "confirmations"] if note["event_id"] == event["id"]]
    assert attendee.get(f"/events/{event['id']}", headers=ORIGIN).status_code == 200
    db.table("events").update({"status": "Preparation"}).eq("id", event["id"]).execute()
    path = f"/events/{event['id']}/registration-offer"
    refreshed = attendee.get(path, headers=ORIGIN)
    assert refreshed.status_code == 200 and refreshed.json["registration"]["id"] == receipt["id"]
    assert clients[41002].get(path, headers=ORIGIN).status_code == 404


def test_required_information_and_window_are_rechecked_by_database(signup_db):
    db, clients, make_event = signup_db
    for overrides, information, message in (({}, "", "registration_information_required"),
                               ({}, "\t\n", "registration_information_required"),
                               ({"registration_opens_at": "2999-01-01T00:00:00Z"}, "IS year 2",
                                "registration_not_open"),
                               ({"registration_closes_at": "2000-01-01T00:00:00Z"}, "IS year 2",
                                "registration_ended")):
        event = make_event(**overrides)
        assert signup(clients[41001], event, information).status_code in (400, 409)
        with pytest.raises(APIError) as error:
            db.table("event_registrations").insert({
                "event_id": event["id"], "attendee_id": 41001, "information": information,
            }).execute()
        assert error.value.message == message
        stored = db.table("events").select("registered_count").eq(
            "id", event["id"]).execute().data[0]
        assert stored["registered_count"] == 0
        assert not db.table("event_participants").select("*").eq(
            "event_id", event["id"]).execute().data
        assert not db.table("notifications").select("*").eq(
            "event_id", event["id"]).execute().data


def test_two_information_submissions_compete_for_one_place_without_partial_receipts(signup_db):
    db, _, make_event = signup_db
    event = make_event(registration_capacity=1)
    barrier = Barrier(2)

    def attempt(actor):
        with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as connection:
            barrier.wait(timeout=10)
            try:
                return connection.rpc("register_event_attendee_with_information", {
                    "p_event_id": event["id"], "p_attendee_id": actor,
                    "p_information": "IS year 2",
                }).execute().data
            except APIError as error:
                return error.message

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, (41001, 41002)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "event_full" in results
    for table in ("event_registrations", "event_participants", "notifications"):
        assert len(db.table(table).select("*").eq("event_id", event["id"]).execute().data) == 1


def test_discovery_never_returns_drafts_planning_or_internal_fields(signup_db):
    _, clients, make_event = signup_db
    public = make_event()
    hidden = [make_event(status=status)["id"] for status in ("Draft", "Planning", "Preparation")]
    response = clients[41001].get("/events/registration-offers", headers=ORIGIN)
    assert response.status_code == 200
    offers = response.json["offers"]
    assert public["id"] in [offer["event"]["id"] for offer in offers]
    assert not set(hidden) & {offer["event"]["id"] for offer in offers}
    assert all("purpose" not in offer["event"] and "organiser_id" not in offer["event"]
               for offer in offers)

"""SCRUM-44 intent across Flask and a real disposable Postgres/PostgREST database."""

import os

import pytest

from . import test_attendee_registration_acceptance
from .conftest import ORIGIN

signup_db = test_attendee_registration_acceptance.signup_db
pytestmark = pytest.mark.skipif(not os.environ.get("POSTGREST_TEST_URL"),
                                reason="Disposable acceptance services are not running")


def register(db, event, attendee):
    return db.table("event_registrations").insert({
        "event_id": event["id"], "attendee_id": attendee, "information": "IS year 2",
    }).execute().data[0]


def test_own_list_excludes_others_and_private_fields_even_on_the_same_event(signup_db):
    db, clients, make_event = signup_db
    event = make_event()
    own = register(db, event, 41001)
    other = register(db, event, 41002)
    response = clients[41001].get("/events/registrations", headers=ORIGIN)
    assert response.status_code == 200
    rows = response.json["registrations"]
    assert [row["id"] for row in rows] == [own["id"]]
    assert set(rows[0]) == {
        "id", "reference", "event_id", "status", "registered_at", "withdrawn_at", "event",
    }
    assert set(rows[0]["event"]) == {
        "id", "reference", "title", "category", "event_datetime", "status",
    }
    assert rows[0]["event"]["title"] == event["title"]
    assert rows[0]["reference"] == own["reference"]
    assert rows[0]["event"]["reference"] == event["reference"]
    assert other["id"] not in response.get_data(as_text=True)
    assert "IS year 2" not in response.get_data(as_text=True)
    assert clients[41002].get("/events/registrations", headers=ORIGIN).json[
        "registrations"][0]["id"] == other["id"]


def test_read_reflects_withdrawal_and_event_lifecycle_without_replaying_old_receipts(signup_db):
    db, clients, make_event = signup_db
    event = make_event()
    receipt = register(db, event, 41001)
    client = clients[41001]
    assert client.get("/events/registrations", headers=ORIGIN).json[
        "registrations"][0]["status"] == "Registered"
    db.table("event_registrations").update({"status": "Withdrawn"}).eq(
        "id", receipt["id"]).execute()
    db.table("events").update({"status": "Cancelled"}).eq("id", event["id"]).execute()
    current = client.get("/events/registrations", headers=ORIGIN).json["registrations"][0]
    assert current["status"] == "Withdrawn" and current["withdrawn_at"]
    assert current["event"]["status"] == "Cancelled"
    # The original confirmation remains historical; it must not dictate current status.
    assert db.table("notifications").select("id").eq("event_id", event["id"]).eq(
        "notification_type", "registration_confirmed").execute().data
    assert client.get(f"/events/{event['id']}/registration-offer", headers=ORIGIN).json[
        "registration"]["status"] == "Withdrawn"


def test_pagination_is_complete_stable_and_scoped_before_limiting(signup_db):
    db, clients, make_event = signup_db
    ids = []
    for _ in range(27):
        event = make_event()
        register(db, event, 41002)
        ids.append(register(db, event, 41001)["id"])
    client = clients[41001]
    first = client.get("/events/registrations?page=1", headers=ORIGIN).json
    second = client.get("/events/registrations?page=2", headers=ORIGIN).json
    assert len(first["registrations"]) == 25 and first["has_more"] is True
    assert len(second["registrations"]) == 2 and second["has_more"] is False
    combined = [row["id"] for row in first["registrations"] + second["registrations"]]
    assert combined == list(reversed(ids))
    assert client.get("/events/registrations?page=1", headers=ORIGIN).json == first
    assert client.get("/events/registrations?page=3", headers=ORIGIN).json == {
        "registrations": [], "page": 3, "has_more": False,
    }

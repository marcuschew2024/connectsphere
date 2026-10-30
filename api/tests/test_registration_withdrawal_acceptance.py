"""SCRUM-43: real HTTP/database writes, competing withdrawals and freed capacity."""
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from . import test_attendee_registration_acceptance as registration_fixtures
from .conftest import ORIGIN
from .test_attendee_registration_acceptance import signup

pytestmark = pytest.mark.skipif(not os.environ.get("POSTGREST_TEST_URL"),
                                reason="Disposable acceptance services are not running")


@pytest.fixture
def withdrawal_db(monkeypatch):
    yield from registration_fixtures.signup_db.__wrapped__(monkeypatch)


def withdraw(client, event):
    return client.post(f"/events/{event['id']}/registrations/withdraw", json={}, headers=ORIGIN)


def count(db, event):
    return db.table("events").select("registered_count").eq(
        "id", event["id"]).execute().data[0]["registered_count"]


def test_withdrawal_releases_a_full_place_and_updates_both_views_and_notification(withdrawal_db):
    db, clients, make_event = withdrawal_db
    event = make_event(registration_capacity=1)
    first = signup(clients[41001], event)
    assert first.status_code == 201
    assert signup(clients[41002], event).status_code == 409
    response = withdraw(clients[41001], event)
    assert response.status_code == 200, response.json
    receipt = response.json["registration"]
    assert receipt["status"] == "Withdrawn" and receipt["withdrawn_at"]
    assert receipt["registered_at"] == first.json["registration"]["registered_at"]
    assert set(receipt) == {"id", "event_id", "status", "registered_at", "withdrawn_at"}
    assert count(db, event) == 0
    assert withdraw(clients[41001], event).json["registration"] == receipt
    notes = db.table("notifications").select("*").eq("event_id", event["id"]).eq(
        "notification_type", "registration_withdrawn").execute().data
    assert len(notes) == 1 and notes[0]["recipient_id"] == 41001
    feed = clients[41001].get("/events/registration-confirmations", headers=ORIGIN)
    own_notes = [note for note in feed.json["confirmations"] if note["event_id"] == event["id"]]
    assert {note["notification_type"] for note in own_notes} == {
        "registration_confirmed", "registration_withdrawn",
    }
    assert not [note for note in clients[41002].get(
        "/events/registration-confirmations", headers=ORIGIN).json["confirmations"]
        if note["event_id"] == event["id"]]
    listing = clients[41001].get("/events/registrations", headers=ORIGIN).json["registrations"]
    assert next(row for row in listing if row["event_id"] == event["id"])["status"] == "Withdrawn"
    offer = clients[41001].get(f"/events/{event['id']}/registration-offer", headers=ORIGIN)
    assert offer.json["registration"]["withdrawn_at"] == receipt["withdrawn_at"]
    assert signup(clients[41002], event).status_code == 201
    assert count(db, event) == 1
    # A late retry cannot release the replacement attendee's place.
    assert withdraw(clients[41001], event).json["registration"] == receipt
    assert count(db, event) == 1


def test_another_attendee_and_an_organiser_cannot_withdraw_the_registered_place(withdrawal_db):
    db, clients, make_event = withdrawal_db
    event = make_event()
    assert signup(clients[41001], event).status_code == 201
    assert withdraw(clients[41002], event).status_code == 404
    assert withdraw(clients[1], event).status_code == 403
    assert count(db, event) == 1
    assert not db.table("notifications").select("id").eq("event_id", event["id"]).eq(
        "notification_type", "registration_withdrawn").execute().data


@pytest.mark.parametrize("overrides", [
    {"withdrawal_closes_at": "2000-01-01T00:00:00Z"},
    {"event_datetime": "2000-01-01T00:00:00Z"},
    {"status": "Cancelled"}, {"status": "Completed"}, {"status": "Planning"},
])
def test_conditions_are_enforced_on_rpc_and_direct_update_without_partial_state(
    withdrawal_db, overrides,
):
    db, clients, make_event = withdrawal_db
    event = make_event()
    assert signup(clients[41001], event).status_code == 201
    db.table("events").update(overrides).eq("id", event["id"]).execute()
    assert withdraw(clients[41001], event).status_code == 409
    with pytest.raises(APIError):
        db.table("event_registrations").update({"status": "Withdrawn"}).eq(
            "event_id", event["id"]).execute()
    assert count(db, event) == 1
    row = db.table("event_registrations").select("status,withdrawn_at").eq(
        "event_id", event["id"]).execute().data[0]
    assert row == {"status": "Registered", "withdrawn_at": None}
    assert not db.table("notifications").select("id").eq("event_id", event["id"]).eq(
        "notification_type", "registration_withdrawn").execute().data


def test_preparation_still_allows_withdrawal_before_start(withdrawal_db):
    db, clients, make_event = withdrawal_db
    event = make_event()
    assert signup(clients[41001], event).status_code == 201
    db.table("events").update({"status": "Preparation"}).eq("id", event["id"]).execute()
    assert withdraw(clients[41001], event).status_code == 200
    assert count(db, event) == 0


def test_two_simultaneous_withdrawals_release_exactly_one_place_and_receipt(withdrawal_db):
    db, clients, make_event = withdrawal_db
    event = make_event()
    assert signup(clients[41001], event).status_code == 201
    barrier = Barrier(2)

    def attempt(_):
        with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as connection:
            barrier.wait(timeout=10)
            return connection.rpc("withdraw_event_attendee", {
                "p_event_id": event["id"], "p_attendee_id": 41001,
            }).execute().data

    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(attempt, range(2)))
    assert receipts[0] == receipts[1] and receipts[0]["withdrawn_at"]
    assert count(db, event) == 0
    assert len(db.table("notifications").select("id").eq("event_id", event["id"]).eq(
        "notification_type", "registration_withdrawn").execute().data) == 1


def test_organiser_cutoff_is_saved_audited_and_locked_even_after_withdrawal(withdrawal_db):
    db, clients, make_event = withdrawal_db
    event = make_event()
    path = f"/events/{event['id']}/withdrawal-policy"
    cutoff = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    result = clients[1].put(path, json={"closes_at": cutoff}, headers=ORIGIN)
    assert result.status_code == 200, result.json
    assert result.json["withdrawal_policy"]["can_edit"]
    assert clients[41001].put(path, json={"closes_at": None}, headers=ORIGIN).status_code == 403
    audit = db.table("event_edit_log").select("*").eq("event_id", event["id"]).execute().data
    assert len(audit) == 1 and audit[0]["changed_fields"] == ["withdrawal_closes_at"]
    assert signup(clients[41001], event).status_code == 201
    assert withdraw(clients[41001], event).status_code == 200
    assert count(db, event) == 0
    assert not clients[1].get(path, headers=ORIGIN).json["withdrawal_policy"]["can_edit"]
    assert clients[1].put(path, json={"closes_at": None}, headers=ORIGIN).status_code == 409
    # Cleanup fixture does not normally create edit-log rows.
    db.table("event_edit_log").delete().eq("event_id", event["id"]).execute()

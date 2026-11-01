"""SCRUM-45 real DB: private names, event-wide counts, filtering and reassignment."""

import os

import pytest

from . import test_attendee_registration_acceptance
from .conftest import ORIGIN

signup_db = test_attendee_registration_acceptance.signup_db

pytestmark = pytest.mark.skipif(not os.environ.get("POSTGREST_TEST_URL"),
                                reason="Disposable acceptance services are not running")


def staff_client(clients, actor):
    client = clients[1].application.test_client()
    with client.session_transaction() as session:
        session["user_id"] = actor
    return client


def test_owner_and_current_coordinator_see_names_and_live_counts_without_private_data(signup_db):
    db, clients, make_event = signup_db
    event = make_event()
    other = make_event()
    for target, actor in ((event, 41001), (event, 41002), (other, 41001)):
        db.table("event_registrations").insert({"event_id": target["id"],
            "attendee_id": actor, "information": "PRIVATE supplementary answer"}).execute()
    path = f"/events/{event['id']}/registrations"
    owner = clients[1]
    coordinator = staff_client(clients, 2)
    first = owner.get(path, headers=ORIGIN)
    assert first.status_code == 200, first.json
    assert coordinator.get(path, headers=ORIGIN).json == first.json
    assert first.json["counts"] == {
        "registered_count": 2, "waitlisted_count": 0, "withdrawn_count": 0,
    }
    assert first.json["capacity"] == 2 and len(first.json["registrations"]) == 2
    for row in first.json["registrations"]:
        assert set(row) == {
            "id", "reference", "status", "registered_at", "withdrawn_at", "attendee",
        }
        assert set(row["attendee"]) == {"display_name"}
        assert row["attendee"]["display_name"] and row["reference"].startswith("REG-")
    assert "PRIVATE" not in first.get_data(as_text=True)
    assert other["id"] not in first.get_data(as_text=True)
    assert clients[41001].post(f"/events/{event['id']}/registrations/withdraw",
                               json={}, headers=ORIGIN).status_code == 200
    withdrawn = owner.get(path + "?status=Withdrawn", headers=ORIGIN).json
    assert withdrawn["counts"] == {
        "registered_count": 1, "waitlisted_count": 0, "withdrawn_count": 1,
    }
    assert len(withdrawn["registrations"]) == 1
    assert withdrawn["registrations"][0]["withdrawn_at"]
    assert owner.get(path + "?status=Waitlisted", headers=ORIGIN).json["registrations"] == []
    # Cancelling preserves the historical roster; it does not make it public.
    db.table("events").update({"status": "Cancelled"}).eq("id", event["id"]).execute()
    assert owner.get(path, headers=ORIGIN).json["event"]["status"] == "Cancelled"
    assert clients[41001].get(path, headers=ORIGIN).status_code == 403


def test_roster_denies_other_roles_foreign_owners_and_previous_coordinators(signup_db):
    db, clients, make_event = signup_db
    event = make_event()
    path = f"/events/{event['id']}/registrations"
    for actor in (3, 4, 41001, 41002, 10, 11, 13, 14):
        assert staff_client(clients, actor).get(path, headers=ORIGIN).status_code == 403
    # Participant membership survives reassignment, but private roster access must not.
    db.table("event_participants").insert({"event_id": event["id"], "user_id": 2,
                                           "role": "Coordinator"}).execute()
    db.table("events").update({"coordinator_id": 12}).eq("id", event["id"]).execute()
    assert staff_client(clients, 2).get(path, headers=ORIGIN).status_code == 403
    assert staff_client(clients, 12).get(path, headers=ORIGIN).status_code == 200
    db.table("access_denied_log").delete().eq("event_id", event["id"]).execute()


def test_empty_unset_capacity_and_drafts_are_truthful_and_private(signup_db):
    _, clients, make_event = signup_db
    event = make_event(status="Draft", registration_capacity=None)
    path = f"/events/{event['id']}/registrations"
    response = clients[1].get(path, headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["capacity"] is None
    assert response.json["registrations"] == []
    assert response.json["counts"] == {
        "registered_count": 0, "waitlisted_count": 0, "withdrawn_count": 0,
    }
    assert staff_client(clients, 2).get(path, headers=ORIGIN).status_code == 404


def test_roster_pagination_and_counts_are_complete_and_event_scoped(signup_db):
    db, clients, make_event = signup_db
    event = make_event(registration_capacity=30, registration_requirements=None)
    ids = []
    try:
        for actor in range(45001, 45028):
            ids.append(actor)
            db.table("event_registrations").insert({"event_id": event["id"],
                                                     "attendee_id": actor}).execute()
        path = f"/events/{event['id']}/registrations"
        first = clients[1].get(path, headers=ORIGIN).json
        second = clients[1].get(path + "?page=2&status=Registered", headers=ORIGIN).json
        assert len(first["registrations"]) == 25 and first["has_more"]
        assert len(second["registrations"]) == 2 and not second["has_more"]
        assert first["counts"]["registered_count"] == second["counts"]["registered_count"] == 27
        combined = first["registrations"] + second["registrations"]
        assert len({row["id"] for row in combined}) == 27
        assert [row["attendee"]["display_name"] for row in combined] == [
            f"Roster attendee {actor}" for actor in reversed(ids)]
        assert clients[1].get(path, headers=ORIGIN).json == first
    finally:
        db.table("events").delete().eq("id", event["id"]).execute()

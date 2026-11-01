"""SCRUM-138 change-request approval against real PostgreSQL and PostgREST.

Start compose.acceptance.yml and run supabase/tests/run.sh first. These tests use
only disposable local records, never hosted data.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Barrier

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from .conftest import ORIGIN
from .test_event_completion_acceptance import (  # noqa: F401
    add_booking,
    add_reservation,
    live,
    live_requests,
    row,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


def _propose(users, event, changes, description="Please update the event"):
    response = users[1].post(
        f"/events/{event['id']}/change-requests",
        json={"description": description, "changes": changes}, headers=ORIGIN,
    )
    assert response.status_code == 201, response.json
    return response.json["change_request"]


def _approve(users, event, request_id, note=None):
    body = {"status": "Approved", **({"review_note": note} if note else {})}
    return users[2].patch(
        f"/events/{event['id']}/change-requests/{request_id}", json=body, headers=ORIGIN,
    )


def _rpc(db, event_id, request_id, actor_id=2, note=None):
    return db.rpc("approve_change_request", {
        "p_event_id": event_id, "p_request_id": request_id,
        "p_actor_id": actor_id, "p_review_note": note,
    }).execute()


def _history(db, event_id):
    return db.table("event_status_history").select("*").eq("event_id", event_id).execute().data


def _notifications(db, event_id):
    return db.table("notifications").select("*").eq("event_id", event_id).order("id").execute().data


# AC1 + AC4: an ordinary change is applied atomically with actor and time, no flag.
def test_approving_applies_the_values_and_records_the_decision(live):  # noqa: F811
    db, users, _, make_event, _ = live
    event = make_event(status="Confirmed")
    before = row(db, "events", event["id"])
    saved = _propose(users, event, {
        "title": "Renamed workshop", "equipment_requirements": "Two mics",
    })
    assert row(db, "events", event["id"]) == before  # Requesting changes nothing.

    response = _approve(users, event, saved["id"], note="  Fine by me  ")

    assert response.status_code == 200, response.json
    after = row(db, "events", event["id"])
    assert after["title"] == "Renamed workshop"
    assert after["equipment_requirements"] == "Two mics"
    assert after["status"] == "Confirmed"
    assert after["updated_at"] > before["updated_at"]
    stored = row(db, "event_change_requests", saved["id"])
    assert stored["status"] == "Approved"
    assert stored["reviewed_by"] == 2 and stored["reviewed_at"]
    assert stored["review_note"] == "Fine by me"
    assert stored["significant"] is False
    assert stored["applied_changes"] == {
        "title": {"from": before["title"], "to": "Renamed workshop"},
        "equipment_requirements": {"from": None, "to": "Two mics"},
    }
    approved = [h for h in _history(db, event["id"]) if h["action"] == "change_request_approved"]
    assert len(approved) == 1
    assert approved[0]["changed_by"] == 2 and approved[0]["note"] == "Fine by me"
    assert datetime.fromisoformat(approved[0]["changed_at"]) == datetime.fromisoformat(
        stored["reviewed_at"])
    sent = [(n["recipient_id"], n["notification_type"]) for n in _notifications(db, event["id"])]
    assert (1, "event_change_request_updated") in sent
    assert all(kind != "event_re_review_required" for _, kind in sent)


# SCRUM-48: rescheduling via a change request applies the new date, flags re-review, and
# runs the attendee-notify path. No one is registered here, so notified_attendees is 0 and
# no reschedule notice is sent (the populated path mirrors cancel_event's attendee notify).
def test_rescheduling_applies_the_new_date_and_flags_re_review(live):  # noqa: F811
    db, users, _, make_event, _ = live
    event = make_event(status="Confirmed")
    saved = _propose(users, event, {"event_datetime": "2099-12-20T06:00:00Z"})

    response = _approve(users, event, saved["id"])

    assert response.status_code == 200, response.json
    after = row(db, "events", event["id"])
    assert datetime.fromisoformat(after["event_datetime"]) == datetime.fromisoformat(
        "2099-12-20T06:00:00+00:00")
    assert after["status"] == "Confirmed"
    stored = row(db, "event_change_requests", saved["id"])
    assert stored["significant"] is True
    assert "event_datetime" in stored["applied_changes"]
    sent = [(n["recipient_id"], n["notification_type"]) for n in _notifications(db, event["id"])]
    assert (1, "event_change_request_updated") in sent
    assert any(kind == "event_re_review_required" for _, kind in sent)
    assert response.json["affected"]["notified_attendees"] == 0
    assert all(kind != "event_rescheduled" for _, kind in sent)


# AC2 + AC3: pax/venue changes flag re-review and notify; nothing is un-booked.
@pytest.mark.parametrize("changes", [
    {"expected_attendance": 150}, {"venue_requirements": "Lecture theatre for 150"},
])
def test_a_significant_change_flags_re_review_and_keeps_every_arrangement(live, changes):  # noqa: F811
    db, users, items, make_event, venue = live
    event = make_event(status="Confirmed")
    booking = add_booking(db, event, venue, "Confirmed", 48, 50)
    reservation = add_reservation(db, event, items)
    kept = (row(db, "venue_bookings", booking["id"]),
            row(db, "equipment_reservations", reservation["id"]))
    saved = _propose(users, event, changes)

    response = _approve(users, event, saved["id"])

    assert response.status_code == 200, response.json
    assert response.json["change_request"]["significant"] is True
    affected = response.json["affected"]
    # SCRUM-152 adds over_capacity: 150 attendees exceed this venue's capacity (100).
    too_small = affected.pop("over_capacity")
    # SCRUM-48 adds notified_attendees; a pax/venue change reschedules no one, so it is 0.
    assert affected.pop("notified_attendees") == 0
    assert affected == {"venue_bookings": 1, "equipment_reservations": 1}
    assert [venue["booking_id"] for venue in too_small] == (
        [booking["id"]] if "expected_attendance" in changes else [])
    field = next(iter(changes))
    assert row(db, "events", event["id"])[field] == changes[field]
    assert (row(db, "venue_bookings", booking["id"]),
            row(db, "equipment_reservations", reservation["id"])) == kept
    flagged = [n for n in _notifications(db, event["id"])
               if n["notification_type"] == "event_re_review_required"]
    assert len(flagged) == 1 and flagged[0]["recipient_id"] == 2
    assert field.replace("_", " ") in flagged[0]["message"]
    assert "1 venue booking(s) and 1 equipment reservation(s)" in flagged[0]["message"]
    assert "Nothing was cancelled." in flagged[0]["message"]


# AC5: a failure rolls back every part of the approval.
def test_a_failed_apply_leaves_the_event_and_request_unchanged(live):  # noqa: F811
    db, users, _, make_event, _ = live
    event = make_event(status="Confirmed")
    # Bypass the API's validation to make the event table itself refuse the value.
    bad = db.table("event_change_requests").insert({
        "event_id": event["id"], "requested_by": 1, "description": "Bad value",
        "requested_changes": {"title": "Should not stick", "expected_attendance": -5},
    }).execute().data[0]
    before = (row(db, "events", event["id"]), _history(db, event["id"]),
              _notifications(db, event["id"]))

    response = _approve(users, event, bad["id"])

    assert response.status_code == 503
    assert "The event was not changed" in response.json["error"]
    assert (row(db, "events", event["id"]), _history(db, event["id"]),
            _notifications(db, event["id"])) == before
    stored = row(db, "event_change_requests", bad["id"])
    assert (stored["status"], stored["reviewed_by"], stored["applied_changes"]) == (
        "Pending", None, None)


def test_values_already_in_place_are_not_reported_as_applied(live):  # noqa: F811
    db, users, _, make_event, _ = live
    event = make_event(status="Planning")
    saved = _propose(users, event, {"expected_attendance": 75})
    db.table("events").update({"expected_attendance": 75}).eq("id", event["id"]).execute()

    response = _approve(users, event, saved["id"])

    assert response.status_code == 200
    stored = row(db, "event_change_requests", saved["id"])
    assert (stored["applied_changes"], stored["significant"]) == ({}, False)
    assert all(n["notification_type"] != "event_re_review_required"
               for n in _notifications(db, event["id"]))


def test_the_database_function_rechecks_every_rule(live):  # noqa: F811
    db, users, _, make_event, _ = live
    event = make_event(status="Confirmed")
    saved = _propose(users, event, {"title": "Checked title"})
    other = db.table("app_users").select("id").eq("role", "Coordinator").neq(
        "id", 2).limit(1).execute().data
    described = users[1].post(f"/events/{event['id']}/change-requests",
                              json={"description": "Just a note"}, headers=ORIGIN).json

    cases = [
        ((event["id"], saved["id"], 1), "PT403"),
        ((event["id"], 999_999_999, 2), "PT404"),
        ((event["id"], described["change_request"]["id"], 2), "PT409"),
    ]
    if other:
        cases.append(((event["id"], saved["id"], other[0]["id"]), "PT403"))
    for (event_id, request_id, actor), code in cases:
        with pytest.raises(APIError) as error:
            _rpc(db, event_id, request_id, actor)
        assert error.value.code == code
    with pytest.raises(APIError) as error:
        _rpc(db, event["id"], saved["id"], note="x" * 2001)
    assert error.value.code == "22023"
    assert row(db, "event_change_requests", saved["id"])["status"] == "Pending"

    assert _rpc(db, event["id"], saved["id"]).data["change_request"]["status"] == "Approved"
    with pytest.raises(APIError) as error:
        _rpc(db, event["id"], saved["id"])
    assert (error.value.code, error.value.message) == ("PT409", "already_reviewed")

    closed = make_event(status="Confirmed")
    pending = _propose(users, closed, {"title": "Too late"})
    db.table("events").update({"status": "Completed"}).eq("id", closed["id"]).execute()
    with pytest.raises(APIError) as error:
        _rpc(db, closed["id"], pending["id"])
    assert (error.value.code, error.value.message) == ("PT409", "closed_event")


def test_stored_proposals_are_constrained(live):  # noqa: F811
    db, _, _, make_event, _ = live
    event = make_event()
    # organiser_id is not a changeable field (SCRUM-48 allows event_datetime, so it is no
    # longer a rejection case).
    for bad in ({"requested_changes": {"organiser_id": 9}},
                {"requested_changes": {}}, {"requested_changes": ["title"]},
                {"applied_changes": {}, "significant": False},
                {"status": "Approved", "applied_changes": {}}):
        with pytest.raises(APIError) as error:
            db.table("event_change_requests").insert({
                "event_id": event["id"], "requested_by": 1, "description": "x", **bad,
            }).execute()
        assert error.value.code == "23514"


def test_marking_an_applied_change_implemented_keeps_its_record(live):  # noqa: F811
    db, users, _, make_event, _ = live
    event = make_event(status="Confirmed")
    saved = _propose(users, event, {"expected_attendance": 90})
    assert _approve(users, event, saved["id"]).status_code == 200

    done = users[2].patch(f"/events/{event['id']}/change-requests/{saved['id']}",
                          json={"status": "Implemented"}, headers=ORIGIN)

    assert done.status_code == 200, done.json
    stored = row(db, "event_change_requests", saved["id"])
    assert stored["status"] == "Implemented"
    assert stored["significant"] is True
    assert stored["applied_changes"]["expected_attendance"]["to"] == 90


def test_two_simultaneous_approvals_apply_once(live):  # noqa: F811
    db, users, _, make_event, _ = live
    event = make_event(status="Confirmed")
    saved = _propose(users, event, {"expected_attendance": 110})
    barrier = Barrier(2)

    def approve():
        with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as own:
            barrier.wait()
            try:
                _rpc(own, event["id"], saved["id"])
                return "applied"
            except APIError as error:
                return error.message

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = sorted(pool.map(lambda _: approve(), range(2)))

    assert outcomes == ["already_reviewed", "applied"]
    # SCRUM-156: a significant approval is recorded as approved-with-re-review.
    assert len([h for h in _history(db, event["id"])
                if h["action"] in ("change_request_approved",
                                   "change_request_approved_re_review")]) == 1
    assert len([n for n in _notifications(db, event["id"])
                if n["notification_type"] == "event_re_review_required"]) == 1

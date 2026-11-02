"""SCRUM-166 (audit R4) against real PostgreSQL and PostgREST.

An approved date/time change on a Confirmed or Preparation event returns it to Planning
(history + notices, nothing un-booked), so it must be re-confirmed for the new time and
pass the safety check again. The confirm endpoint judges the event's whole time: venue
bookings together, and each Reserved equipment window.
"""

import os

import pytest

from .conftest import ORIGIN
from .test_change_request_apply_acceptance import _approve, _history, _notifications, _propose
from .test_equipment_request_reservations_acceptance import allocation, reserve
from .test_equipment_request_status_acceptance import create_request
from .test_event_completion_acceptance import live, live_requests, row  # noqa: F401

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)

# make_event() events run 2099-10-20 06:00-08:00 UTC (14:00-16:00 SGT).
START, END = "2099-10-20T06:00:00+00:00", "2099-10-20T08:00:00+00:00"
NEW_START = "2099-12-20T06:00:00Z"  # The rescheduled date, same 2-hour length.


def approved_booking(db, event, venue, start=START, end=END):
    return db.table("venue_bookings").insert({
        "venue_id": venue["id"], "event_id": event["id"], "requested_by": 2,
        "start_at": start, "end_at": end, "expected_attendance": 20,
        "layout": "Classroom", "status": "Confirmed",
    }).execute().data[0]


def confirm(users, event):
    return users[2].post(f"/events/{event['id']}/confirm", json={}, headers=ORIGIN)


def reschedule(users, event, when=NEW_START):
    saved = _propose(users, event, {"event_datetime": when})
    response = _approve(users, event, saved["id"])
    assert response.status_code == 200, response.json
    return response


@pytest.mark.parametrize("status", ["Confirmed", "Preparation"])
def test_rescheduling_a_confirmed_or_preparing_event_returns_it_to_planning(live, status):  # noqa: F811
    db, users, _, make_event, venue = live
    event = make_event(status=status)
    kept = approved_booking(db, event, venue)

    reschedule(users, event)

    stored = row(db, "events", event["id"])
    assert stored["status"] == "Planning"
    assert stored["last_status_changed_by"] == 2
    [entry] = [h for h in _history(db, event["id"])
               if h["action"] == "rescheduled_returned_to_planning"]
    assert (entry["old_status"], entry["new_status"], entry["changed_by"]) == (
        status, "Planning", 2)
    # Nothing is cancelled or un-booked (D36): the old booking is still there.
    assert row(db, "venue_bookings", kept["id"])["status"] == "Confirmed"
    messages = {n["notification_type"]: n["message"] for n in _notifications(db, event["id"])}
    assert "back in Planning until the Coordinator re-confirms it" in messages[
        "event_change_request_updated"]
    assert "re-confirm it for the new time" in messages["event_re_review_required"]


def test_after_a_reschedule_the_old_booking_blocks_and_a_new_one_lets_it_confirm(live):  # noqa: F811
    db, users, _, make_event, venue = live
    event = make_event(status="Confirmed")
    approved_booking(db, event, venue)
    reschedule(users, event)

    blocked = confirm(users, event)
    assert blocked.status_code == 409
    assert "no longer match" in blocked.json["error"]
    # The safety check cannot be reached from Planning.
    safety = users[2].post(f"/events/{event['id']}/safety-check",
                           json={"decision": "approve"}, headers=ORIGIN)
    assert safety.status_code in (403, 409)

    # Move the stale booking aside and book the new date: confirmation goes through.
    db.table("venue_bookings").update({"status": "Cancelled"}).eq(
        "event_id", event["id"]).execute()
    approved_booking(db, event, venue, "2099-12-20T06:00:00+00:00", "2099-12-20T08:00:00+00:00")
    assert confirm(users, event).status_code == 200


def test_rescheduling_a_planning_event_adds_no_status_change(live):  # noqa: F811
    db, users, _, make_event, venue = live
    event = make_event(status="Planning")
    reschedule(users, event)
    assert row(db, "events", event["id"])["status"] == "Planning"
    assert not [h for h in _history(db, event["id"])
                if h["action"] == "rescheduled_returned_to_planning"]


def test_a_confirmed_event_keeps_its_status_for_a_non_date_change(live):  # noqa: F811
    # Pax/venue changes stay flag-only (D36 / D43); only date/time resets the status.
    db, users, _, make_event, venue = live
    event = make_event(status="Confirmed")
    approved_booking(db, event, venue)
    saved = _propose(users, event, {"expected_attendance": 30})
    assert _approve(users, event, saved["id"]).status_code == 200
    assert row(db, "events", event["id"])["status"] == "Confirmed"


@pytest.mark.parametrize(("slots", "confirms"), [
    ([(START, END)], True),
    ([(START, "2099-10-20T07:00:00+00:00")], False),                    # 1h of a 2h event
    ([(START, "2099-10-20T07:00:00+00:00"),
      ("2099-10-20T07:00:00+00:00", END)], True),                       # adjacent pair
    ([(START, "2099-10-20T06:30:00+00:00"),
      ("2099-10-20T07:00:00+00:00", END)], False),                      # 30-minute gap
])
def test_confirmation_requires_the_bookings_to_cover_the_whole_event(live, slots, confirms):  # noqa: F811
    db, users, _, make_event, venue = live
    event = make_event(status="Planning")
    for start, end in slots:
        approved_booking(db, event, venue, start, end)

    response = confirm(users, event)

    assert (response.status_code == 200) is confirms, response.json
    if not confirms:
        assert "do not cover the event's full time" in response.json["error"]
        assert row(db, "events", event["id"])["status"] == "Planning"


@pytest.mark.parametrize(("window", "confirms"), [
    ((START, END), True),
    (("2099-10-20T06:00:00Z", "2099-10-20T07:00:00Z"), False),
])
def test_confirmation_requires_reservations_to_cover_the_event(live, window, confirms):  # noqa: F811
    db, users, items, make_event, venue = live
    event = make_event(status="Planning")
    approved_booking(db, event, venue)
    item = {**items[0], "quantity": 1}
    saved = create_request(users, event, [item])
    reserved = reserve(users, saved, allocation(saved, [item], [1],
                                                start_at=window[0], end_at=window[1]))
    assert reserved.status_code == 200, reserved.json

    response = confirm(users, event)

    assert (response.status_code == 200) is confirms, response.json
    if not confirms:
        assert "equipment reservation(s) do not cover" in response.json["error"]

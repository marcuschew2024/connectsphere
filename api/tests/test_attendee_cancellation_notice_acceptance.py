"""SCRUM-155 against real PostgreSQL and PostgREST: a registered attendee's Home panel
(GET /events/registration-confirmations) includes the cancellation notice (S1 Q20, D41)."""

import os

import pytest

from .conftest import ORIGIN
from .test_event_cancellation_acceptance import (  # noqa: F401
    ATTENDEE,
    OTHER_ATTENDEE,
    cancel,
    cancel_db,
    live,
    live_requests,
    register,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


def panel(users, attendee):
    response = users[attendee].get("/events/registration-confirmations", headers=ORIGIN)
    assert response.status_code == 200, response.json
    return response.json["confirmations"]


def test_registered_attendee_sees_the_cancellation_on_their_panel(cancel_db):  # noqa: F811
    db, users, _, _, make_registrable_event, _, _ = cancel_db
    event = make_registrable_event()
    register(db, event, ATTENDEE)
    register(db, event, OTHER_ATTENDEE, withdrawn=True)

    assert cancel(users[2], event).status_code == 200

    notices = [n for n in panel(users, ATTENDEE) if n["event_id"] == event["id"]]
    # Newest first: the cancellation sits above the original signup confirmation.
    assert notices[0]["notification_type"] == "event_cancelled"
    assert notices[0]["event"]["title"] == event["title"]
    assert [n["notification_type"] for n in notices].count("event_cancelled") == 1
    # Someone who had already withdrawn is not told; organiser decisions never appear.
    assert not [n for n in panel(users, OTHER_ATTENDEE)
                if n["event_id"] == event["id"] and n["notification_type"] == "event_cancelled"]
    assert all(n["notification_type"] in
               {"registration_confirmed", "registration_withdrawn", "event_cancelled"}
               for n in panel(users, ATTENDEE))

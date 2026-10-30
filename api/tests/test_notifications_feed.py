"""API tests for the all-roles notifications feed (SCRUM-49 / R07).

The pure recipient rule is unit-tested in test_notification_visibility.py. These
cover the endpoint wiring after the R07 fix: the Organiser-only gate is gone, so
every authenticated role reads GET /notifications, and each sees only rows
addressed to them (recipient_id) or to their role pool (recipient_role) -- never
another user's personal note or a pool they are not in. The notifications table
is supplied by the shared event_database fixture.
"""

from .conftest import ORIGIN, select_user

pytest_plugins = ("tests.test_events",)

# Seeded demo-user ids (conftest ROLES order): 1 Organiser, 2 Coordinator,
# 3 Venue Staff, 4 Tech Support, 5 Attendee.


def _seed(event_database, **row):
    event_database[1].notifications.append(row)


# A Venue Staff member reads the Venue Staff pool, not an Organiser's personal note.
def test_venue_staff_sees_their_pool_not_others(app, event_database):
    _seed(event_database, recipient_role="Venue Staff",
          event_id="e1", notification_type="venue_booking_requested",
          message="A new venue booking needs review.")
    _seed(event_database, recipient_id=1,
          event_id="e1", notification_type="event_approved",
          message="Organiser private note.")

    client = app.test_client()
    select_user(client, 3)
    response = client.get("/notifications", headers=ORIGIN)

    assert response.status_code == 200
    messages = [n["message"] for n in response.json["notifications"]]
    assert messages == ["A new venue booking needs review."]


# Pool isolation: Tech Support does not see the Venue Staff pool.
def test_pools_are_isolated_from_each_other(app, event_database):
    _seed(event_database, recipient_role="Venue Staff",
          event_id="e1", notification_type="venue_booking_requested",
          message="Venue pool item.")
    _seed(event_database, recipient_role="Tech Support",
          event_id="e1", notification_type="equipment_request_submitted",
          message="Equipment pool item.")

    client = app.test_client()
    select_user(client, 4)
    response = client.get("/notifications", headers=ORIGIN)

    assert response.status_code == 200
    messages = [n["message"] for n in response.json["notifications"]]
    assert messages == ["Equipment pool item."]


# An Attendee sees their own note but never an internal staff pool.
def test_attendee_sees_own_note_not_internal_pool(app, event_database):
    _seed(event_database, recipient_id=5,
          event_id="e1", notification_type="event_cancelled",
          message="Your event was cancelled.")
    _seed(event_database, recipient_role="Venue Staff",
          event_id="e1", notification_type="venue_booking_requested",
          message="Internal venue pool item.")

    client = app.test_client()
    select_user(client, 5)
    response = client.get("/notifications", headers=ORIGIN)

    assert response.status_code == 200
    messages = [n["message"] for n in response.json["notifications"]]
    assert messages == ["Your event was cancelled."]

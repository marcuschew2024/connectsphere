"""Unit and API integration tests for SCRUM-19 event status and history."""

import pytest

from app.event_status import EventStatus, canonical_event_status, customer_event_status
from app.events import event_response

from .conftest import ORIGIN, select_user
from .test_events import _seed_planning_event

pytest_plugins = ("tests.test_events",)


# Each stored workflow state maps to the expected coordinator-visible state.
@pytest.mark.parametrize(
    ("stored_status", "expected_status"),
    [
        ("Draft", "Draft"),
        ("Submitted", "Submitted"),
        ("Assigned", "Submitted"),
        ("Under review", "Submitted"),
        ("Under Review", "Submitted"),
        ("Approved", "Planning"),
        ("Planning", "Planning"),
        ("Confirmed", "Confirmed"),
        ("Completed", "Completed"),
        ("Rejected", "Rejected"),
        ("Cancelled", "Cancelled"),
    ],
)
def test_canonical_status_maps_each_known_workflow_state(stored_status, expected_status):
    assert canonical_event_status(stored_status) == expected_status


# Missing or unknown states take the documented Planning fallback branch.
@pytest.mark.parametrize("stored_status", [None, "", "  ", "Unexpected state"])
def test_canonical_status_falls_back_to_planning(stored_status):
    assert EventStatus.to_visible(stored_status) == "Planning"


# Only Completed, Rejected, and Cancelled are terminal states.
@pytest.mark.parametrize("status", ["Completed", "Rejected", "Cancelled"])
def test_terminal_statuses_are_classified_as_terminal(status):
    assert EventStatus.is_terminal(status) is True


@pytest.mark.parametrize(
    "status", ["Draft", "Submitted", "Assigned", "Approved", "Planning", "Confirmed", None]
)
def test_nonterminal_statuses_are_not_classified_as_terminal(status):
    assert EventStatus.is_terminal(status) is False


# Customers see all internal review states as Planning; other values remain unchanged.
@pytest.mark.parametrize(
    ("stored_status", "expected_status"),
    [
        ("Submitted", "Planning"),
        ("Assigned", "Planning"),
        ("Under review", "Planning"),
        ("Under Review", "Planning"),
        ("Approved", "Planning"),
        ("Planning", "Planning"),
        ("Confirmed", "Confirmed"),
        ("Completed", "Completed"),
        ("Rejected", "Rejected"),
        ("Cancelled", "Cancelled"),
        ("Draft", "Draft"),
    ],
)
def test_customer_status_hides_internal_review_states(stored_status, expected_status):
    assert customer_event_status(stored_status) == expected_status


# Coordinators retain queue status; organisers see Submitted as Planning.
def test_event_response_shows_status_per_coordinator_and_organiser_role():
    event = {
        "id": "status-role-test",
        "title": "Workshop",
        "status": "Submitted",
        "organiser_id": 1,
        "coordinator_id": 2,
        "last_status_changed_by": 2,
        "last_status_changed_at": "2026-09-27T10:00:00+00:00",
    }

    coordinator_view = event_response(event, {"id": 2, "role": "Coordinator"})
    organiser_view = event_response(event, {"id": 1, "role": "Organiser"})

    assert coordinator_view["status"] == "Submitted"
    assert organiser_view["status"] == "Planning"
    assert organiser_view["request_status"] == "Submitted"


# Attendees receive only public event fields and the customer-facing status.
def test_event_response_limits_attendee_fields():
    event = {
        "id": "attendee-view-test",
        "title": "Workshop",
        "description": "Public details",
        "category": "Workshop",
        "event_datetime": "2026-10-20T10:00:00+00:00",
        "status": "Submitted",
        "organiser_id": 1,
        "coordinator_id": 2,
        "last_status_changed_by": 2,
        "last_status_changed_at": "2026-09-27T10:00:00+00:00",
    }

    response = event_response(event, {"id": 5, "role": "Attendee"})

    assert response == {
        "id": "attendee-view-test",
        "title": "Workshop",
        "description": "Public details",
        "category": "Workshop",
        "event_datetime": "2026-10-20T10:00:00+00:00",
        "status": "Planning",
    }


# An organiser sees Submitted as Planning when retrieving an event by ID.
def test_organiser_gets_customer_status_for_submitted_event(app, event_database):
    client = app.test_client()
    select_user(client, 1)
    event = _seed_planning_event(event_database, status="Submitted")

    response = client.get(f"/events/{event['id']}", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Planning"
    assert response.json["event"]["request_status"] == "Submitted"


# A Coordinator retains Submitted so the request stays visible in the review queue.
def test_coordinator_gets_internal_submitted_status_for_event(app, event_database):
    client = app.test_client()
    select_user(client, 2)
    event = _seed_planning_event(event_database, status="Submitted")

    response = client.get(f"/events/{event['id']}", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Submitted"


# Related event lists show only the user's requests and normalize Submitted for customers.
def test_related_user_list_filters_events_and_shows_customer_status(app, event_database):
    client = app.test_client()
    select_user(client, 1)
    event_database[0].extend([
        {
            "id": "88888888-8888-8888-8888-888888888888",
            "title": "Organised event",
            "status": "Submitted",
            "organiser_id": 1,
            "coordinator_id": None,
        },
        {
            "id": "99999999-9999-9999-9999-999999999999",
            "title": "Unrelated event",
            "status": "Confirmed",
            "organiser_id": 3,
            "coordinator_id": 2,
        },
    ])

    response = client.get("/events", headers=ORIGIN)

    assert response.status_code == 200
    assert [event["id"] for event in response.json["events"]] == [
        "88888888-8888-8888-8888-888888888888"
    ]
    assert response.json["events"][0]["status"] == "Planning"


# Confirmed and terminal statuses remain unchanged for related users.
@pytest.mark.parametrize("status", ["Confirmed", "Completed", "Rejected", "Cancelled"])
def test_terminal_and_confirmed_statuses_remain_visible(app, event_database, status):
    client = app.test_client()
    select_user(client, 1)
    event = _seed_planning_event(event_database, status=status)

    response = client.get(f"/events/{event['id']}", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["event"]["status"] == status


# An unrelated user cannot retrieve status details.
def test_unrelated_user_cannot_view_event_status(app, event_database):
    client = app.test_client()
    select_user(client, 3)
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.get(f"/events/{event['id']}", headers=ORIGIN)

    assert response.status_code == 403


# An unauthenticated caller cannot retrieve an event's status.
def test_event_status_requires_a_session(app, event_database):
    event = _seed_planning_event(event_database, status="Confirmed")

    response = app.test_client().get(f"/events/{event['id']}", headers=ORIGIN)

    assert response.status_code == 401


# A missing event returns 404 from the detail endpoint.
def test_missing_event_status_returns_not_found(app):
    client = app.test_client()
    select_user(client, 1)

    response = client.get(
        "/events/00000000-0000-0000-0000-000000000000", headers=ORIGIN
    )

    assert response.status_code == 404


# Event detail reads require the configured frontend origin.
@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example"}])
def test_event_status_rejects_untrusted_origin(app, event_database, headers):
    event = _seed_planning_event(event_database, status="Confirmed")
    client = app.test_client()
    select_user(client, 1)

    response = client.get(f"/events/{event['id']}", headers=headers)

    assert response.status_code == 403


# A Coordinator cannot use event membership to view a private Organiser draft.
def test_event_draft_is_private_from_coordinator(app, event_database):
    event = _seed_planning_event(event_database, status="Draft")
    client = app.test_client()
    select_user(client, 2)

    response = client.get(f"/events/{event['id']}", headers=ORIGIN)

    assert response.status_code == 404


# A related user update records the latest actor and timestamp.
def test_related_user_can_update_status_and_actor_metadata(app, event_database):
    client = app.test_client()
    select_user(client, 1)
    event = _seed_planning_event(event_database, status="Submitted")

    response = client.patch(
        f"/events/{event['id']}/status", json={"status": "Confirmed"}, headers=ORIGIN
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Confirmed"
    assert response.json["event"]["last_status_changed_by"] == 1
    assert response.json["event"]["last_status_changed_at"]


# A status change appends a history entry with the old/new states, actor, and timestamp.
def test_related_user_status_change_is_added_to_history(app, event_database):
    client = app.test_client()
    select_user(client, 1)
    event = _seed_planning_event(event_database, status="Submitted")

    update = client.patch(
        f"/events/{event['id']}/status", json={"status": "Confirmed"}, headers=ORIGIN
    )
    history = client.get(f"/events/{event['id']}/history", headers=ORIGIN)

    assert update.status_code == 200
    assert history.status_code == 200
    assert len(history.json["history"]) == 1
    assert history.json["history"][0]["event_id"] == event["id"]
    assert history.json["history"][0]["old_status"] == "Submitted"
    assert history.json["history"][0]["new_status"] == "Confirmed"
    assert history.json["history"][0]["changed_by"] == 1
    assert history.json["history"][0]["changed_at"]


# Stored participants can retrieve history even when they are neither owner nor coordinator.
def test_event_participant_can_view_event_history(app, event_database):
    client = app.test_client()
    select_user(client, 4)
    event = _seed_planning_event(event_database, status="Confirmed", coordinator_id=None)
    event_database[1].participants.append({
        "event_id": event["id"], "user_id": 4, "role": "Tech Support",
    })

    response = client.get(f"/events/{event['id']}/history", headers=ORIGIN)

    assert response.status_code == 200


# Unrelated users must not read an event's status history.
def test_unrelated_user_cannot_view_event_history(app, event_database):
    client = app.test_client()
    select_user(client, 3)
    event = _seed_planning_event(event_database, status="Confirmed")

    response = client.get(f"/events/{event['id']}/history", headers=ORIGIN)

    assert response.status_code == 403


# Status history requests require the configured frontend origin.
@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example"}])
def test_event_history_rejects_untrusted_origin(app, event_database, headers):
    event = _seed_planning_event(event_database, status="Confirmed")
    client = app.test_client()
    select_user(client, 1)

    response = client.get(f"/events/{event['id']}/history", headers=headers)

    assert response.status_code == 403


# Invalid requested statuses are rejected without applying an update.
def test_status_update_rejects_invalid_status(app, event_database):
    client = app.test_client()
    select_user(client, 1)
    event = _seed_planning_event(event_database, status="Submitted")

    response = client.patch(
        f"/events/{event['id']}/status", json={"status": "Not a status"}, headers=ORIGIN
    )

    assert response.status_code == 400


# An unauthenticated caller cannot change an event status.
def test_status_update_requires_a_session(app, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = app.test_client().patch(
        f"/events/{event['id']}/status", json={"status": "Confirmed"}, headers=ORIGIN
    )

    assert response.status_code == 401


# Status changes require the configured frontend origin.
@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example"}])
def test_status_update_rejects_untrusted_origin(app, event_database, headers):
    event = _seed_planning_event(event_database, status="Submitted")
    client = app.test_client()
    select_user(client, 1)

    response = client.patch(
        f"/events/{event['id']}/status", json={"status": "Confirmed"}, headers=headers
    )

    assert response.status_code == 403
    assert event["status"] == "Submitted"


# A status change cannot bypass the separate draft-submission workflow.
def test_draft_cannot_be_changed_through_status_endpoint(app, event_database):
    event = _seed_planning_event(event_database, status="Draft")
    client = app.test_client()
    select_user(client, 1)

    response = client.patch(
        f"/events/{event['id']}/status", json={"status": "Confirmed"}, headers=ORIGIN
    )

    assert response.status_code == 409
    assert event["status"] == "Draft"


# An unrelated user cannot update a related event's status.
def test_unrelated_user_cannot_update_event_status(app, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    client = app.test_client()
    select_user(client, 3)

    response = client.patch(
        f"/events/{event['id']}/status", json={"status": "Confirmed"}, headers=ORIGIN
    )

    assert response.status_code == 403
    assert event["status"] == "Submitted"


# Malformed status update payloads are rejected without applying an update.
@pytest.mark.parametrize("payload", [None, [], {"status": "Confirmed", "extra": True}])
def test_status_update_rejects_malformed_payload(app, event_database, payload):
    client = app.test_client()
    select_user(client, 1)
    event = _seed_planning_event(event_database, status="Submitted")

    response = client.patch(
        f"/events/{event['id']}/status", json=payload, headers=ORIGIN
    )

    assert response.status_code == 400
    assert event["status"] == "Submitted"


# An unauthenticated caller cannot view status history.
def test_event_history_requires_a_session(app, event_database):
    event = _seed_planning_event(event_database, status="Confirmed")

    response = app.test_client().get(f"/events/{event['id']}/history", headers=ORIGIN)

    assert response.status_code == 401


# A missing event returns 404 from the history endpoint.
def test_missing_event_history_returns_not_found(app):
    client = app.test_client()
    select_user(client, 1)

    response = client.get(
        "/events/00000000-0000-0000-0000-000000000000/history", headers=ORIGIN
    )

    assert response.status_code == 404

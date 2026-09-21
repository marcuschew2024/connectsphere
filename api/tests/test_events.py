"""SCRUM-14 route tests: use real Flask sessions with a fake Supabase client."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app import create_app
from app.event_validation import TEXT_LIMITS

from .conftest import ORIGIN, select_user


@pytest.fixture(autouse=True)
def event_database(monkeypatch):
    rows = []
    participants = []
    history = []
    edit_log = []
    notifications = []
    client = MagicMock()

    def table(name):
        assert name in {
            "events",
            "event_participants",
            "event_status_history",
            "event_edit_log",
            "notifications",
        }
        query = MagicMock()
        filters = {}
        operation = "select"
        pending_insert = None
        pending_update = None
        pending_upsert = None
        related_user_id = None

        def equals(column, value):
            filters[column] = value
            return query

        def execute():
            if operation == "insert":
                if name == "event_status_history":
                    history_row = {
                        **pending_insert,
                        "id": len(history) + 1,
                        "changed_at": datetime.now(UTC).isoformat(),
                    }
                    history.append(history_row)
                    return SimpleNamespace(data=[history_row])
                if name == "event_edit_log":
                    edit_row = {
                        **pending_insert,
                        "id": len(edit_log) + 1,
                        "occurred_at": datetime.now(UTC).isoformat(),
                    }
                    edit_log.append(edit_row)
                    return SimpleNamespace(data=[edit_row])
                if name == "notifications":
                    notification = {
                        **pending_insert,
                        "id": len(notifications) + 1,
                        "created_at": datetime.now(UTC).isoformat(),
                    }
                    notifications.append(notification)
                    return SimpleNamespace(data=[notification])
                now = datetime.now(UTC).isoformat()
                row = {
                    **pending_insert, "id": str(uuid4()), "coordinator_id": None,
                    "created_at": now, "updated_at": now,
                }
                rows.append(row)
                return SimpleNamespace(data=[row])

            if operation == "update":
                matching = [
                    row for row in rows
                    if all(row.get(key) == value for key, value in filters.items())
                ]
                for row in matching:
                    row.update(pending_update)
                return SimpleNamespace(data=matching)

            if operation == "upsert":
                participants[:] = [
                    row for row in participants
                    if (row["event_id"], row["user_id"])
                    != (pending_upsert["event_id"], pending_upsert["user_id"])
                ]
                participants.append(pending_upsert)
                return SimpleNamespace(data=[pending_upsert])

            if name == "event_participants":
                return SimpleNamespace(data=[
                    row for row in participants
                    if all(row.get(key) == value for key, value in filters.items())
                ])

            if name == "event_status_history":
                return SimpleNamespace(data=[
                    row for row in history
                    if all(row.get(key) == value for key, value in filters.items())
                ])

            if name == "event_edit_log":
                return SimpleNamespace(data=[
                    row for row in edit_log
                    if all(row.get(key) == value for key, value in filters.items())
                ])

            return SimpleNamespace(data=[
                row for row in rows
                if (
                    all(row.get(key) == value for key, value in filters.items())
                    and (
                        related_user_id is None
                        or row.get("organiser_id") == related_user_id
                        or row.get("coordinator_id") == related_user_id
                    )
                )
            ])

        def insert(fields):
            nonlocal operation, pending_insert
            operation = "insert"
            pending_insert = fields
            return query

        def update(fields):
            nonlocal operation, pending_update
            operation = "update"
            pending_update = fields
            return query

        def upsert(fields):
            nonlocal operation, pending_upsert
            operation = "upsert"
            pending_upsert = fields
            return query

        def related_users(expression):
            nonlocal related_user_id
            related_user_id = int(expression.split("eq.")[1].split(",")[0])
            return query

        query.insert.side_effect = insert
        query.update.side_effect = update
        query.upsert.side_effect = upsert
        query.select.return_value = query
        query.eq.side_effect = equals
        query.or_.side_effect = related_users
        query.order.return_value = query
        query.execute.side_effect = execute
        return query

    client.table.side_effect = table
    client.participants = participants
    client.edit_log = edit_log
    client.notifications = notifications
    monkeypatch.setattr("app.event_repository.get_supabase_client", lambda: client)
    return rows, client


@pytest.fixture
def organiser(app):
    client = app.test_client()
    assert select_user(client, 1).status_code == 200
    return client


@pytest.fixture
def details():
    return {
        "title": "  Campus workshop  ", "description": "Learn something together.",
        "purpose": "Share skills", "category": "Workshop",
        "event_datetime": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
        "expected_attendance": 50,
        "venue_requirements": "Room for 50", "accessibility_requirements": "Step-free access",
        "equipment_requirements": "Projector", "registration_requirements": "RSVP required",
    }


def test_submit_persists_details_identity_status_and_timestamps(organiser, details, event_database):
    response = organiser.post("/events", json=details, headers=ORIGIN)
    assert response.status_code == 201
    event = response.json["event"]
    assert event["id"]
    assert event["status"] == "Submitted"
    assert event["title"] == "Campus workshop"
    assert event["organiser_id"] == 1
    assert event["coordinator_id"] is None
    assert event["submitted_at"]
    assert event["created_at"]
    for field in ("description", "purpose", "category", "venue_requirements",
                  "accessibility_requirements", "equipment_requirements",
                  "registration_requirements"):
        assert event[field] == details[field]
    assert event_database[0] == [event]
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("field", [
    "title", "description", "purpose", "category", "event_datetime", "expected_attendance",
])
def test_each_required_field_blocks_submission(organiser, details, event_database, field):
    details.pop(field)
    response = organiser.post("/events", json=details, headers=ORIGIN)
    assert response.status_code == 400
    assert field in response.json["fields"]
    assert event_database[0] == []


@pytest.mark.parametrize("partial", [{}, {"title": "Idea for later"}])
def test_incomplete_draft_can_be_saved(organiser, event_database, partial):
    response = organiser.post("/events", json={"action": "draft", **partial}, headers=ORIGIN)
    assert response.status_code == 201
    event = response.json["event"]
    assert event["status"] == "Draft"
    assert event["organiser_id"] == 1
    assert event["submitted_at"] is None
    assert event["event_datetime"] is None
    assert event["expected_attendance"] is None
    assert len(event_database[0]) == 1


@pytest.mark.parametrize("value", [0, -5, "abc", "1", 1.5, True, [], {}, 2_147_483_648])
@pytest.mark.parametrize("action", ["draft", "submit"])
def test_attendance_must_be_a_positive_integer(organiser, details, event_database, value, action):
    details.update(expected_attendance=value, action=action)
    response = organiser.post("/events", json=details, headers=ORIGIN)
    assert response.status_code == 400
    assert "expected_attendance" in response.json["fields"]
    assert event_database[0] == []


def test_attendance_one_is_accepted(organiser, details):
    details["expected_attendance"] = 1
    assert organiser.post("/events", json=details, headers=ORIGIN).status_code == 201


@pytest.mark.parametrize("value", [
    "2020-01-01T10:00:00+08:00", "2099-01-01T10:00", "2099-01-01", "invalid", [], {},
    "2099-02-30T10:00:00Z", "0001-01-01T00:00:00+14:00",
])
def test_past_or_invalid_times_are_rejected(organiser, details, event_database, value):
    details["event_datetime"] = value
    response = organiser.post("/events", json=details, headers=ORIGIN)
    assert response.status_code == 400
    assert "event_datetime" in response.json["fields"]
    assert event_database[0] == []


def test_today_future_time_accepted_and_offset_converted(organiser, details, monkeypatch):
    class FixedClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 9, 20, 4, 0, tzinfo=UTC)

    monkeypatch.setattr("app.event_validation.datetime", FixedClock)
    details["event_datetime"] = "2026-09-20T13:00:00+08:00"
    response = organiser.post("/events", json=details, headers=ORIGIN)
    assert response.status_code == 201
    assert response.json["event"]["event_datetime"] == "2026-09-20T05:00:00+00:00"
    details["event_datetime"] = "2026-09-20T11:59:00+08:00"
    assert organiser.post("/events", json=details, headers=ORIGIN).status_code == 400


@pytest.mark.parametrize("field", list(TEXT_LIMITS))
def test_text_lengths_are_limited(organiser, details, event_database, field):
    details[field] = "x" * (TEXT_LIMITS[field] + 1)
    response = organiser.post("/events", json=details, headers=ORIGIN)
    assert response.status_code == 400
    assert field in response.json["fields"]
    assert event_database[0] == []


@pytest.mark.parametrize("value", [[], {}, True, 12])
def test_non_text_details_are_rejected(organiser, details, value):
    details["description"] = value
    response = organiser.post("/events", json=details, headers=ORIGIN)
    assert response.status_code == 400
    assert "description" in response.json["fields"]


def test_whitespace_is_not_a_required_value(organiser, details):
    details["title"] = " \n\t "
    response = organiser.post("/events", json=details, headers=ORIGIN)
    assert response.status_code == 400
    assert "title" in response.json["fields"]


@pytest.mark.parametrize("user_id", [2, 3, 4, 5])
def test_other_roles_cannot_create_events(app, details, event_database, user_id):
    client = app.test_client()
    select_user(client, user_id)
    assert client.post("/events", json=details, headers=ORIGIN).status_code == 403
    assert event_database[0] == []


def test_no_session_cannot_create_events(app, details, event_database):
    assert app.test_client().post("/events", json=details, headers=ORIGIN).status_code == 401
    assert event_database[0] == []


@pytest.mark.parametrize("field", [
    "organiser_id", "coordinator_id", "role", "status", "id", "created_at", "submitted_at",
])
def test_clients_cannot_spoof_server_fields(organiser, details, event_database, field):
    details[field] = "forged"
    assert organiser.post("/events", json=details, headers=ORIGIN).status_code == 400
    assert event_database[0] == []


def test_second_organiser_owns_their_own_event(app, database, details):
    database[0].append({"id": 6, "role": "Organiser", "display_name": "Second", "is_demo": True})
    first, second = app.test_client(), app.test_client()
    select_user(first, 1)
    select_user(second, 6)
    assert first.post("/events", json=details, headers=ORIGIN).json["event"]["organiser_id"] == 1
    assert second.post("/events", json=details, headers=ORIGIN).json["event"]["organiser_id"] == 6


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example"}])
def test_other_origins_are_denied(organiser, details, event_database, headers):
    assert organiser.post("/events", json=details, headers=headers).status_code == 403
    assert event_database[0] == []


@pytest.mark.parametrize("environment,enabled", [("production", True), ("development", False)])
def test_dev_cookie_cannot_authorise_when_switcher_disabled(
    details, event_database, environment, enabled,
):
    app = create_app({
        "TESTING": True, "SECRET_KEY": "test-only-secret", "APP_ENV": environment,
        "DEV_ROLE_SWITCHER_ENABLED": enabled, "FRONTEND_ORIGIN": ORIGIN["Origin"],
    })
    client = app.test_client()
    with client.session_transaction() as session:
        session["acting_user_id"] = 1
    assert client.post("/events", json=details, headers=ORIGIN).status_code == 401
    assert event_database[0] == []


@pytest.mark.parametrize("payload", [None, [], "event", {"action": "delete"}, {"action": []}])
def test_bad_payloads_are_json_errors(organiser, event_database, payload):
    response = organiser.post("/events", json=payload, headers=ORIGIN)
    assert response.status_code == 400
    assert response.is_json
    assert event_database[0] == []


def test_database_failure_does_not_claim_success_or_leak_details(
    organiser, details, event_database,
):
    event_database[1].table.side_effect = RuntimeError("secret-database-details")
    response = organiser.post("/events", json=details, headers=ORIGIN)
    assert response.status_code == 503
    assert "secret-database-details" not in response.get_data(as_text=True)
    assert "event" not in response.json


def test_unconfigured_database_returns_json_error(organiser, details, monkeypatch):
    monkeypatch.setattr("app.event_repository.get_supabase_client", lambda: None)
    response = organiser.post("/events", json=details, headers=ORIGIN)
    assert response.status_code == 503
    assert response.is_json


def test_event_status_submitted_is_shown_as_submitted(app, event_database):
    client = app.test_client()
    select_user(client, 1)

    event_id = "11111111-1111-1111-1111-111111111111"
    event_database[0].append({
        "id": event_id,
        "title": "Workshop",
        "status": "Submitted",
        "organiser_id": 1,
        "coordinator_id": 2,
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    })

    response = client.get(f"/events/{event_id}", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["event"]["status"] == "Submitted"


def test_related_user_can_list_event_requests(app, event_database):
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
    assert response.json["events"][0]["status"] == "Submitted"


def test_event_status_approved_is_shown_as_planning(app, event_database):
    client = app.test_client()
    select_user(client, 1)

    event_id = "22222222-2222-2222-2222-222222222222"
    event_database[0].append({
        "id": event_id,
        "title": "Workshop",
        "status": "Approved",
        "organiser_id": 1,
        "coordinator_id": 2,
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    })

    response = client.get(f"/events/{event_id}", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["event"]["status"] == "Planning"


def test_event_status_confirmed_is_visible(app, event_database):
    client = app.test_client()
    select_user(client, 1)

    event_id = "33333333-3333-3333-3333-333333333333"
    event_database[0].append({
        "id": event_id,
        "title": "Workshop",
        "status": "Confirmed",
        "organiser_id": 1,
        "coordinator_id": 2,
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    })

    response = client.get(f"/events/{event_id}", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["event"]["status"] == "Confirmed"


@pytest.mark.parametrize("state", ["Completed", "Rejected", "Cancelled"])
def test_terminal_statuses_are_not_rewritten(app, event_database, state):
    client = app.test_client()
    select_user(client, 1)

    event_id = f"44444444-4444-4444-4444-{state[:8].rjust(12, '0')}"
    event_database[0].append({
        "id": event_id,
        "title": "Workshop",
        "status": state,
        "organiser_id": 1,
        "coordinator_id": 2,
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    })

    response = client.get(f"/events/{event_id}", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["event"]["status"] == state


def test_unrelated_user_cannot_view_event_status(app, event_database):
    client = app.test_client()
    select_user(client, 3)

    event_id = "55555555-5555-5555-5555-555555555555"
    event_database[0].append({
        "id": event_id,
        "title": "Workshop",
        "status": "Confirmed",
        "organiser_id": 1,
        "coordinator_id": 2,
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    })

    response = client.get(f"/events/{event_id}", headers=ORIGIN)
    assert response.status_code == 403


def test_related_user_can_update_status_and_actor_metadata(app, event_database):
    client = app.test_client()
    select_user(client, 1)
    event_id = "66666666-6666-6666-6666-666666666666"
    event_database[0].append({
        "id": event_id,
        "title": "Workshop",
        "status": "Submitted",
        "organiser_id": 1,
        "coordinator_id": 2,
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    })

    response = client.patch(
        f"/events/{event_id}/status",
        json={"status": "Confirmed"},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Confirmed"
    assert response.json["event"]["last_status_changed_by"] == 1
    assert response.json["event"]["last_status_changed_at"]


def test_status_history_is_available_to_related_user(app, event_database):
    client = app.test_client()
    select_user(client, 1)
    event_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    event_database[0].append({
        "id": event_id,
        "title": "Workshop",
        "status": "Submitted",
        "organiser_id": 1,
        "coordinator_id": 2,
    })

    update = client.patch(
        f"/events/{event_id}/status",
        json={"status": "Confirmed"},
        headers=ORIGIN,
    )
    history = client.get(f"/events/{event_id}/history", headers=ORIGIN)

    assert update.status_code == 200
    assert history.status_code == 200
    assert len(history.json["history"]) == 1
    assert history.json["history"][0]["event_id"] == event_id
    assert history.json["history"][0]["old_status"] == "Submitted"
    assert history.json["history"][0]["new_status"] == "Confirmed"
    assert history.json["history"][0]["changed_by"] == 1
    assert history.json["history"][0]["changed_at"]


def test_event_participant_can_view_event_history(app, event_database):
    client = app.test_client()
    select_user(client, 4)
    event_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    event_database[0].append({
        "id": event_id,
        "title": "Workshop",
        "status": "Confirmed",
        "organiser_id": 1,
        "coordinator_id": None,
    })
    event_database[1].participants.append(
        {"event_id": event_id, "user_id": 4, "role": "Tech Support"}
    )

    response = client.get(f"/events/{event_id}/history", headers=ORIGIN)

    assert response.status_code == 200


def test_status_update_rejects_invalid_status(app, event_database):
    client = app.test_client()
    select_user(client, 1)
    event_id = "77777777-7777-7777-7777-777777777777"
    event_database[0].append({
        "id": event_id,
        "title": "Workshop",
        "status": "Submitted",
        "organiser_id": 1,
        "coordinator_id": 2,
    })

    response = client.patch(
        f"/events/{event_id}/status",
        json={"status": "Not a status"},
        headers=ORIGIN,
    )

    assert response.status_code == 400


# --- SCRUM-23: Edit event info during Planning (TC-US4.6-01..05) ----------------------

@pytest.fixture
def coordinator(app):
    client = app.test_client()
    assert select_user(client, 2).status_code == 200
    return client


def _seed_planning_event(event_database, *, status="Planning", coordinator_id=2):
    """Put one event straight into the fake DB (coordinator 2, in Planning by default)."""
    now = datetime.now(UTC).isoformat()
    event = {
        "id": str(uuid4()),
        "title": "Original title", "description": "Original description",
        "purpose": "Original purpose", "category": "Workshop",
        "event_datetime": (datetime.now(UTC) + timedelta(days=5)).isoformat(),
        "expected_attendance": 40,
        "venue_requirements": "Main hall", "accessibility_requirements": "Ramp access",
        "equipment_requirements": "Microphone", "registration_requirements": "RSVP",
        "status": status, "organiser_id": 1, "coordinator_id": coordinator_id,
        "created_at": now, "updated_at": now, "submitted_at": now,
        "last_status_changed_by": 1, "last_status_changed_at": now,
    }
    event_database[0].append(event)
    return event


def test_coordinator_can_approve_submitted_request(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "approve"},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Planning"
    assert response.json["event"]["decision_by"] == 2
    assert response.json["event"]["decision_at"]


def test_reject_without_reason_is_blocked(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "reject"},
        headers=ORIGIN,
    )

    assert response.status_code == 400
    assert event_database[0][0]["status"] == "Submitted"


def test_rejection_stores_reason_and_notifies_organiser(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "reject", "reason": "The venue is unavailable."},
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json["event"]["status"] == "Rejected"
    assert response.json["event"]["decision_reason"] == "The venue is unavailable."
    assert event_database[1].notifications[0]["recipient_id"] == 1


def test_decided_request_cannot_be_decided_again(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Rejected")

    response = coordinator.post(
        f"/events/{event['id']}/decision",
        json={"decision": "approve"},
        headers=ORIGIN,
    )

    assert response.status_code == 409


def test_non_coordinator_cannot_decide_request(organiser, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = organiser.post(
        f"/events/{event['id']}/decision",
        json={"decision": "approve"},
        headers=ORIGIN,
    )

    assert response.status_code == 403
    assert event_database[0][0]["status"] == "Submitted"


def _edit_payload(event, **overrides):
    """The full editable field set (the edit form submits all fields), with overrides applied."""
    payload = {
        name: event[name] for name in (
            "title", "description", "purpose", "category", "event_datetime",
            "expected_attendance", "venue_requirements", "accessibility_requirements",
            "equipment_requirements", "registration_requirements",
        )
    }
    payload.update(overrides)
    return payload


def test_coordinator_edits_event_while_planning(coordinator, event_database):
    event = _seed_planning_event(event_database)
    response = coordinator.patch(
        f"/events/{event['id']}", json=_edit_payload(event, title="Updated title"), headers=ORIGIN
    )
    assert response.status_code == 200
    assert response.json["event"]["title"] == "Updated title"
    assert event_database[0][0]["title"] == "Updated title"  # persisted


def test_edit_records_actor_and_timestamp(coordinator, event_database):
    event = _seed_planning_event(event_database)
    response = coordinator.patch(
        f"/events/{event['id']}", json=_edit_payload(event, description="Revised description"),
        headers=ORIGIN,
    )
    assert response.status_code == 200
    log = event_database[1].edit_log
    assert len(log) == 1
    assert log[0]["editor_id"] == 2
    assert log[0]["occurred_at"]
    assert "description" in log[0]["changed_fields"]


def test_edit_blocked_once_confirmed(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Confirmed")
    response = coordinator.patch(
        f"/events/{event['id']}", json=_edit_payload(event, title="Sneaky change"), headers=ORIGIN
    )
    assert response.status_code == 409
    assert event_database[0][0]["title"] == "Original title"  # unchanged
    assert event_database[1].edit_log == []


def test_non_coordinator_cannot_edit(organiser, event_database):
    event = _seed_planning_event(event_database)
    response = organiser.patch(
        f"/events/{event['id']}", json=_edit_payload(event, title="Not allowed"), headers=ORIGIN
    )
    assert response.status_code == 403
    assert event_database[0][0]["title"] == "Original title"


def test_important_change_is_flagged(coordinator, event_database):
    event = _seed_planning_event(event_database)
    response = coordinator.patch(
        f"/events/{event['id']}", json=_edit_payload(event, expected_attendance=250), headers=ORIGIN
    )
    assert response.status_code == 200
    assert response.json["importance"] == "important"
    assert event_database[1].edit_log[0]["importance"] == "important"


def test_ordinary_change_is_flagged(coordinator, event_database):
    event = _seed_planning_event(event_database)
    response = coordinator.patch(
        f"/events/{event['id']}",
        json=_edit_payload(event, title="Small title tweak"),
        headers=ORIGIN,
    )
    assert response.status_code == 200
    assert response.json["importance"] == "ordinary"

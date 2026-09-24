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
    clarifications = []
    client = MagicMock()

    def table(name):
        assert name in {
            "events",
            "event_participants",
            "event_status_history",
            "event_edit_log",
            "notifications",
            "event_clarifications",
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
                if name == "event_clarifications":
                    clarification = {
                        **pending_insert,
                        "id": len(clarifications) + 1,
                        "requested_at": datetime.now(UTC).isoformat(),
                    }
                    clarifications.append(clarification)
                    return SimpleNamespace(data=[clarification])
                now = datetime.now(UTC).isoformat()
                row = {
                    **pending_insert,
                    "id": str(uuid4()),
                    "coordinator_id": 2 if pending_insert.get("status") == "Submitted" else None,
                    "coordinator_assigned_at": (
                        now if pending_insert.get("status") == "Submitted" else None
                    ),
                    "created_at": now, "updated_at": now,
                }
                rows.append(row)
                return SimpleNamespace(data=[row])

            if operation == "update":
                if name == "event_clarifications":
                    matching = [
                        row for row in clarifications
                        if all(row.get(key) == value for key, value in filters.items())
                    ]
                    for row in matching:
                        row.update(pending_update)
                    return SimpleNamespace(data=matching)
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

            if name == "event_clarifications":
                return SimpleNamespace(data=[
                    row for row in clarifications
                    if all(row.get(key) == value for key, value in filters.items())
                ])

            if name == "notifications":
                return SimpleNamespace(data=[
                    row for row in notifications
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
        query.limit.return_value = query
        query.execute.side_effect = execute
        return query

    client.table.side_effect = table
    def rpc(name, params):
        assert name == "save_event_draft"
        matching = [row for row in rows if row["id"] == params["p_event_id"]
                    and row["organiser_id"] == params["p_organiser_id"]
                    and row["status"] == "Draft"]
        for row in matching:
            now = datetime.now(UTC).isoformat()
            row.update(params["p_details"])
            row["updated_at"] = now
            if params["p_submit"]:
                row.update(status="Submitted", submitted_at=now,
                           coordinator_id=2, coordinator_assigned_at=now,
                           last_status_changed_by=params["p_organiser_id"],
                           last_status_changed_at=now)
                history.append({"id": len(history) + 1, "event_id": row["id"],
                                "old_status": "Draft", "new_status": "Submitted",
                                "changed_by": params["p_organiser_id"], "changed_at": now})
        query = MagicMock()
        query.execute.return_value = SimpleNamespace(data=matching)
        return query

    client.rpc.side_effect = rpc
    client.participants = participants
    client.history = history
    client.edit_log = edit_log
    client.notifications = notifications
    client.clarifications = clarifications
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
    assert event["status"] == "Planning"
    assert event["request_status"] == "Submitted"
    assert event_database[0][0]["status"] == "Submitted"
    assert event["title"] == "Campus workshop"
    assert event["organiser_id"] == 1
    assert event["coordinator_id"] == 2
    assert event["coordinator_assigned_at"]
    assert event["submitted_at"]
    assert event["created_at"]
    for field in ("description", "purpose", "category", "venue_requirements",
                  "accessibility_requirements", "equipment_requirements",
                  "registration_requirements"):
        assert event[field] == details[field]
    stored = event_database[0][0]
    response_details = {
        key: value for key, value in event.items() if key not in {"status", "request_status"}
    }
    assert response_details == {
        key: value for key, value in stored.items() if key != "status"
    }
    assert event_database[1].participants == [
        {"event_id": event["id"], "user_id": 1, "role": "Organiser"},
        {"event_id": event["id"], "user_id": 2, "role": "Coordinator"},
    ]
    assert response.headers["Cache-Control"] == "no-store"


def test_multiple_submissions_have_one_coordinator_each(organiser, details, event_database):
    submitted = [
        organiser.post("/events", json={**details, "title": f"Workshop {number}"}, headers=ORIGIN)
        for number in range(3)
    ]

    assert all(response.status_code == 201 for response in submitted)
    events = [response.json["event"] for response in submitted]
    assert len({event["id"] for event in events}) == 3
    assert all(event["coordinator_id"] == 2 for event in events)
    assert all(event["coordinator_assigned_at"] for event in events)
    assert all(
        [participant for participant in event_database[1].participants
         if participant["event_id"] == event["id"] and participant["role"] == "Coordinator"]
        == [{"event_id": event["id"], "user_id": 2, "role": "Coordinator"}]
        for event in events
    )


def test_no_manual_reassignment_endpoint_exists(app):
    reassignment_routes = {
        rule.rule
        for rule in app.url_map.iter_rules()
        if "assign" in rule.rule.lower() or "reassign" in rule.rule.lower()
    }

    assert reassignment_routes == set()


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


def test_event_status_submitted_is_shown_as_planning_to_organiser(app, event_database):
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
    assert response.json["event"]["status"] == "Planning"


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
    assert response.json["events"][0]["status"] == "Planning"


def test_coordinator_sees_submitted_internal_queue_status(app, event_database):
    client = app.test_client()
    select_user(client, 2)
    event_database[0].append({
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "title": "Assigned workshop",
        "status": "Submitted",
        "organiser_id": 1,
        "coordinator_id": 2,
    })

    response = client.get("/events", headers=ORIGIN)

    assert response.status_code == 200
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


# SCRUM-15: exercise the real Flask routes and sessions. The SQL transaction is
# checked separately with supabase/tests/drafts.sql against a test database.
@pytest.fixture
def draft(organiser):
    return organiser.post("/events", json={
        "action": "draft", "title": "First idea", "description": "Keep this detail",
    }, headers=ORIGIN).json["event"]


def test_owner_lists_and_reopens_draft_without_losing_raw_status(organiser, draft):
    listed = organiser.get("/events?status=Draft", headers=ORIGIN)
    opened = organiser.get(f"/events/{draft['id']}", headers=ORIGIN)
    assert [event["id"] for event in listed.json["events"]] == [draft["id"]]
    assert opened.json["event"]["request_status"] == "Draft"
    assert opened.json["event"]["status"] == "Draft"
    assert opened.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("actor_id", [2, 3, 4, 5, 6])
def test_drafts_are_private_even_for_related_users(app, database, event_database, draft, actor_id):
    database[0].append({"id": 6, "display_name": "Organiser B", "role": "Organiser",
                        "is_demo": True})
    event_database[0][0]["coordinator_id"] = actor_id
    event_database[1].participants.append({"event_id": draft["id"], "user_id": actor_id})
    other = app.test_client()
    select_user(other, actor_id)
    assert other.get("/events", headers=ORIGIN).json["events"] == []
    filtered = other.get("/events?status=Draft", headers=ORIGIN)
    assert filtered.status_code == (200 if actor_id == 6 else 403)
    if actor_id == 6:
        assert filtered.json["events"] == []
    for suffix in ("", "/history"):
        assert other.get(f"/events/{draft['id']}{suffix}", headers=ORIGIN).status_code == 404
    edit = other.patch(f"/events/{draft['id']}", json={"title": "Stolen"}, headers=ORIGIN)
    assert edit.status_code in (403, 404)
    assert event_database[0][0]["title"] == "First idea"
    assert other.patch(f"/events/{draft['id']}/status", json={"status": "Submitted"},
                       headers=ORIGIN).status_code == 404


def test_save_repeatedly_updates_same_draft_and_keeps_omitted_fields(
    organiser, draft, event_database
):
    for title in ("Second idea", "Final idea"):
        response = organiser.patch(f"/events/{draft['id']}", json={"title": title}, headers=ORIGIN)
        assert response.status_code == 200
        saved = response.json["event"]
        assert saved["id"] == draft["id"]
        assert saved["title"] == title
        assert saved["description"] == "Keep this detail"
        assert saved["status"] == "Draft"
        assert saved["submitted_at"] is None
        assert saved["created_at"] == draft["created_at"]
        assert saved["updated_at"] >= draft["updated_at"]
    assert len(event_database[0]) == 1
    assert len(event_database[1].history) == 1  # Creation only, no fake status changes.
    cleared = organiser.patch(f"/events/{draft['id']}", json={"description": ""}, headers=ORIGIN)
    assert cleared.json["event"]["description"] is None


def test_incomplete_submission_preserves_draft(organiser, draft, event_database):
    response = organiser.patch(f"/events/{draft['id']}", json={"action": "submit"}, headers=ORIGIN)
    assert response.status_code == 400
    assert "purpose" in response.json["fields"]
    assert event_database[0][0]["status"] == "Draft"
    event_database[1].rpc.assert_not_called()


def test_complete_draft_submits_once_and_then_locks(organiser, draft, details, event_database):
    response = organiser.patch(f"/events/{draft['id']}",
                               json={**details, "action": "submit"}, headers=ORIGIN)
    assert response.status_code == 200
    saved = response.json["event"]
    assert saved["id"] == draft["id"]
    assert saved["status"] == "Planning"
    assert saved["request_status"] == "Submitted"
    assert event_database[0][0]["status"] == "Submitted"
    assert saved["submitted_at"]
    assert saved["last_status_changed_by"] == 1
    assert len(event_database[0]) == 1
    history = event_database[1].history
    assert len(history) == 2
    assert history[-1]["old_status"] == "Draft"
    assert history[-1]["new_status"] == "Submitted"
    assert history[-1]["changed_by"] == 1
    for action in ("draft", "submit"):
        retry = organiser.patch(f"/events/{draft['id']}",
                                json={"action": action, "title": "Too late"}, headers=ORIGIN)
        assert retry.status_code == 409
    assert len(history) == 2
    assert organiser.get("/events?status=Draft", headers=ORIGIN).json["events"] == []


def test_status_endpoint_cannot_bypass_draft_submission(organiser, draft, event_database):
    for status in ("Submitted", "Confirmed", "Planning"):
        response = organiser.patch(f"/events/{draft['id']}/status",
                                   json={"status": status}, headers=ORIGIN)
        assert response.status_code == 409
    assert event_database[0][0]["status"] == "Draft"


@pytest.mark.parametrize("payload", [
    None, [], "text", {"action": "invalid"}, {"organiser_id": 2}, {"status": "Submitted"},
    {"coordinator_id": 2}, {"submitted_at": "2099-01-01"}, {"id": "other"},
    {"expected_attendance": 0}, {"expected_attendance": True},
    {"event_datetime": "2000-01-01T00:00:00Z"}, {"title": "x" * 201},
])
def test_invalid_draft_changes_do_not_write(organiser, draft, event_database, payload):
    response = organiser.patch(f"/events/{draft['id']}", json=payload, headers=ORIGIN)
    assert response.status_code == 400
    event_database[1].rpc.assert_not_called()


def test_edit_requires_session_and_matching_origin(app, organiser, draft):
    url = f"/events/{draft['id']}"
    assert app.test_client().patch(url, json={}, headers=ORIGIN).status_code == 401
    assert organiser.patch(url, json={}).status_code == 403
    assert organiser.patch(
        url, json={}, headers={"Origin": "https://other.test"}
    ).status_code == 403
    assert organiser.patch("/events/11111111-1111-4111-8111-111111111111",
                           json={}, headers=ORIGIN).status_code == 404


def test_concurrent_submission_returns_conflict(organiser, draft, event_database):
    # Simulate another request submitting after Flask's read but before SQL's update.
    event_database[1].rpc.side_effect = lambda *_: SimpleNamespace(
        execute=lambda: SimpleNamespace(data=[]))
    response = organiser.patch(f"/events/{draft['id']}", json={"title": "Later"}, headers=ORIGIN)
    assert response.status_code == 409


def test_draft_database_failure_is_safe(organiser, draft, event_database):
    event_database[1].rpc.side_effect = RuntimeError("private database credentials")
    response = organiser.patch(f"/events/{draft['id']}", json={"title": "Later"}, headers=ORIGIN)
    assert response.status_code == 503
    assert "private database credentials" not in response.get_data(as_text=True)


@pytest.mark.parametrize("environment,enabled", [("production", True), ("development", False)])
def test_draft_edit_cannot_use_dev_cookie_outside_enabled_development(
    app, organiser, draft, environment, enabled
):
    app.config.update(APP_ENV=environment, DEV_ROLE_SWITCHER_ENABLED=enabled)
    assert organiser.patch(f"/events/{draft['id']}", json={}, headers=ORIGIN).status_code == 401
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
    notification = event_database[1].notifications[0]
    assert notification["recipient_id"] == 1
    assert notification["event_id"] == event["id"]
    assert notification["notification_type"] == "event_approved"
    assert "accepted" in notification["message"]


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


def test_organiser_can_read_rejection_notification_and_reason(
    organiser, coordinator, event_database
):
    event = _seed_planning_event(event_database, status="Submitted")
    assert coordinator.post(f"/events/{event['id']}/decision", json={
        "decision": "reject", "reason": "The venue is unavailable.",
    }, headers=ORIGIN).status_code == 200
    event_database[1].notifications.append({
        "id": 99, "recipient_id": 6, "message": "Another organiser's private message",
    })

    # A query-string recipient cannot replace the identity in the signed session.
    response = organiser.get("/notifications?recipient_id=6", headers=ORIGIN)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert len(response.json["notifications"]) == 1
    notification = response.json["notifications"][0]
    assert notification["event_id"] == event["id"]
    assert notification["message"] == "Your event request was rejected: The venue is unavailable."
    assert notification["created_at"]
    fetched = organiser.get(f"/events/{event['id']}", headers=ORIGIN).json["event"]
    assert fetched["status"] == "Rejected"
    assert fetched["decision_reason"] == "The venue is unavailable."


def test_notifications_require_selected_user(app):
    response = app.test_client().get("/notifications", headers=ORIGIN)
    assert response.status_code == 401
    assert "notifications" not in response.json


@pytest.mark.parametrize("user_id", [2, 3, 4, 5])
def test_notifications_are_only_available_to_organisers(app, user_id, monkeypatch):
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    client = app.test_client()
    select_user(client, user_id)
    response = client.get("/notifications", headers=ORIGIN)
    assert response.status_code == 403
    assert "notifications" not in response.json


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example"}])
def test_notifications_reject_untrusted_origin(organiser, headers):
    response = organiser.get("/notifications", headers=headers)
    assert response.status_code == 403
    assert "notifications" not in response.json


def test_notifications_empty_state(organiser):
    response = organiser.get("/notifications", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json == {"notifications": []}


def test_notifications_database_failure_is_safe(organiser, event_database):
    event_database[1].table.side_effect = RuntimeError("private database connection details")
    response = organiser.get("/notifications", headers=ORIGIN)
    assert response.status_code == 503
    assert response.json == {"error": "Could not load notifications. Please try again."}


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


def test_coordinator_can_request_clarification_with_audited_note(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.post(
        f"/events/{event['id']}/clarification",
        json={"note": "Please add the accessibility arrangements."},
        headers=ORIGIN,
    )

    assert response.status_code == 201
    clarification = response.json["clarification"]
    assert clarification["note"] == "Please add the accessibility arrangements."
    assert clarification["requested_by"] == 2
    assert clarification["requested_at"]
    assert event_database[1].clarifications[0]["status"] == "Pending"
    assert event_database[1].notifications[0]["recipient_id"] == 1
    assert event_database[1].history[0]["action"] == "clarification_requested"
    assert event_database[1].history[0]["note"] == clarification["note"]


def test_empty_clarification_note_is_rejected(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")

    response = coordinator.post(
        f"/events/{event['id']}/clarification", json={"note": "  "}, headers=ORIGIN
    )

    assert response.status_code == 400
    assert event_database[1].clarifications == []
    assert event_database[1].history == []


def test_pending_clarification_is_removed_from_coordinator_queue(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    response = coordinator.post(
        f"/events/{event['id']}/clarification",
        json={"note": "Please clarify the venue."},
        headers=ORIGIN,
    )
    assert response.status_code == 201

    queue = coordinator.get("/events", headers=ORIGIN)

    assert queue.status_code == 200
    assert queue.json["events"] == []


def test_organiser_can_view_and_resubmit_clarified_request(organiser, coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    requested = coordinator.post(
        f"/events/{event['id']}/clarification",
        json={"note": "Please clarify the venue."},
        headers=ORIGIN,
    )
    assert requested.status_code == 201

    clarification = organiser.get(f"/events/{event['id']}/clarification", headers=ORIGIN)
    assert clarification.status_code == 200
    assert clarification.json["clarification"]["note"] == "Please clarify the venue."

    payload = _edit_payload(event, venue_requirements="Accessible main hall")
    response = organiser.post(f"/events/{event['id']}/resubmit", json=payload, headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["event"]["venue_requirements"] == "Accessible main hall"
    assert event_database[1].clarifications[0]["status"] == "Resubmitted"
    assert event_database[1].clarifications[0]["responded_by"] == 1
    assert event_database[1].clarifications[0]["responded_at"]
    assert event_database[1].history[-1]["action"] == "clarification_resubmitted"
    assert event_database[1].history[-1]["changed_by"] == 1


def test_coordinator_cannot_resubmit_clarified_request(coordinator, event_database):
    event = _seed_planning_event(event_database, status="Submitted")
    event_database[1].clarifications.append({
        "id": 1, "event_id": event["id"], "note": "Please clarify.", "status": "Pending",
    })

    response = coordinator.post(
        f"/events/{event['id']}/resubmit", json=_edit_payload(event), headers=ORIGIN
    )

    assert response.status_code == 403


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

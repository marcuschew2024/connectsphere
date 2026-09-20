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
    client = MagicMock()

    def table(name):
        assert name == "events"
        query = MagicMock()

        def insert(fields):
            def execute():
                now = datetime.now(UTC).isoformat()
                row = {
                    **fields, "id": str(uuid4()), "coordinator_id": None,
                    "created_at": now, "updated_at": now,
                }
                rows.append(row)
                return SimpleNamespace(data=[row])

            query.execute.side_effect = execute
            return query

        query.insert.side_effect = insert
        return query

    client.table.side_effect = table
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

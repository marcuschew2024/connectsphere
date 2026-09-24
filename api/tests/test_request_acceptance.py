"""SCRUM-15/16/17 acceptance tests against real PostgreSQL, PostgREST and SMTP.

Start compose.acceptance.yml and run supabase/tests/run.sh first. These tests use
only disposable local records and the Mailpit capture inbox, never hosted data.
"""

import importlib
import json
import os
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from postgrest import SyncPostgrestClient

from app import create_app

from .conftest import ORIGIN, select_user

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


@pytest.fixture
def live(monkeypatch):
    with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as database:
        for name in ("users", "event_repository", "rbac", "submission_email", "auth"):
            module = importlib.import_module(f"app.{name}")
            monkeypatch.setattr(module, "get_supabase_client", lambda: database)
        app = create_app({
            "TESTING": True, "APP_ENV": "development", "DEV_ROLE_SWITCHER_ENABLED": True,
            "SECRET_KEY": "acceptance-test-only", "FRONTEND_ORIGIN": ORIGIN["Origin"],
            "SMTP_HOST": "127.0.0.1", "SMTP_PORT": 51025, "SMTP_STARTTLS": False,
            "SMTP_USERNAME": "", "SMTP_PASSWORD": "",
            "SMTP_FROM": "ConnectSphere <no-reply@connectsphere.test>",
        })
        users = {}
        for user_id in (1, 2, 6, 7):
            users[user_id] = app.test_client()
            assert select_user(users[user_id], user_id).status_code == 200
        yield app, database, users


def details():
    return {
        "title": f"Acceptance workshop {uuid4()}", "description": "Learn together",
        "purpose": "Share skills", "category": "Workshop",
        "event_datetime": "2099-10-20T06:00:00Z", "expected_attendance": 50,
    }


def new_draft(users, values=None):
    response = users[1].post("/events", json={"action": "draft", **(values or {})}, headers=ORIGIN)
    assert response.status_code == 201, response.json
    return response.json["event"]


def submit(users, draft):
    response = users[1].patch(
        f"/events/{draft['id']}", json={"action": "submit"}, headers=ORIGIN
    )
    assert response.status_code == 200, response.json
    return response


def captured_messages(event_id):
    inbox = os.environ.get("MAILPIT_TEST_URL", "http://127.0.0.1:58025")
    response = httpx.get(f"{inbox}/api/v1/messages", params={"limit": 500})
    response.raise_for_status()
    messages = []
    for message in response.json()["messages"]:
        if event_id in message["Subject"]:
            content = httpx.get(f"{inbox}/api/v1/message/{message['ID']}")
            content.raise_for_status()
            messages.append(content.json())
    return messages


def test_tc_us33_01_invalid_draft_cannot_submit(live):
    _, database, users = live
    draft = new_draft(users, {**details(), "purpose": ""})
    response = users[1].patch(
        f"/events/{draft['id']}", json={"action": "submit"}, headers=ORIGIN
    )
    assert response.status_code == 400
    assert "purpose" in response.json["fields"]
    stored = database.table("events").select("*").eq("id", draft["id"]).execute().data[0]
    assert stored["status"] == "Draft" and stored["submitted_at"] is None
    assert captured_messages(draft["id"]) == []


def test_tc_us33_02_valid_draft_reaches_coordinator_queue(live):
    _, database, users = live
    draft = new_draft(users, details())
    submitted = submit(users, draft).json["event"]
    assert submitted["id"] == draft["id"]
    stored = database.table("events").select("*").eq("id", draft["id"]).execute().data[0]
    assert stored["status"] == "Submitted"
    queue = users[2].get("/events", headers=ORIGIN).json["events"]
    assert any(row["id"] == draft["id"] and row["status"] == "Submitted" for row in queue)


def test_tc_us33_03_submission_has_actor_and_timestamp(live):
    _, database, users = live
    draft = new_draft(users, details())
    submitted = submit(users, draft).json["event"]
    history = database.table("event_status_history").select("*").eq(
        "event_id", draft["id"]
    ).eq("new_status", "Submitted").execute().data
    assert submitted["submitted_at"] and submitted["last_status_changed_by"] == 1
    assert len(history) == 1
    assert history[0]["old_status"] == "Draft" and history[0]["changed_by"] == 1
    assert history[0]["changed_at"] == submitted["submitted_at"]


def test_tc_us33_04_submitted_request_cannot_be_edited_or_resubmitted(live):
    _, database, users = live
    draft = new_draft(users, details())
    submit(users, draft)
    for action in ("draft", "submit"):
        response = users[1].patch(f"/events/{draft['id']}", json={
            "action": action, "title": "Too late",
        }, headers=ORIGIN)
        assert response.status_code == 409
    direct_edit = users[1].patch(f"/events/{draft['id']}", json={
        "title": "Too late",
    }, headers=ORIGIN)
    assert direct_edit.status_code == 403
    stored = database.table("events").select("*").eq("id", draft["id"]).execute().data[0]
    assert stored["title"] == draft["title"]
    assert len(captured_messages(draft["id"])) == 1


@pytest.mark.parametrize("from_draft", [True, False], ids=["draft", "new-request"])
def test_tc_us33_05_email_contains_the_organisers_reference(live, from_draft):
    _, _, users = live
    if from_draft:
        draft = new_draft(users, details())
        response = submit(users, draft)
    else:
        response = users[1].post("/events", json={**details(), "action": "submit"}, headers=ORIGIN)
        assert response.status_code == 201
    event = response.json["event"]
    assert response.json["confirmation_email"] == "sent"
    messages = captured_messages(event["id"])
    assert len(messages) == 1
    assert messages[0]["To"][0]["Address"] == "organiser@connectsphere.test"
    assert event["id"] in messages[0]["Text"]
    assert event["title"] in messages[0]["Text"]
    assert "Status: Planning" in messages[0]["Text"]
    if evidence_dir := os.environ.get("TEST_EVIDENCE_DIR"):
        destination = Path(evidence_dir)
        destination.mkdir(parents=True, exist_ok=True)
        receipt = {key: messages[0][key] for key in ("From", "To", "Subject", "Text")}
        (destination / f"submission-email-{'draft' if from_draft else 'new'}.json").write_text(
            json.dumps(receipt, indent=2) + "\n", encoding="utf-8"
        )


def test_tc_us41_01_exactly_one_coordinator_and_assignment_time(live):
    _, database, users = live
    draft = new_draft(users, details())
    event = submit(users, draft).json["event"]
    assert event["coordinator_id"] == 2 and event["coordinator_assigned_at"]
    participants = database.table("event_participants").select("*").eq(
        "event_id", event["id"]
    ).eq("role", "Coordinator").execute().data
    assert len(participants) == 1 and participants[0]["user_id"] == 2


def test_tc_us41_02_only_assigned_coordinator_sees_request_in_queue(live):
    _, _, users = live
    event = submit(users, new_draft(users, details())).json["event"]
    for user_id in (2, 7):
        queue = users[user_id].get("/events", headers=ORIGIN).json["events"]
        matching = [row for row in queue if row["id"] == event["id"]]
        assert len(matching) == (1 if user_id == 2 else 0)
        if matching:
            assert matching[0]["status"] == "Submitted"


def test_tc_us41_03_customer_sees_planning_on_write_read_and_list(live):
    _, _, users = live
    event = submit(users, new_draft(users, details())).json["event"]
    assert event["status"] == "Planning"
    fetched = users[1].get(f"/events/{event['id']}", headers=ORIGIN)
    assert fetched.json["event"]["status"] == "Planning"
    listed = users[1].get("/events", headers=ORIGIN).json["events"]
    assert next(row for row in listed if row["id"] == event["id"])["status"] == "Planning"


def test_tc_us41_04_no_manual_assignment_route_or_writable_coordinator(live):
    app, database, users = live
    event = submit(users, new_draft(users, details())).json["event"]
    assert not any("assign" in rule.rule for rule in app.url_map.iter_rules())
    response = users[1].post("/events", json={**details(), "coordinator_id": 7}, headers=ORIGIN)
    assert response.status_code == 400
    stored = database.table("events").select("*").eq("id", event["id"]).execute().data[0]
    assert stored["coordinator_id"] == 2


def test_tc_us41_05_multiple_requests_each_get_one_coordinator(live):
    _, database, users = live
    for _ in range(5):
        event = submit(users, new_draft(users, details())).json["event"]
        assert event["coordinator_id"] == 2 and event["coordinator_assigned_at"]
        members = database.table("event_participants").select("user_id").eq(
            "event_id", event["id"]
        ).eq("role", "Coordinator").execute().data
        assert members == [{"user_id": 2}]


def test_tc_us32_01_to_05_private_draft_can_be_saved_reopened_and_submitted(live):
    _, database, users = live
    draft = new_draft(users, {"title": "First idea"})
    assert draft["status"] == "Draft" and draft["description"] is None
    for other in (2, 6, 7):
        assert all(row["id"] != draft["id"] for row in
                   users[other].get("/events", headers=ORIGIN).json["events"])
        assert users[other].get(f"/events/{draft['id']}", headers=ORIGIN).status_code == 404
    saved = users[1].patch(f"/events/{draft['id']}", json={
        **details(), "action": "draft",
    }, headers=ORIGIN)
    assert saved.status_code == 200 and saved.json["event"]["status"] == "Draft"
    reopened = users[1].get(f"/events/{draft['id']}", headers=ORIGIN).json["event"]
    assert reopened["title"] == saved.json["event"]["title"]
    submit(users, draft)
    assert database.table("events").select("status").eq(
        "id", draft["id"]
    ).execute().data == [{"status": "Submitted"}]


def test_email_failure_preserves_saved_request_and_returns_honest_result(live):
    app, database, users = live
    app.config["SMTP_PORT"] = 1  # No SMTP server here.
    draft = new_draft(users, details())
    response = submit(users, draft)
    assert response.json["confirmation_email"] == "unavailable"
    assert database.table("events").select("status").eq(
        "id", draft["id"]
    ).execute().data == [{"status": "Submitted"}]
    assert captured_messages(draft["id"]) == []

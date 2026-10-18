"""SCRUM-127: real identity/session/queue/decision against the disposable database."""

import importlib
import os
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient

from app import create_app

from .conftest import ORIGIN, select_user

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"), reason="Disposable database is not running",
)


@pytest.fixture
def live_safety(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in {"http://127.0.0.1:55433", "http://localhost:55433"}
    with SyncPostgrestClient(url) as db:
        for name in ("users", "event_repository", "rbac", "auth"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        app = create_app({
            "TESTING": True, "APP_ENV": "development", "DEV_ROLE_SWITCHER_ENABLED": True,
            "SECRET_KEY": "disposable-safety-tests", "FRONTEND_ORIGIN": ORIGIN["Origin"],
        })
        client = app.test_client()
        users = client.get("/dev/users").json["users"]
        safety = [u for u in users if u["role"] == "Safety Officer"]
        assert len(safety) == 1
        assert {u["role"] for u in users} == {
            "Organiser", "Coordinator", "Venue Staff", "Tech Support", "Attendee", "Safety Officer",
        }
        assert safety[0]["id"] not in range(1, 8)  # IDs 6/7 are already occupied.
        assert select_user(client, safety[0]["id"]).status_code == 200
        assert client.get("/session").json["user"] == safety[0]
        created = []

        def event(status="Confirmed"):
            row = db.table("events").insert({
                "title": f"Safety acceptance {uuid4()}", "description": "Test event",
                "purpose": "Verify review", "category": "Workshop", "expected_attendance": 30,
                "event_datetime": "2099-10-20T06:00:00Z", "submitted_at": "2026-10-01T00:00:00Z",
                "status": status, "organiser_id": 1, "coordinator_id": 2,
            }).execute().data[0]
            created.append(row["id"])
            return row

        try:
            yield app, db, client, safety[0], event
        finally:
            if created:
                db.table("events").update({"status": "Cancelled"}).in_("id", created).execute()


def test_seeded_identity_can_find_review_and_approve_with_attribution(live_safety):
    _, db, client, safety, event = live_safety
    confirmed = event()
    private = event("Draft")
    planning = event("Planning")
    queue = client.get("/events/safety-review", headers=ORIGIN)
    assert queue.status_code == 200, queue.json
    ids = {row["id"] for row in queue.json["events"]}
    assert confirmed["id"] in ids and private["id"] not in ids and planning["id"] not in ids
    for suffix in ["", "/history"]:
        assert client.get(f"/events/{confirmed['id']}{suffix}", headers=ORIGIN).status_code == 200
    assert client.get(f"/events/{private['id']}", headers=ORIGIN).status_code == 404
    assert client.get(f"/events/{planning['id']}", headers=ORIGIN).status_code == 403
    assert client.get(f"/events/{confirmed['id']}/clarification", headers=ORIGIN).status_code == 403
    response = client.post(f"/events/{confirmed['id']}/safety-check",
                           json={"decision": "approve"}, headers=ORIGIN)
    assert response.status_code == 200, response.json
    assert response.json["event"]["status"] == "Preparation"
    stored = db.table("events").select("*").eq("id", confirmed["id"]).execute().data[0]
    assert stored["status"] == "Preparation" and stored["last_status_changed_by"] == safety["id"]
    history = client.get(f"/events/{confirmed['id']}/history", headers=ORIGIN).json["history"]
    assert history[-1]["changed_by"] == safety["id"]
    assert history[-1]["action"] == "safety_approved" and history[-1]["changed_at"]
    queue = client.get("/events/safety-review", headers=ORIGIN).json
    assert confirmed["id"] not in {row["id"] for row in queue["events"]}


@pytest.mark.parametrize("decision", ["request_changes", "reject"])
def test_send_back_records_reason_then_removes_read_access(live_safety, decision):
    _, db, client, safety, event = live_safety
    row = event()
    response = client.post(f"/events/{row['id']}/safety-check",
                           json={"decision": decision, "reason": "Keep the exit clear."},
                           headers=ORIGIN)
    assert response.status_code == 200, response.json
    assert response.json["event"]["status"] == "Planning"
    history = db.table("event_status_history").select("*").eq("event_id", row["id"]).execute().data
    assert history[-1]["note"] == "Keep the exit clear."
    assert history[-1]["changed_by"] == safety["id"]
    assert client.get(f"/events/{row['id']}", headers=ORIGIN).status_code == 403


def test_queue_paginates_without_dropping_or_repeating_events(live_safety):
    _, _, client, _, event = live_safety
    expected = {event()["id"] for _ in range(26)}
    first = client.get("/events/safety-review?page=1", headers=ORIGIN).json
    second = client.get("/events/safety-review?page=2", headers=ORIGIN).json
    assert len(first["events"]) == 25 and first["has_more"] is True
    assert len(second["events"]) == 1 and second["has_more"] is False
    assert {row["id"] for row in first["events"] + second["events"]} == expected


def test_real_sessions_of_existing_roles_are_denied_and_logged(live_safety):
    app, db, _, _, event = live_safety
    row = event()
    for user_id in range(1, 6):
        client = app.test_client()
        assert select_user(client, user_id).status_code == 200
        response = client.post(f"/events/{row['id']}/safety-check",
                               json={"decision": "approve"}, headers=ORIGIN)
        assert response.status_code == 403
    logs = db.table("access_denied_log").select("actor_id").eq(
        "action", "safety_check_event",
    ).execute().data
    assert set(range(1, 6)) <= {entry["actor_id"] for entry in logs}

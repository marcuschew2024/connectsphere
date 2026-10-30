"""SCRUM-54: a Coordinator views every non-draft event, against the disposable database.

Customer S1 Q34 — "mainly views their own assigned events, but can view all." The list
returns every non-draft event with the Coordinator's own surfaced first and flagged
``is_mine``; read access grants no edit rights on events they do not own, and opening a
non-owned event's record is still refused (record-level RBAC, unchanged — SCRUM-140 is a
separate bug about the Lead's clarification lookup).
"""

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

# Two demo Coordinators exist in the disposable database: id 2 and id 7.
COORDINATOR_A = 2
COORDINATOR_B = 7


@pytest.fixture
def live_coordinator(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in {"http://127.0.0.1:55433", "http://localhost:55433"}
    with SyncPostgrestClient(url) as db:
        for name in ("users", "event_repository", "rbac", "auth"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        app = create_app({
            "TESTING": True, "APP_ENV": "development", "DEV_ROLE_SWITCHER_ENABLED": True,
            "SECRET_KEY": "disposable-scrum54-tests", "FRONTEND_ORIGIN": ORIGIN["Origin"],
        })
        client = app.test_client()
        assert select_user(client, COORDINATOR_A).status_code == 200
        created = []

        def event(status="Submitted", coordinator_id=COORDINATOR_A, organiser_id=1):
            row = db.table("events").insert({
                "title": f"SCRUM-54 {uuid4()}", "description": "Test event",
                "purpose": "Verify visibility", "category": "Workshop",
                "expected_attendance": 30, "event_datetime": "2099-10-20T06:00:00Z",
                "submitted_at": "2026-10-01T00:00:00Z", "status": status,
                "organiser_id": organiser_id, "coordinator_id": coordinator_id,
            }).execute().data[0]
            created.append(row["id"])
            return row

        try:
            yield app, db, client, event
        finally:
            if created:
                db.table("events").update({"status": "Cancelled"}).in_("id", created).execute()


def test_coordinator_sees_all_non_draft_events_own_surfaced_first(live_coordinator):
    """TC-54-01: every non-draft event is visible, own ones flagged is_mine and surfaced first."""
    _, _, client, event = live_coordinator
    mine_assigned = event(coordinator_id=COORDINATOR_A)
    mine_organised = event(organiser_id=COORDINATOR_A, coordinator_id=COORDINATOR_B)
    theirs = event(coordinator_id=COORDINATOR_B)
    draft = event(status="Draft", coordinator_id=None)

    events = client.get("/events", headers=ORIGIN).json["events"]
    by_id = {row["id"]: row for row in events}
    assert {mine_assigned["id"], mine_organised["id"], theirs["id"]} <= by_id.keys()
    assert draft["id"] not in by_id  # another organiser's private draft never appears
    assert by_id[mine_assigned["id"]]["is_mine"] is True
    assert by_id[mine_organised["id"]]["is_mine"] is True
    assert by_id[theirs["id"]]["is_mine"] is False
    # The list is partitioned own-first: every is_mine event precedes every other event.
    flags = [row["is_mine"] for row in events]
    assert flags == sorted(flags, key=lambda mine: not mine)


def test_coordinator_cannot_edit_or_open_a_non_owned_event(live_coordinator):
    """TC-54-02: viewing all events grants no edit rights, nor record access, on others' events."""
    _, _, client, event = live_coordinator
    theirs = event(status="Planning", coordinator_id=COORDINATOR_B)

    listed = {row["id"] for row in client.get("/events", headers=ORIGIN).json["events"]}
    assert theirs["id"] in listed  # visible in the list...

    # ...but record-level RBAC still refuses both the edit and opening the record.
    assert client.patch(f"/events/{theirs['id']}", json={"title": "Hijacked"},
                        headers=ORIGIN).status_code == 403
    assert client.get(f"/events/{theirs['id']}", headers=ORIGIN).status_code == 403

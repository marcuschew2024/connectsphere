"""Real-database verification of the notifications hybrid recipient model (SCRUM-49 / R07).

The pure rule is unit-tested (test_notification_visibility.py) and the endpoint
wiring is route-tested with mocks (test_notifications_feed.py). These tests cover
what mocks cannot: the migration's CHECK constraints and the reader's real
PostgREST `.or_()` filtering (including a role value with a space). They run only
against the disposable Postgres/PostgREST started by compose.acceptance.yml.
"""

import importlib
import os
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from app import create_app

from .conftest import ORIGIN

pytestmark = pytest.mark.skipif(not os.environ.get("POSTGREST_TEST_URL"),
                                reason="Disposable acceptance services are not running")


@pytest.fixture
def feed_db(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in ("http://127.0.0.1:55433", "http://localhost:55433")
    with SyncPostgrestClient(url) as db:
        for name in ("auth", "users", "event_repository", "rbac"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        app = create_app({"TESTING": True, "APP_ENV": "production",
                          "DEV_ROLE_SWITCHER_ENABLED": False, "SECRET_KEY": "test-only",
                          "FRONTEND_ORIGIN": ORIGIN["Origin"]})

        def user_of(role):
            rows = db.table("app_users").select("id").eq("role", role).limit(1).execute().data
            assert rows, f"no seeded {role} account"
            return rows[0]["id"]

        def client_for(user_id):
            client = app.test_client()
            with client.session_transaction() as session:
                session["user_id"] = user_id
            return client

        event_ids = []

        def make_event(organiser_id):
            # A Planning event must have a coordinator (SCRUM-130 check constraint);
            # the notification rows only need a valid event to hang off.
            row = db.table("events").insert({
                "title": f"Notify feed {uuid4()}", "description": "Campus workshop",
                "purpose": "Private planning", "category": "Workshop",
                "expected_attendance": 10, "event_datetime": "2099-10-20T06:00:00Z",
                "organiser_id": organiser_id, "coordinator_id": user_of("Coordinator"),
                "submitted_at": "2026-10-01T06:00:00Z", "status": "Planning",
            }).execute().data[0]
            event_ids.append(row["id"])
            return row

        yield db, user_of, client_for, make_event
        # notifications cascade on event delete (FK on delete cascade), so deleting
        # the events we created also clears the notifications we seeded on them.
        for event_id in event_ids:
            db.table("events").delete().eq("id", event_id).execute()


def _note(db, event_id, message, *, recipient_id=None, recipient_role=None):
    row = {"event_id": event_id, "notification_type": "test", "message": message}
    if recipient_id is not None:
        row["recipient_id"] = recipient_id
    if recipient_role is not None:
        row["recipient_role"] = recipient_role
    return db.table("notifications").insert(row).execute().data[0]


# The reader returns the acting user's own rows + their role pool, and nothing else.
def test_reader_returns_own_and_pool_rows_with_isolation(feed_db):
    db, user_of, client_for, make_event = feed_db
    organiser = user_of("Organiser")
    venue_staff = user_of("Venue Staff")
    event = make_event(organiser)

    _note(db, event["id"], "venue pool", recipient_role="Venue Staff")
    _note(db, event["id"], "tech pool", recipient_role="Tech Support")
    _note(db, event["id"], "venue personal", recipient_id=venue_staff)
    _note(db, event["id"], "organiser personal", recipient_id=organiser)

    response = client_for(venue_staff).get("/notifications", headers=ORIGIN)

    assert response.status_code == 200
    messages = {n["message"] for n in response.json["notifications"]}
    # Sees its own note and its role pool...
    assert messages == {"venue personal", "venue pool"}
    # ...never another pool or another user's personal note.
    assert "tech pool" not in messages
    assert "organiser personal" not in messages


# The database rejects a notification that targets both, neither, or a non-pool role.
def test_recipient_target_and_role_constraints_are_enforced_by_database(feed_db):
    db, user_of, _, make_event = feed_db
    organiser = user_of("Organiser")
    venue_staff = user_of("Venue Staff")
    event = make_event(organiser)

    # Both targets set -> XOR check fails.
    with pytest.raises(APIError):
        _note(db, event["id"], "both", recipient_id=venue_staff, recipient_role="Venue Staff")

    # Neither target set -> XOR check fails.
    with pytest.raises(APIError):
        _note(db, event["id"], "neither")

    # A non-pool role is not an allowed recipient_role.
    with pytest.raises(APIError):
        _note(db, event["id"], "bad role", recipient_role="Organiser")

    # A valid pool target is accepted.
    accepted = _note(db, event["id"], "ok pool", recipient_role="Tech Support")
    assert accepted["recipient_role"] == "Tech Support"
    assert accepted["recipient_id"] is None

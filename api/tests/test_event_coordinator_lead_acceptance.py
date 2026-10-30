"""SCRUM-131: the Event Coordinator Lead role against the disposable database.

Covers the role's RBAC contract (Week 7 Change #5): the Lead oversees every
coordinator's assignments, while Coordinators stay scoped to their own events
(regression on SCRUM-13/21). The unassigned-queue behaviour is SCRUM-130 — the
auto-assign trigger is still live here, so events created below are always assigned.
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

# Two demo Coordinators exist in the disposable database: id 2 (Demo Coordinator) and
# id 7 (Coordinator B). The Lead must see both coordinators' work; each Coordinator
# must see only their own.
COORDINATOR_A = 2
COORDINATOR_B = 7


@pytest.fixture
def live_lead(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in {"http://127.0.0.1:55433", "http://localhost:55433"}
    with SyncPostgrestClient(url) as db:
        for name in ("users", "event_repository", "rbac", "auth"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        app = create_app({
            "TESTING": True, "APP_ENV": "development", "DEV_ROLE_SWITCHER_ENABLED": True,
            "SECRET_KEY": "disposable-lead-tests", "FRONTEND_ORIGIN": ORIGIN["Origin"],
        })
        client = app.test_client()
        users = client.get("/dev/users").json["users"]
        lead = [u for u in users if u["role"] == "Event Coordinator Lead"]
        assert len(lead) == 1, "the SCRUM-131 migration must seed exactly one demo Lead"
        assert {u["role"] for u in users} >= {
            "Organiser", "Coordinator", "Venue Staff", "Tech Support", "Attendee",
            "Safety Officer", "Event Coordinator Lead",
        }
        assert select_user(client, lead[0]["id"]).status_code == 200
        assert client.get("/session").json["user"] == lead[0]
        created = []

        def event(status="Submitted", coordinator_id=COORDINATOR_A, organiser_id=1):
            row = db.table("events").insert({
                "title": f"Lead acceptance {uuid4()}", "description": "Test event",
                "purpose": "Verify oversight", "category": "Workshop", "expected_attendance": 30,
                "event_datetime": "2099-10-20T06:00:00Z", "submitted_at": "2026-10-01T00:00:00Z",
                "status": status, "organiser_id": organiser_id, "coordinator_id": coordinator_id,
            }).execute().data[0]
            created.append(row["id"])
            return row

        try:
            yield app, db, client, lead[0], event
        finally:
            if created:
                db.table("events").update({"status": "Cancelled"}).in_("id", created).execute()


def test_lead_and_coordinator_both_list_every_non_draft_event(live_lead):
    """TC-131-02 + SCRUM-54: the Lead sees all coordinators' events, and since SCRUM-54 a
    Coordinator lists every non-draft event too (own assignment flagged is_mine). Drafts
    stay private to both. Record-level access to a non-owned event still differs — see the
    test below."""
    app, _, client, _, event = live_lead
    mine = event(coordinator_id=COORDINATOR_A)
    theirs = event(coordinator_id=COORDINATOR_B)
    draft = event(status="Draft", coordinator_id=None)

    lead_ids = {row["id"] for row in client.get("/events", headers=ORIGIN).json["events"]}
    assert mine["id"] in lead_ids and theirs["id"] in lead_ids
    assert draft["id"] not in lead_ids  # private drafts never reach the Lead

    coordinator = app.test_client()
    assert select_user(coordinator, COORDINATOR_A).status_code == 200
    coord_events = coordinator.get("/events", headers=ORIGIN).json["events"]
    coord_ids = {row["id"] for row in coord_events}
    assert mine["id"] in coord_ids  # own assignment
    assert theirs["id"] in coord_ids  # SCRUM-54: another coordinator's event is now visible
    assert draft["id"] not in coord_ids  # drafts stay private
    flags = {row["id"]: row.get("is_mine") for row in coord_events}
    assert flags[mine["id"]] is True and flags[theirs["id"]] is False


def test_lead_reads_an_unrelated_event_but_a_coordinator_is_denied(live_lead):
    """TC-131-01/02: record-level access. Lead reads any non-draft; Coordinator is scoped."""
    app, _, client, _, event = live_lead
    theirs = event(coordinator_id=COORDINATOR_B)
    draft = event(status="Draft", coordinator_id=None)

    assert client.get(f"/events/{theirs['id']}", headers=ORIGIN).status_code == 200
    assert client.get(f"/events/{theirs['id']}/history", headers=ORIGIN).status_code == 200
    assert client.get(f"/events/{draft['id']}", headers=ORIGIN).status_code == 404  # draft hidden

    coordinator = app.test_client()
    assert select_user(coordinator, COORDINATOR_A).status_code == 200
    assert coordinator.get(f"/events/{theirs['id']}", headers=ORIGIN).status_code == 403


def test_lead_opens_the_full_detail_screen_of_an_unrelated_event(live_lead):
    """R11 (SCRUM-140): the Lead's detail screen fetches event + history + clarification;
    all must succeed on another coordinator's event. A non-owning Coordinator stays scoped
    (SCRUM-54 is list-only), so it still cannot read the clarification."""
    app, _, client, _, event = live_lead
    theirs = event(coordinator_id=COORDINATOR_B)

    assert client.get(f"/events/{theirs['id']}", headers=ORIGIN).status_code == 200
    assert client.get(f"/events/{theirs['id']}/history", headers=ORIGIN).status_code == 200
    # The fetch R11 unblocked: before the fix this 403'd and broke the whole detail page.
    empty = client.get(f"/events/{theirs['id']}/clarification", headers=ORIGIN)
    assert empty.status_code == 200 and empty.json["clarification"] is None

    # With a real pending clarification (raised by the assigned Coordinator B), the Lead
    # reads its content, not just an empty 200.
    coordinator_b = app.test_client()
    assert select_user(coordinator_b, COORDINATOR_B).status_code == 200
    assert coordinator_b.post(f"/events/{theirs['id']}/clarification",
                              json={"note": "Please confirm the venue layout."},
                              headers=ORIGIN).status_code == 201
    lead_view = client.get(f"/events/{theirs['id']}/clarification", headers=ORIGIN)
    assert lead_view.status_code == 200
    assert lead_view.json["clarification"]["note"] == "Please confirm the venue layout."

    # A different Coordinator (A), unrelated to the event, is still denied the clarification.
    coordinator_a = app.test_client()
    assert select_user(coordinator_a, COORDINATOR_A).status_code == 200
    assert coordinator_a.get(f"/events/{theirs['id']}/clarification",
                             headers=ORIGIN).status_code == 403


def test_lead_sees_internal_status_not_the_customer_planning_label(live_lead):
    """The Lead oversees intake, so a Submitted event reads as Submitted, not Planning."""
    app, _, client, _, event = live_lead
    submitted = event(status="Submitted", coordinator_id=COORDINATOR_A, organiser_id=1)

    lead_view = client.get(f"/events/{submitted['id']}", headers=ORIGIN).json["event"]
    assert lead_view["status"] == "Submitted"
    assert lead_view["request_status"] == "Submitted"

    organiser = app.test_client()
    assert select_user(organiser, 1).status_code == 200
    owner_view = organiser.get(f"/events/{submitted['id']}", headers=ORIGIN).json["event"]
    assert owner_view["status"] == "Planning"  # customer-facing label is unchanged

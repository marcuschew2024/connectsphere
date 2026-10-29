"""SCRUM-133: formalise the Technical Support Staff role against the disposable database.

Decision (audit gap closed 2026-10-18): the Customer Brief's "Technical Support Staff"
is the role the codebase already seeds and enforces as "Tech Support" (SCRUM-13 baseline,
equipment epic SCRUM-34-38). It was never a missing role — the 2026-10-18 audit searched
for the brief's wording and did not find the code's shorthand. This story therefore adds
no new role and no migration; it pins the role's permission boundary with an acceptance
test so the contract is explicit and traceable (Confluence: "Test Cases — Add Technical
Support Staff role (SCRUM-133)", TC-133-01/02/03).

TC-133-01  the role is seeded + switchable and can run every permitted equipment action.
TC-133-02  out-of-remit actions (approve events, decide venue bookings, read unrelated
           internal planning) are denied and logged.
TC-133-03  the SCRUM-13 seed composition is unchanged; the role gains no new privilege.
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

# The seeded demo Technical Support Staff member. SCRUM-13 fixes IDs 1-5 by role; id 4 is
# "Demo Tech Support" (see supabase/seed_users.sql).
TECH_SUPPORT_ID = 4
# The full seeded role set after the Week-7 changes (SCRUM-127 + SCRUM-131). Pinning it is
# the SCRUM-13 regression: formalising this role must not add or drop a seeded identity.
EXPECTED_ROLES = {
    "Organiser", "Coordinator", "Venue Staff", "Tech Support", "Attendee",
    "Safety Officer", "Event Coordinator Lead",
}


@pytest.fixture
def live_tech(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in {"http://127.0.0.1:55433", "http://localhost:55433"}
    with SyncPostgrestClient(url) as db:
        for name in ("users", "rbac", "auth", "event_repository",
                     "equipment_repository", "equipment_request_repository"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        app = create_app({
            "TESTING": True, "APP_ENV": "development", "DEV_ROLE_SWITCHER_ENABLED": True,
            "SECRET_KEY": "disposable-tech-support-tests", "FRONTEND_ORIGIN": ORIGIN["Origin"],
        })
        client = app.test_client()
        assert select_user(client, TECH_SUPPORT_ID).status_code == 200
        assert client.get("/session").json["user"]["role"] == "Tech Support"
        created_events = []

        def event(status="Submitted", coordinator_id=2, organiser_id=1):
            row = db.table("events").insert({
                "title": f"Tech support acceptance {uuid4()}", "description": "Test event",
                "purpose": "Verify remit", "category": "Workshop", "expected_attendance": 30,
                "event_datetime": "2099-10-20T06:00:00Z", "submitted_at": "2026-10-01T00:00:00Z",
                "status": status, "organiser_id": organiser_id, "coordinator_id": coordinator_id,
            }).execute().data[0]
            created_events.append(row["id"])
            return row

        def item(**overrides):
            return {
                "equipment_type": f"Tech Support role {uuid4()}",
                "description": "Handheld with receiver", "total_quantity": 8,
                "location": "AV store", "operational_status": "Operational", **overrides,
            }

        try:
            yield app, db, client, event, item
        finally:
            if created_events:
                db.table("events").update({"status": "Cancelled"}).in_(
                    "id", created_events).execute()
            db.table("equipment_items").delete().ilike(
                "equipment_type", "Tech Support role %").execute()


def test_role_is_seeded_switchable_and_leaves_the_seed_set_unchanged(live_tech):
    """TC-133-01 (presence) + TC-133-03: the role is seeded exactly once and the SCRUM-13
    seed composition is intact."""
    _, _, client, _, _ = live_tech
    users = client.get("/dev/users").json["users"]
    assert {u["role"] for u in users} == EXPECTED_ROLES
    tech = [u for u in users if u["role"] == "Tech Support"]
    assert len(tech) == 1 and tech[0]["id"] == TECH_SUPPORT_ID


def test_tech_support_manages_equipment_and_technical_arrangements(live_tech):
    """TC-133-01: the role can maintain the catalogue, check availability, and reach its
    equipment-request queue. Detailed reserve/record/update flows are covered by the
    equipment epic's own acceptance tests (SCRUM-34/35/36/38); this pins that the role is
    authorised for them."""
    _, _, client, _, item = live_tech

    created = client.post("/equipment", json=item(), headers=ORIGIN)
    assert created.status_code == 201, created.json
    equipment_id = created.json["equipment"]["id"]

    catalogue = client.get("/equipment", headers=ORIGIN)
    assert catalogue.status_code == 200
    assert any(row["id"] == equipment_id for row in catalogue.json["equipment"])

    edited = client.put(f"/equipment/{equipment_id}",
                        json=item(total_quantity=6, operational_status="Damaged", revision=1),
                        headers=ORIGIN)
    assert edited.status_code == 200, edited.json

    availability = client.get(
        f"/equipment/{equipment_id}/availability"
        "?start_at=2099-10-20T06:00:00Z&end_at=2099-10-20T08:00:00Z&quantity=1",
        headers=ORIGIN)
    assert availability.status_code == 200, availability.json

    assert client.get("/equipment/requests", headers=ORIGIN).status_code == 200


def test_tech_support_is_denied_out_of_remit_actions(live_tech):
    """TC-133-02 (+ TC-133-03 negative): approving events, deciding venue bookings, and
    reading another client's internal planning are all denied and logged. The role gains
    no privilege beyond equipment/technical arrangements."""
    _, db, client, event, _ = live_tech
    submitted = event(status="Submitted", coordinator_id=2, organiser_id=1)

    # Approve/reject an event request — a Coordinator action (SCRUM-32 decision gate).
    assert client.post(f"/events/{submitted['id']}/decision",
                       json={"status": "Planning"}, headers=ORIGIN).status_code == 403
    # Decide a venue booking — a Venue Staff action (SCRUM-32/121).
    assert client.post(f"/venues/bookings/{uuid4()}/decision",
                       json={"decision": "approve"}, headers=ORIGIN).status_code == 403
    # Read an unrelated event's internal planning — Tech Support is not a related user and
    # is not an oversight role, so record access is refused.
    assert client.get(f"/events/{submitted['id']}", headers=ORIGIN).status_code == 403

    logged = {row["action"] for row in db.table("access_denied_log").select("action").eq(
        "actor_id", TECH_SUPPORT_ID).execute().data}
    assert {"decide_event", "decide_venue_booking", "view_event"} <= logged

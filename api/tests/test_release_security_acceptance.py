"""Core 1/6: public registration never grants lifecycle mutation permission.

These regressions deliberately use real password sessions and database membership;
an unrelated-attendee denial would not detect the original privilege escalation.
"""

import importlib
import os
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient

from app import create_app

from .conftest import ORIGIN
from .test_role_accounts_acceptance import PASSWORD

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"), reason="Disposable acceptance database required",
)


@pytest.fixture
def registered_attendee(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in {"http://127.0.0.1:55433", "http://localhost:55433"}
    with SyncPostgrestClient(url) as db:
        for name in ("users", "auth", "rbac", "event_repository", "registration_repository"):
            monkeypatch.setattr(importlib.import_module(f"app.{name}"),
                                "get_supabase_client", lambda: db)
        app = create_app({"TESTING": True, "APP_ENV": "production",
                          "DEV_ROLE_SWITCHER_ENABLED": False, "SECRET_KEY": "test-only",
                          "FRONTEND_ORIGIN": ORIGIN["Origin"]})
        client = app.test_client()
        assert client.post("/auth/login", headers=ORIGIN, json={
            "email": "attendee.a@connectsphere.test", "password": PASSWORD,
        }).status_code == 200
        event = db.table("events").insert({
            "title": f"Release access regression {uuid4()}", "description": "Public workshop",
            "purpose": "Private planning notes", "category": "Workshop",
            "status": "Confirmed", "organiser_id": 1, "coordinator_id": 2,
            "event_datetime": "2099-10-20T06:00:00Z", "expected_attendance": 2,
            "submitted_at": "2026-10-01T06:00:00Z",
            "registration_capacity": 2,
        }).execute().data[0]
        try:
            response = client.post(f"/events/{event['id']}/registrations",
                                   headers=ORIGIN, json={})
            assert response.status_code == 201, response.json
            yield db, client, event
        finally:
            db.table("events").delete().eq("id", event["id"]).execute()


@pytest.mark.parametrize("target", ["Planning", "Cancelled", "Rejected", "Submitted"])
def test_registered_attendee_cannot_mutate_lifecycle_or_receive_private_fields(
    registered_attendee, target,
):
    db, client, event = registered_attendee
    before = db.table("events").select("*").eq("id", event["id"]).execute().data
    history = db.table("event_status_history").select("*").eq(
        "event_id", event["id"]).execute().data

    response = client.patch(f"/events/{event['id']}/status", headers=ORIGIN,
                            json={"status": target})

    assert response.status_code == 403
    assert "event" not in response.json
    assert event["purpose"] not in response.get_data(as_text=True)
    assert db.table("events").select("*").eq("id", event["id"]).execute().data == before
    assert db.table("event_status_history").select("*").eq(
        "event_id", event["id"]).execute().data == history
    # Legitimate receipt access must survive the denial.
    offer = client.get(f"/events/{event['id']}/registration-offer", headers=ORIGIN)
    assert offer.status_code == 200 and offer.json["registration"]["status"] == "Registered"
    assert "purpose" not in offer.json["event"]

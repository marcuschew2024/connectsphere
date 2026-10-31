"""SCRUM-135: real sessions, PostgreSQL persistence, denial audit and races."""

import importlib
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from app import create_app
from app.rbac import PUBLIC_EVENT_FIELDS

from .conftest import ORIGIN
from .test_role_accounts_acceptance import PASSWORD

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"), reason="Disposable acceptance database required"
)


@pytest.fixture
def live_status(monkeypatch):
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in {"http://127.0.0.1:55433", "http://localhost:55433"}
    with SyncPostgrestClient(url) as db:
        for name in ("users", "auth", "rbac", "event_repository", "registration_repository"):
            monkeypatch.setattr(
                importlib.import_module(f"app.{name}"), "get_supabase_client", lambda: db
            )
        app = create_app(
            {
                "TESTING": True,
                "APP_ENV": "production",
                "DEV_ROLE_SWITCHER_ENABLED": False,
                "SECRET_KEY": "test-only",
                "FRONTEND_ORIGIN": ORIGIN["Origin"],
            }
        )
        clients, actors, ids = {}, {}, []
        for name in (
            "organiser.a",
            "coordinator.a",
            "coordinator.b",
            "venue-staff",
            "tech-support",
            "attendee.a",
            "coordinator-lead",
            "safety-officer",
        ):
            c = app.test_client()
            response = c.post(
                "/auth/login",
                headers=ORIGIN,
                json={"email": name + "@connectsphere.test", "password": PASSWORD},
            )
            assert response.status_code == 200
            clients[name], actors[name] = c, response.json["user"]

        def event(status="Submitted"):
            row = (
                db.table("events")
                .insert(
                    {
                        "title": f"Transition regression {uuid4()}",
                        "description": "Public description",
                        "purpose": "Confidential planning note",
                        "category": "Workshop",
                        "status": status,
                        "organiser_id": actors["organiser.a"]["id"],
                        "coordinator_id": actors["coordinator.a"]["id"],
                        "event_datetime": "2099-10-20T06:00:00Z",
                        "expected_attendance": 10,
                        "submitted_at": "2026-10-01T06:00:00Z",
                    }
                )
                .execute()
                .data[0]
            )
            ids.append(row["id"])
            # Membership permits reads; deliberately prove it cannot grant mutation.
            db.table("event_participants").insert(
                [
                    {"event_id": row["id"], "user_id": u["id"], "role": u["role"]}
                    for u in actors.values()
                ]
            ).execute()
            return row

        try:
            yield db, clients, actors, event
        finally:
            for event_id in ids:
                db.table("access_denied_log").delete().eq("event_id", event_id).execute()
                db.table("events").delete().eq("id", event_id).execute()


def snapshot(db, event):
    return {
        table: sorted(
            db.table(table)
            .select("*")
            .eq("id" if table == "events" else "event_id", event["id"])
            .execute()
            .data,
            key=lambda row: row.get("id", 0),
        )
        for table in ("events", "event_status_history", "notifications")
    }


def patch(client, event, target):
    return client.patch(f"/events/{event['id']}/status", headers=ORIGIN, json={"status": target})


def test_every_nonassigned_role_is_denied_without_mutation_and_logged(live_status):
    db, clients, actors, make = live_status
    event = make()
    before = snapshot(db, event)
    for name in clients:
        if name == "coordinator.a":
            continue
        logs_before = db.table("access_denied_log").select("id").eq(
            "actor_id", actors[name]["id"]
        ).execute().data
        for target in ("Planning", "Assigned", "Under review", "Rejected"):
            response = patch(clients[name], event, target)
            assert response.status_code in (403, 409), (name, target, response.json)
            assert "event" not in response.json
            assert "Confidential" not in response.get_data(as_text=True)
        assert snapshot(db, event) == before
        logs = (
            db.table("access_denied_log")
            .select("*")
            .eq("actor_id", actors[name]["id"])
            .execute()
            .data
        )
        assert len(logs) >= len(logs_before) + 4, name
    # Public reads survive mutation denial and never expose internal states/fields.
    public = clients["attendee.a"].get(f"/events/{event['id']}", headers=ORIGIN)
    assert public.status_code == 200
    assert set(public.json["event"]) <= PUBLIC_EVENT_FIELDS
    assert public.json["event"]["status"] == "Planning"


def test_forward_review_approval_has_one_decision_history_and_notification(live_status):
    db, clients, actors, make = live_status
    event = make()
    c = clients["coordinator.a"]
    for target in ("Assigned", "Under review", "Planning"):
        response = patch(c, event, target)
        assert response.status_code == 200, response.json
        assert response.json["event"]["status"] == (
            "Planning" if target == "Planning" else "Submitted"
        )
    result = snapshot(db, event)
    saved = result["events"][0]
    assert saved["decision_by"] == saved["last_status_changed_by"] == actors["coordinator.a"]["id"]
    assert saved["decision_at"] and saved["last_status_changed_at"]
    assert len(result["event_status_history"]) == 3
    assert len(result["notifications"]) == 1
    assert result["notifications"][0]["notification_type"] == "event_approved"
    assert result["notifications"][0]["recipient_id"] == actors["organiser.a"]["id"]
    assert patch(c, event, "Planning").status_code == 409
    assert snapshot(db, event) == result


def test_reasoned_rejection_and_terminal_states_are_preserved(live_status):
    db, clients, _, make = live_status
    c = clients["coordinator.a"]
    event = make("Under review")
    assert patch(c, event, "Rejected").status_code == 409
    path = f"/events/{event['id']}/decision"
    assert c.post(path, headers=ORIGIN, json={"decision": "reject"}).status_code == 400
    rejected = c.post(
        path, headers=ORIGIN, json={"decision": "reject", "reason": "Unsafe proposed activity"}
    )
    assert rejected.status_code == 200, rejected.json
    assert rejected.json["event"]["decision_reason"] == "Unsafe proposed activity"
    for state in ("Rejected", "Cancelled", "Completed"):
        event = make(state)
        before = snapshot(db, event)
        for target in (
            "Submitted",
            "Assigned",
            "Under review",
            "Approved",
            "Planning",
            "Confirmed",
            "Preparation",
            "Rejected",
            "Cancelled",
            "Completed",
        ):
            assert patch(c, event, target).status_code == 409
        assert (
            c.post(
                f"/events/{event['id']}/decision", headers=ORIGIN, json={"decision": "approve"}
            ).status_code
            == 409
        )
        assert snapshot(db, event) == before
        assert db.table("access_denied_log").select("id").eq("event_id", event["id"]).execute().data


def test_dedicated_gates_and_private_drafts_cannot_be_bypassed(live_status):
    db, clients, _, make = live_status
    event = make("Planning")
    before = snapshot(db, event)
    for target in ("Confirmed", "Preparation", "Completed", "Cancelled", "Submitted"):
        assert patch(clients["coordinator.a"], event, target).status_code == 409
    assert snapshot(db, event) == before
    draft = make("Draft")
    for name, c in clients.items():
        assert patch(c, draft, "Planning").status_code == (409 if name == "organiser.a" else 404)


def test_reassignment_between_http_check_and_write_is_refused(live_status, monkeypatch):
    db, clients, actors, make = live_status
    event = make()
    from app import events as routes

    original = routes.transition_event_intake

    def reassign_then_transition(*args):
        db.rpc(
            "assign_coordinator_by_lead",
            {
                "p_event_id": event["id"],
                "p_coordinator_id": actors["coordinator.b"]["id"],
                "p_lead_id": actors["coordinator-lead"]["id"],
            },
        ).execute()
        return original(*args)

    monkeypatch.setattr(routes, "transition_event_intake", reassign_then_transition)
    response = patch(clients["coordinator.a"], event, "Planning")
    assert response.status_code == 403
    saved = snapshot(db, event)
    assert saved["events"][0]["status"] == "Submitted"
    assert saved["events"][0]["coordinator_id"] == actors["coordinator.b"]["id"]
    assert not any(n["notification_type"] == "event_approved" for n in saved["notifications"])
    assert not any(h["new_status"] == "Planning" for h in saved["event_status_history"])


def test_cancel_between_http_check_and_write_cannot_be_revived(live_status, monkeypatch):
    db, clients, actors, make = live_status
    event = make()
    from app import events as routes

    original = routes.transition_event_intake

    def cancel_then_transition(*args):
        db.rpc(
            "cancel_event",
            {
                "p_event_id": event["id"],
                "p_actor_id": actors["coordinator.a"]["id"],
                "p_reason": "Cancelled by owner",
            },
        ).execute()
        return original(*args)

    monkeypatch.setattr(routes, "transition_event_intake", cancel_then_transition)
    assert patch(clients["coordinator.a"], event, "Planning").status_code == 409
    assert snapshot(db, event)["events"][0]["status"] == "Cancelled"


def test_two_simultaneous_approvals_produce_one_decision(live_status):
    db, _, actors, make = live_status
    event = make()
    barrier = Barrier(2)

    def approve():
        with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as connection:
            barrier.wait(timeout=10)
            try:
                connection.rpc(
                    "transition_event_intake",
                    {
                        "p_event_id": event["id"],
                        "p_actor_id": actors["coordinator.a"]["id"],
                        "p_expected_status": "Submitted",
                        "p_status": "Planning",
                    },
                ).execute()
                return 200
            except APIError as error:
                assert error.code == "PT409"
                return 409

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: approve(), range(2)))
    assert sorted(results) == [200, 409]
    saved = snapshot(db, event)
    assert len(saved["event_status_history"]) == len(saved["notifications"]) == 1


def test_database_enforces_matrix_even_without_http_guards(live_status):
    db, _, actors, make = live_status
    event = make()
    for name in ("organiser.a", "coordinator.b", "attendee.a", "venue-staff", "tech-support"):
        with pytest.raises(APIError) as error:
            db.rpc(
                "transition_event_intake",
                {
                    "p_event_id": event["id"],
                    "p_actor_id": actors[name]["id"],
                    "p_expected_status": "Submitted",
                    "p_status": "Planning",
                },
            ).execute()
        assert error.value.code == "PT403"
    for target in ("Confirmed", "Preparation", "Completed", "Cancelled", "Submitted", None):
        with pytest.raises(APIError) as error:
            db.rpc(
                "transition_event_intake",
                {
                    "p_event_id": event["id"],
                    "p_actor_id": actors["coordinator.a"]["id"],
                    "p_expected_status": "Submitted",
                    "p_status": target,
                },
            ).execute()
        assert error.value.code == "PT409"
    assert snapshot(db, event)["events"][0]["status"] == "Submitted"


def test_pending_clarification_must_be_resubmitted_before_approval(live_status):
    db, clients, actors, make = live_status
    event = make()
    db.table("event_clarifications").insert(
        {
            "event_id": event["id"],
            "note": "Clarify purpose",
            "requested_by": actors["coordinator.a"]["id"],
        }
    ).execute()
    before = snapshot(db, event)
    assert patch(clients["coordinator.a"], event, "Planning").status_code == 409
    assert snapshot(db, event) == before

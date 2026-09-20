"""SCRUM-21 RBAC tests (US-1.2). Covers the backend-testable cases:

- TC-US1.2-02  server-side role denial (non-Organiser blocked from an Organiser action)
- TC-US1.2-03  cross-client isolation (unrelated user blocked from an event)
- TC-US1.2-04  attendee sees only public fields, no internal planning info
- TC-US1.2-05  denied attempts recorded in access_denied_log
- TC-US1.2-06  no admin role / no admin bypass

TC-US1.2-01 (role-appropriate navigation) is a frontend concern (SCRUM-89) and is
verified there + by manual test.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from app.rbac import (
    PUBLIC_EVENT_FIELDS,
    public_event_view,
    require_related_user,
    require_role,
)

ORGANISER = {"id": 1, "role": "Organiser"}
ATTENDEE = {"id": 5, "role": "Attendee"}


@pytest.fixture
def app_ctx():
    """A request context so log_access_denied can read request.remote_addr / current_app."""
    app = Flask(__name__)
    with app.test_request_context("/", environ_overrides={"REMOTE_ADDR": "127.0.0.1"}):
        yield


@pytest.fixture
def denial_log(monkeypatch):
    """Capture rows inserted into access_denied_log via a fake Supabase client."""
    rows: list[dict] = []
    client = MagicMock()

    def table(name):
        assert name == "access_denied_log"
        q = MagicMock()

        def insert(data):
            rows.append(data)
            return q

        q.insert.side_effect = insert
        q.execute.return_value = SimpleNamespace(data=[])
        return q

    client.table.side_effect = table
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: client)
    return rows


# --- TC-US1.2-02 + TC-US1.2-05: role denial is server-side and logged -----------------
def test_require_role_denies_non_organiser_and_logs(app_ctx, denial_log):
    with pytest.raises(Forbidden):
        require_role(ATTENDEE, "Organiser", action="create_event")
    assert len(denial_log) == 1
    assert denial_log[0]["action"] == "create_event"
    assert denial_log[0]["actor_id"] == 5
    assert denial_log[0]["actor_role"] == "Attendee"


def test_require_role_allows_permitted_role(app_ctx, denial_log):
    assert require_role(ORGANISER, "Organiser", action="create_event") is ORGANISER
    assert denial_log == []  # a permitted action is never logged as denied


# --- TC-US1.2-03 + TC-US1.2-05: cross-client isolation is enforced and logged ---------
def test_require_related_user_denies_unrelated_and_logs(app_ctx, denial_log, monkeypatch):
    monkeypatch.setattr("app.rbac.is_event_participant", lambda eid, uid: False)
    event = {"id": "evt-1", "organiser_id": 2, "coordinator_id": None}  # owned by user 2
    with pytest.raises(Forbidden):
        require_related_user(ORGANISER, event, action="view_event")  # user 1 is unrelated
    assert denial_log[0]["reason"] == "not a related user"
    assert denial_log[0]["event_id"] == "evt-1"


def test_require_related_user_allows_the_organiser(app_ctx, denial_log, monkeypatch):
    monkeypatch.setattr("app.rbac.is_event_participant", lambda eid, uid: False)
    event = {"id": "evt-1", "organiser_id": 1, "coordinator_id": None}  # owned by user 1
    assert require_related_user(ORGANISER, event, action="view_event")["id"] == 1
    assert denial_log == []


def test_require_related_user_allows_a_participant(app_ctx, denial_log, monkeypatch):
    monkeypatch.setattr("app.rbac.is_event_participant", lambda eid, uid: True)
    event = {"id": "evt-1", "organiser_id": 2, "coordinator_id": None}
    tech = {"id": 9, "role": "Tech Support"}
    assert require_related_user(tech, event, action="view_event")["id"] == 9
    assert denial_log == []


# --- TC-US1.2-04: attendee view exposes only public fields -----------------------------
def test_public_event_view_strips_internal_fields():
    full = {
        "id": "evt-1",
        "title": "Tech Talk",
        "description": "Guest speaker",
        "category": "Workshop",
        "event_datetime": "2026-10-20T14:00:00Z",
        "status": "Confirmed",
        # internal planning fields that an attendee must not see:
        "coordinator_id": 2,
        "organiser_id": 1,
        "submitted_at": "2026-09-01T00:00:00Z",
        "last_status_changed_by": 2,
        "last_status_changed_at": "2026-09-02T00:00:00Z",
    }
    view = public_event_view(full)
    assert set(view) == set(PUBLIC_EVENT_FIELDS)
    for hidden in ("coordinator_id", "organiser_id", "submitted_at",
                   "last_status_changed_by", "last_status_changed_at"):
        assert hidden not in view
    assert view["title"] == "Tech Talk"  # public data is preserved


# --- TC-US1.2-06: no admin role / no admin bypass -------------------------------------
def test_no_admin_bypass(app_ctx, denial_log):
    """An 'admin' role holds no special privilege — it is denied like any non-Organiser."""
    admin = {"id": 99, "role": "admin"}
    with pytest.raises(Forbidden):
        require_role(admin, "Organiser", action="create_event")
    assert denial_log[0]["actor_role"] == "admin"

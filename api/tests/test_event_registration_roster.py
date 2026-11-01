"""SCRUM-45: access policy, input boundaries and truthful storage failures."""

from unittest.mock import MagicMock

import pytest

from app.registration_roster import RegistrationRosterAccess

from .conftest import ORIGIN, select_user

EVENT_ID = "45454545-4545-4545-8545-454545454545"
PATH = f"/events/{EVENT_ID}/registrations"


@pytest.mark.parametrize("actor,role,allowed", [
    (1, "Organiser", True), (2, "Coordinator", True), (3, "Organiser", False),
    (3, "Coordinator", False), (1, "Coordinator", False), (2, "Organiser", False),
    (1, "Attendee", False), (2, "Event Coordinator Lead", False),
])
def test_roster_is_owned_not_granted_by_membership(actor, role, allowed):
    assert RegistrationRosterAccess(1, 2).allows(actor, role) is allowed
    assert not RegistrationRosterAccess(1, None).allows(2, "Coordinator")


@pytest.fixture
def roster_api(app, monkeypatch):
    event = {"id": EVENT_ID, "organiser_id": 1, "coordinator_id": 2,
             "status": "Confirmed", "registration_capacity": 5}
    monkeypatch.setattr("app.events.get_event_by_id", lambda _: event)
    monkeypatch.setattr("app.rbac.is_event_participant", lambda *_: True)
    monkeypatch.setattr("app.events.log_access_denied", lambda *_, **__: None)
    monkeypatch.setattr("app.rbac.log_access_denied", lambda *_, **__: None)
    lookup = MagicMock(return_value={"registrations": [], "page": 1, "has_more": False,
                                   "counts": {"registered_count": 0, "waitlisted_count": 0,
                                              "withdrawn_count": 0}})
    monkeypatch.setattr("app.events.list_event_registrations", lookup)
    client = app.test_client()
    select_user(client, 1)
    return client, lookup, event


@pytest.mark.parametrize("actor", [1, 2])
def test_related_staff_receive_uncached_roster(roster_api, actor):
    client, lookup, _ = roster_api
    select_user(client, actor)
    response = client.get(PATH + "?page=2&status=Waitlisted", headers=ORIGIN)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json["capacity"] == 5
    assert "organiser_id" not in response.json["event"]
    lookup.assert_called_once_with(EVENT_ID, 2, "Waitlisted")


@pytest.mark.parametrize("query", ["page=0", "page=10001", "page=-1", "page=1.5", "page=x",
                                  "page=", "page=%EF%BC%91", "page=1&page=2",
                                  "attendee_id=99", "event_id=other", "status=unknown",
                                  "status=", "status=Registered&status=Withdrawn"])
def test_roster_rejects_invalid_filters_and_identity_injection(roster_api, query):
    client, lookup, _ = roster_api
    assert client.get(PATH + "?" + query, headers=ORIGIN).status_code == 400
    lookup.assert_not_called()


def test_guests_wrong_roles_and_origins_never_read_private_storage(roster_api, app):
    client, lookup, _ = roster_api
    assert app.test_client().get(PATH, headers=ORIGIN).status_code == 401
    assert client.get(PATH).status_code == 403
    assert client.get(PATH, headers={"Origin": "https://other.example"}).status_code == 403
    for actor in (3, 4, 5):
        select_user(client, actor)
        assert client.get(PATH, headers=ORIGIN).status_code == 403
    lookup.assert_not_called()


def test_old_membership_and_role_changes_do_not_grant_roster_access(roster_api):
    client, lookup, event = roster_api
    event["organiser_id"] = 99
    assert client.get(PATH, headers=ORIGIN).status_code == 403
    select_user(client, 2)
    event["coordinator_id"] = 99
    assert client.get(PATH, headers=ORIGIN).status_code == 403
    event["status"] = "Draft"
    assert client.get(PATH, headers=ORIGIN).status_code == 404
    lookup.assert_not_called()


def test_missing_event_returns_404(roster_api, monkeypatch):
    client, lookup, _ = roster_api
    monkeypatch.setattr("app.events.get_event_by_id", lambda _: None)
    assert client.get(PATH, headers=ORIGIN).status_code == 404
    lookup.assert_not_called()


@pytest.mark.parametrize("missing", [True, False])
def test_database_failure_is_not_an_empty_roster(roster_api, monkeypatch, missing):
    from app.registration_repository import list_event_registrations

    client, _, _ = roster_api
    db = MagicMock()
    db.table.side_effect = RuntimeError("secret connection string")
    monkeypatch.setattr("app.registration_repository.get_supabase_client",
                        lambda: None if missing else db)
    monkeypatch.setattr("app.events.list_event_registrations", list_event_registrations)
    response = client.get(PATH, headers=ORIGIN)
    assert response.status_code == 503
    assert "registrations" not in response.json
    assert "secret" not in response.get_data(as_text=True)


def test_missing_exact_count_does_not_claim_zero(roster_api, monkeypatch):
    from app.registration_repository import list_event_registrations

    client, _, _ = roster_api
    query = MagicMock()
    for method in ("table", "select", "eq", "order", "range", "limit"):
        getattr(query, method).return_value = query
    query.execute.return_value.data = []
    query.execute.return_value.count = None
    monkeypatch.setattr("app.registration_repository.get_supabase_client", lambda: query)
    monkeypatch.setattr("app.events.list_event_registrations", list_event_registrations)
    assert client.get(PATH, headers=ORIGIN).status_code == 503

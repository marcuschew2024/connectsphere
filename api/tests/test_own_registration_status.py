"""SCRUM-44: current, private registration reads and HTTP failure boundaries."""

from unittest.mock import MagicMock

import pytest

from .conftest import ORIGIN, select_user

PATH = "/events/registrations"


@pytest.fixture
def status_api(app, monkeypatch):
    lookup = MagicMock(return_value=([], False))
    monkeypatch.setattr("app.events.list_own_registrations", lookup)
    monkeypatch.setattr("app.rbac.log_access_denied", lambda *_, **__: None)
    client = app.test_client()
    select_user(client, 5)
    return client, lookup


def test_list_uses_session_identity_and_returns_an_uncached_page(status_api):
    client, lookup = status_api
    registration = {"id": "own-reference", "status": "Registered"}
    lookup.return_value = ([registration], True)
    response = client.get(f"{PATH}?page=2", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json == {"registrations": [registration], "page": 2, "has_more": True}
    assert response.headers["Cache-Control"] == "no-store"
    lookup.assert_called_once_with(5, 2)


def test_status_is_read_again_instead_of_replaying_a_confirmation(status_api):
    client, lookup = status_api
    lookup.side_effect = [([{"status": "Registered"}], False),
                          ([{"status": "Withdrawn"}], False)]
    assert client.get(PATH, headers=ORIGIN).json["registrations"][0]["status"] == "Registered"
    assert client.get(PATH, headers=ORIGIN).json["registrations"][0]["status"] == "Withdrawn"
    assert lookup.call_count == 2


@pytest.mark.parametrize("role_id", [1, 2, 3, 4])
def test_staff_cannot_read_attendee_status_lists(status_api, role_id):
    client, lookup = status_api
    select_user(client, role_id)
    assert client.get(PATH, headers=ORIGIN).status_code == 403
    lookup.assert_not_called()


def test_guest_and_untrusted_origin_never_reach_registration_storage(status_api, app):
    client, lookup = status_api
    assert app.test_client().get(PATH, headers=ORIGIN).status_code == 401
    assert client.get(PATH).status_code == 403
    assert client.get(PATH, headers={"Origin": "https://other.example"}).status_code == 403
    lookup.assert_not_called()


def test_real_account_wins_over_a_demo_attendee(status_api, monkeypatch):
    client, lookup = status_api
    monkeypatch.setattr("app.auth.get_authenticated_user", lambda: {
        "id": 99, "role": "Attendee", "display_name": "Real attendee",
    })
    assert client.get(PATH, headers=ORIGIN).status_code == 200
    lookup.assert_called_once_with(99, 1)


@pytest.mark.parametrize("query", ["page=0", "page=10001", "page=-1", "page=1.5", "page=x",
                                  "page=", "page=%EF%BC%91", "page=1&page=2",
                                  "attendee_id=99", "user_id=99", "status=Registered"])
def test_invalid_pages_and_account_selectors_are_rejected(status_api, query):
    client, lookup = status_api
    assert client.get(f"{PATH}?{query}", headers=ORIGIN).status_code == 400
    lookup.assert_not_called()


def test_database_failure_is_an_error_not_an_empty_success(app, monkeypatch):
    db = MagicMock()
    db.table.side_effect = RuntimeError("secret connection string")
    monkeypatch.setattr("app.registration_repository.get_supabase_client", lambda: db)
    client = app.test_client()
    select_user(client, 5)
    response = client.get(PATH, headers=ORIGIN)
    assert response.status_code == 503
    assert response.json == {"error": "Could not load your registrations. Please try again."}
    assert response.headers["Cache-Control"] == "no-store"


def test_missing_database_is_not_reported_as_no_registrations(app, monkeypatch):
    monkeypatch.setattr("app.registration_repository.get_supabase_client", lambda: None)
    client = app.test_client()
    select_user(client, 5)
    assert client.get(PATH, headers=ORIGIN).status_code == 503

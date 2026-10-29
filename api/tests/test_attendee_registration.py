"""SCRUM-40 acceptance rules and HTTP boundaries, without network credentials."""

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from app.registration_capacity import RegistrationCapacity
from app.registration_request import RegistrationRequest

from .conftest import ORIGIN, select_user

EVENT_ID = "40404040-4040-4040-8040-404040404040"
NOW = datetime(2026, 10, 29, 4, tzinfo=UTC)


@pytest.mark.parametrize(("opens", "closes", "expected"), [
    (None, None, None),
    ("2026-10-29T12:00:00+08:00", "2026-10-29T05:00:00Z", None),
    ("2026-10-29T04:00:01Z", None, "not opened"),
    (None, "2026-10-29T04:00:00Z", "closed"),
])
def test_signup_window_is_open_inclusive_and_close_exclusive(opens, closes, expected):
    rules = RegistrationRequest(RegistrationCapacity(10, 0), "Confirmed",
                                opens_at=opens, closes_at=closes)
    refusal = rules.refusal(NOW)
    assert refusal is None if expected is None else expected in refusal


@pytest.fixture
def signup_api(app, monkeypatch):
    event = {"id": EVENT_ID, "title": "Campus workshop", "description": "Learn together",
             "category": "Workshop", "event_datetime": "2099-10-20T06:00:00Z",
             "status": "Confirmed", "registration_capacity": 2, "registered_count": 0,
             "registration_requirements": "Tell us your course and year.",
             "organiser_id": 1, "coordinator_id": 2, "purpose": "Internal planning"}
    monkeypatch.setattr("app.events.get_event_by_id", lambda _: dict(event))
    monkeypatch.setattr("app.events.get_own_registration", lambda *_: None)
    monkeypatch.setattr("app.events.list_registration_events", lambda _: ([dict(event)], False))
    monkeypatch.setattr("app.rbac.log_access_denied", lambda *_, **__: None)
    saved = {"id": "receipt-1", "event_id": EVENT_ID,
             "status": "Registered", "registered_at": NOW.isoformat()}
    register = MagicMock(return_value=saved)
    monkeypatch.setattr("app.events.register_attendee", register)
    client = app.test_client()
    select_user(client, 5)
    return client, event, register, saved


def test_attendee_discovers_only_public_details_and_submits_information(signup_api):
    client, _, register, saved = signup_api
    response = client.get("/events/registration-offers?page=1", headers=ORIGIN)
    assert response.status_code == 200
    offer = response.json["offers"][0]
    assert set(offer["event"]) == {"id", "title", "description", "category", "event_datetime",
                                   "status", "registration_requirements"}
    assert offer["capacity"]["remaining"] == 2 and offer["unavailable_reason"] is None
    result = client.post(f"/events/{EVENT_ID}/registrations",
                         json={"information": "  IS, year 2  "}, headers=ORIGIN)
    assert result.status_code == 201 and result.json["registration"] == saved
    register.assert_called_once_with(EVENT_ID, 5, "IS, year 2")


@pytest.mark.parametrize("information", ["", "  ", None, [], 2, True, "x" * 4001])
def test_invalid_or_missing_required_information_cannot_take_a_place(signup_api, information):
    client, _, register, _ = signup_api
    response = client.post(f"/events/{EVENT_ID}/registrations",
                           json={"information": information}, headers=ORIGIN)
    assert response.status_code == 400 and "information" in response.json["fields"]
    register.assert_not_called()


def test_missing_required_information_rejects_legacy_empty_payload(signup_api):
    client, _, register, _ = signup_api
    assert client.post(f"/events/{EVENT_ID}/registrations", json={},
                       headers=ORIGIN).status_code == 400
    register.assert_not_called()


@pytest.mark.parametrize("extra", ["attendee_id", "event_id", "status", "registered_at"])
def test_browser_cannot_supply_identity_or_registration_state(signup_api, extra):
    client, _, register, _ = signup_api
    response = client.post(f"/events/{EVENT_ID}/registrations",
                           json={"information": "IS year 2", extra: "forged"}, headers=ORIGIN)
    assert response.status_code == 400
    register.assert_not_called()


@pytest.mark.parametrize("role_id", [1, 2, 3, 4])
def test_only_attendee_accounts_can_browse_and_register(signup_api, role_id):
    client, _, register, _ = signup_api
    select_user(client, role_id)
    for path in ("/events/registration-offers", f"/events/{EVENT_ID}/registration-offer",
                 "/events/registration-confirmations"):
        assert client.get(path, headers=ORIGIN).status_code == 403
    assert client.post(f"/events/{EVENT_ID}/registrations", json={},
                       headers=ORIGIN).status_code == 403
    register.assert_not_called()


def test_guest_and_foreign_origin_cannot_browse_or_register(signup_api, app):
    client, _, register, _ = signup_api
    guest = app.test_client()
    for path in ("/events/registration-offers", f"/events/{EVENT_ID}/registration-offer",
                 "/events/registration-confirmations"):
        assert guest.get(path, headers=ORIGIN).status_code == 401
        assert client.get(path).status_code == 403
    path = f"/events/{EVENT_ID}/registrations"
    assert guest.post(path, json={}, headers=ORIGIN).status_code == 401
    assert client.post(path, json={}).status_code == 403
    register.assert_not_called()


def test_real_account_takes_precedence_over_a_selected_demo_identity(signup_api, monkeypatch):
    client, _, register, _ = signup_api
    monkeypatch.setattr("app.auth.get_authenticated_user", lambda: {
        "id": 1, "role": "Organiser", "display_name": "Real Organiser",
    })
    response = client.post(f"/events/{EVENT_ID}/registrations",
                           json={"information": "IS year 2"}, headers=ORIGIN)
    assert response.status_code == 403
    register.assert_not_called()


def test_full_closed_and_future_events_never_attempt_storage(signup_api):
    client, event, register, _ = signup_api
    for patch, message in (({"registered_count": 2}, "full"),
                           ({"status": "Preparation"}, "confirmed"),
                           ({"registration_opens_at": "2999-01-01T00:00:00Z"}, "not opened"),
                           ({"registration_closes_at": "2000-01-01T00:00:00Z"}, "closed")):
        original = dict(event)
        event.update(patch)
        response = client.post(f"/events/{EVENT_ID}/registrations",
                               json={"information": "IS year 2"}, headers=ORIGIN)
        assert response.status_code == 409 and message in response.json["error"]
        event.clear()
        event.update(original)
    register.assert_not_called()


def test_refresh_reads_only_the_current_attendees_receipt(signup_api, monkeypatch):
    client, event, _, saved = signup_api
    lookup = MagicMock(return_value=saved)
    monkeypatch.setattr("app.events.get_own_registration", lookup)
    event["status"] = "Preparation"
    response = client.get(f"/events/{EVENT_ID}/registration-offer", headers=ORIGIN)
    assert response.status_code == 200 and response.json["registration"] == saved
    lookup.assert_called_once_with(EVENT_ID, 5)
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("status", ["Draft", "Planning", "Cancelled", "Completed"])
def test_nonpublic_events_are_hidden_from_unregistered_attendees(signup_api, status):
    client, event, _, _ = signup_api
    event["status"] = status
    assert client.get(f"/events/{EVENT_ID}/registration-offer",
                      headers=ORIGIN).status_code == 404


@pytest.mark.parametrize("page", ["0", "10001", "x", "1.5", "-1"])
def test_browse_rejects_invalid_page_numbers(signup_api, page):
    client, _, _, _ = signup_api
    assert client.get(f"/events/registration-offers?page={page}", headers=ORIGIN).status_code == 400

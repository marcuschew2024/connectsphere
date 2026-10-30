"""SCRUM-43 acceptance intent: conditions, session ownership and safe failures."""
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError

from app.registration_withdrawal import RegistrationWithdrawal

from .conftest import ORIGIN, select_user

EVENT = "43434343-4343-4343-8343-434343434343"
PATH = f"/events/{EVENT}/registrations/withdraw"
NOW = datetime(2026, 10, 30, tzinfo=UTC)


def test_withdrawal_uses_exclusive_deadline_and_event_start_even_in_preparation():
    for status in ("Confirmed", "Preparation"):
        rules = RegistrationWithdrawal(status, (NOW + timedelta(hours=2)).isoformat(),
                                       closes_at=(NOW + timedelta(hours=1)).isoformat())
        assert rules.refusal(NOW) is None
        assert rules.refusal(NOW + timedelta(hours=1, microseconds=-1)) is None
        assert "deadline" in rules.refusal(NOW + timedelta(hours=1))
        assert "started" in rules.refusal(NOW + timedelta(hours=2))
    assert "started" in RegistrationWithdrawal("Confirmed", NOW.isoformat()).refusal(NOW)


@pytest.mark.parametrize("status", ["Draft", "Submitted", "Planning", "Rejected",
                                   "Cancelled", "Completed"])
def test_nonactive_events_cannot_be_withdrawn(status):
    assert RegistrationWithdrawal(status, "2099-01-01T00:00:00Z").refusal(NOW)


def test_undated_events_do_not_allow_withdrawal():
    assert RegistrationWithdrawal("Confirmed", None).refusal(NOW)


def test_policy_cannot_change_after_signup_or_event_start():
    rules = RegistrationWithdrawal("Confirmed", "2099-01-01T00:00:00Z")
    assert rules.can_edit(NOW, False)
    assert not rules.can_edit(NOW, True)
    assert not RegistrationWithdrawal("Completed", None).can_edit(NOW, False)
    assert not RegistrationWithdrawal("Confirmed", NOW.isoformat()).can_edit(NOW, False)


@pytest.mark.parametrize("deadline", [True, 12, "2099-01-02T00:00:00Z",
                                     "2020-01-01T00:00:00Z", "2090-01-01T00:00:00",
                                     "nonsense"])
def test_policy_rejects_invalid_or_ambiguous_conditions(deadline):
    rules = RegistrationWithdrawal("Planning", "2099-01-01T00:00:00Z")
    assert rules.policy_error(deadline, NOW)


@pytest.fixture
def withdrawal_api(app, monkeypatch):
    write = MagicMock(return_value={"status": "Withdrawn", "withdrawn_at": NOW.isoformat()})
    monkeypatch.setattr("app.events.withdraw_attendee", write)
    client = app.test_client()
    select_user(client, 5)
    return client, write


def test_withdrawal_uses_only_session_identity_and_no_store(withdrawal_api):
    client, write = withdrawal_api
    response = client.post(PATH, json={}, headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["registration"]["status"] == "Withdrawn"
    assert response.headers["Cache-Control"] == "no-store"
    write.assert_called_once_with(EVENT, 5)


@pytest.mark.parametrize("data", [None, [], {"attendee_id": 99}, {"status": "Withdrawn"},
                                  {"event_id": EVENT}])
def test_caller_cannot_supply_account_or_mutation_fields(withdrawal_api, data):
    client, write = withdrawal_api
    assert client.post(PATH, json=data, headers=ORIGIN).status_code == 400
    write.assert_not_called()


def test_query_selectors_and_untrusted_origins_are_rejected(withdrawal_api):
    client, write = withdrawal_api
    assert client.post(PATH + "?attendee_id=99", json={}, headers=ORIGIN).status_code == 400
    assert client.post(PATH, json={}).status_code == 403
    assert client.post(PATH, json={}, headers={"Origin": "https://evil.test"}).status_code == 403
    write.assert_not_called()


@pytest.mark.parametrize("actor", [1, 2, 3, 4])
def test_staff_cannot_withdraw_attendee_places(withdrawal_api, actor):
    client, write = withdrawal_api
    select_user(client, actor)
    assert client.post(PATH, json={}, headers=ORIGIN).status_code == 403
    write.assert_not_called()


def test_guest_is_denied_and_real_session_wins_over_demo(withdrawal_api, app, monkeypatch):
    client, write = withdrawal_api
    assert app.test_client().post(PATH, json={}, headers=ORIGIN).status_code == 401
    monkeypatch.setattr("app.auth.get_authenticated_user", lambda: {
        "id": 99, "role": "Attendee", "display_name": "Real attendee",
    })
    assert client.post(PATH, json={}, headers=ORIGIN).status_code == 200
    write.assert_called_once_with(EVENT, 99)


@pytest.mark.parametrize(("error", "status", "message"), [
    (APIError({"code": "PT409", "message": "withdrawal_deadline_passed"}), 409, "deadline"),
    (APIError({"code": "PT404", "message": "private row"}), 404, "not found"),
    (RuntimeError("secret connection string"), 503, "Refresh"),
])
def test_storage_refusal_is_safe_and_never_claims_success(app, monkeypatch, error, status, message):
    db = MagicMock()
    db.rpc.side_effect = error
    monkeypatch.setattr("app.registration_repository.get_supabase_client", lambda: db)
    client = app.test_client()
    select_user(client, 5)
    response = client.post(PATH, json={}, headers=ORIGIN)
    assert response.status_code == status
    assert message in response.json["error"]
    assert "secret" not in response.get_data(as_text=True)
    assert "registration" not in response.json


def test_policy_is_owner_only_and_rejects_identity_fields(app, monkeypatch):
    event = {"id": EVENT, "organiser_id": 1, "status": "Planning",
             "event_datetime": "2099-01-01T00:00:00Z"}
    monkeypatch.setattr("app.events.require_event_access", lambda *_: event)
    write = MagicMock(return_value={"closes_at": None, "can_edit": True})
    monkeypatch.setattr("app.events.set_withdrawal_policy", write)
    client = app.test_client()
    path = f"/events/{EVENT}/withdrawal-policy"
    select_user(client, 2)
    assert client.put(path, json={"closes_at": None},
                      headers=ORIGIN).status_code == 403
    select_user(client, 1)
    assert client.put(path, json={"closes_at": None, "actor_id": 1},
                      headers=ORIGIN).status_code == 400
    assert client.put(path, json={"closes_at": "2090-01-01"},
                      headers=ORIGIN).status_code == 400
    write.assert_not_called()
    assert client.put(path, json={"closes_at": None},
                      headers=ORIGIN).status_code == 200
    write.assert_called_once_with(EVENT, 1, None)

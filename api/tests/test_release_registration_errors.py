"""SCRUM-161: database refusals remain safe, actionable registration failures."""
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, ServiceUnavailable

from app.registration_repository import register_attendee, set_withdrawal_policy


@pytest.mark.parametrize("operation,error,exception,message", [
    (lambda: set_withdrawal_policy("event", 1, None),
     APIError({"code": "22023", "message": "invalid_withdrawal_policy", "details": "private SQL"}),
     BadRequest, "Check the withdrawal conditions and deadline."),
    (lambda: register_attendee("event", 5),
     APIError({"code": "XX000", "message": "private SQL connection", "details": "private SQL"}),
     ServiceUnavailable,
     "Could not confirm the registration change. Refresh the event before retrying."),
])
def test_failed_registration_operation_never_returns_success_or_private_details(
    monkeypatch, operation, error, exception, message,
):
    database = MagicMock()
    database.rpc.return_value.execute.side_effect = error
    monkeypatch.setattr("app.registration_repository.get_supabase_client", lambda: database)
    with pytest.raises(exception) as raised:
        operation()
    assert raised.value.description == message
    assert "private SQL" not in raised.value.description
    assert database.rpc.call_count == 1

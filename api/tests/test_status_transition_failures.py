"""A transition outage or missing acknowledgement must never be a success."""

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from app import event_repository as repository

from .repository_doubles import database_result


@pytest.mark.parametrize("code,expected", [
    ("PT403", Forbidden), ("PT404", NotFound), ("PT409", Conflict),
    ("22023", BadRequest), ("XX000", ServiceUnavailable),
])
def test_transition_rpc_refusal_has_safe_meaning(monkeypatch, code, expected):
    client, _ = database_result(error=APIError({"code": code, "message": "private detail"}))
    monkeypatch.setattr(repository, "get_supabase_client", lambda: client)
    with pytest.raises(expected) as error:
        repository.transition_event_intake("event", "Submitted", "Planning", 2)
    assert "private detail" not in error.value.description


@pytest.mark.parametrize("ack", [None, [], {}, {"event": None}, {"event": []}])
def test_transition_requires_saved_event_acknowledgement(monkeypatch, ack):
    client, _ = database_result(data=ack)
    monkeypatch.setattr(repository, "get_supabase_client", lambda: client)
    with pytest.raises(ServiceUnavailable):
        repository.transition_event_intake("event", "Submitted", "Planning", 2)


@pytest.mark.parametrize("configured", [False, True])
def test_transition_database_failure_is_safe(monkeypatch, configured):
    client, _ = database_result(error=RuntimeError("private connection details"))
    monkeypatch.setattr(repository, "get_supabase_client", lambda: client if configured else None)
    with pytest.raises(ServiceUnavailable) as error:
        repository.transition_event_intake("event", "Submitted", "Planning", 2)
    assert "private connection" not in error.value.description


def test_terminal_write_race_is_reported_as_conflict(monkeypatch):
    client, _ = database_result(error=APIError({"code": "PT409", "message": "terminal"}))
    monkeypatch.setattr(repository, "get_supabase_client", lambda: client)
    with pytest.raises(Conflict):
        repository.update_event_status("event", "Planning", 2)

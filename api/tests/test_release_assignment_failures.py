"""Core 5: assignment outages/refusals must not become success or private errors."""

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from app import event_repository as repository

from .repository_doubles import database_result


@pytest.mark.parametrize("function,args", [
    (repository.list_coordinators, ()),
    (repository.assign_event_coordinator, ("event", 2, 8)),
])
@pytest.mark.parametrize("failure", ["unconfigured", "outage"])
def test_assignment_database_outages_are_explicit_and_safe(monkeypatch, function, args, failure):
    client, _ = database_result(error=RuntimeError("private database credentials"))
    monkeypatch.setattr(repository, "get_supabase_client",
                        lambda: None if failure == "unconfigured" else client)
    with pytest.raises(ServiceUnavailable) as error:
        function(*args)
    assert "private" not in error.value.description


@pytest.mark.parametrize("code,expected", [
    ("PT403", Forbidden), ("PT404", NotFound), ("PT409", Conflict),
    ("22023", BadRequest), ("XX000", ServiceUnavailable),
])
def test_assignment_rpc_refusals_preserve_safe_http_meaning(monkeypatch, code, expected):
    client, _ = database_result(error=APIError({"code": code, "message": "private detail"}))
    monkeypatch.setattr(repository, "get_supabase_client", lambda: client)
    with pytest.raises(expected) as error:
        repository.assign_event_coordinator("event", 2, 8)
    assert "private detail" not in error.value.description


@pytest.mark.parametrize("acknowledgement", [None, [], {}, {"outcome": "assigned"}])
def test_assignment_without_event_acknowledgement_is_not_success(monkeypatch, acknowledgement):
    client, _ = database_result(data=acknowledgement)
    monkeypatch.setattr(repository, "get_supabase_client", lambda: client)
    with pytest.raises(ServiceUnavailable):
        repository.assign_event_coordinator("event", 2, 8)

"""SCRUM-39: confirmation requires every technical request to be fully reserved."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from werkzeug.exceptions import ServiceUnavailable

from app.equipment_request_repository import list_confirmation_requests
from app.event_confirmation import EventConfirmation

BOOKINGS = [{"status": "Confirmed"}, {"status": "Confirmed"}]


@pytest.mark.parametrize("status", [
    "Requested", "Partially fulfilled", "Unavailable", "Pending", "Unexpected", None, "",
])
def test_one_unresolved_request_blocks_even_when_everything_else_is_ready(status):
    gate = EventConfirmation.from_arrangements(BOOKINGS, [
        {"status": "Reserved"}, {"status": status},
    ])
    assert not gate.can_confirm
    assert gate.outstanding == ["Technical arrangements are not yet resolved."]


@pytest.mark.parametrize("requests", [[], [{"status": "Reserved"}] * 2])
def test_no_equipment_needed_or_every_request_reserved_allows_confirmation(requests):
    gate = EventConfirmation.from_arrangements(BOOKINGS, requests)
    assert gate.can_confirm
    assert gate.outstanding == []


@pytest.mark.parametrize("requests", [None, {}, "Reserved"])
def test_malformed_equipment_collection_is_rejected(requests):
    with pytest.raises(ValueError, match="list"):
        EventConfirmation.from_arrangements(BOOKINGS, requests)


@pytest.mark.parametrize("row", [None, {}, "Reserved"])
def test_malformed_request_does_not_allow_confirmation(row):
    assert not EventConfirmation.from_arrangements(BOOKINGS, [row]).can_confirm


@pytest.fixture
def request_store(monkeypatch):
    client = MagicMock()
    query = client.table.return_value.select.return_value.eq.return_value
    monkeypatch.setattr("app.equipment_request_repository.get_supabase_client", lambda: client)
    return query


@pytest.mark.parametrize("reservation_status,quantity,expected", [
    ("Reserved", 2, "Reserved"), ("Reserved", 1, "Partially fulfilled"),
    ("Released", 2, "Requested"), ("Cancelled", 2, "Requested"),
    ("Pending", 2, "Requested"),
])
def test_readiness_uses_current_quantities_instead_of_a_stale_reserved_label(
    request_store, reservation_status, quantity, expected,
):
    request_store.execute.return_value = SimpleNamespace(data=[{
        "id": "request", "status": "Reserved",
        "items": [{"position": 1, "equipment_id": "microphone", "quantity": 2}],
        "reservations": [{"equipment_id": "microphone", "quantity": quantity,
                          "status": reservation_status}],
    }])
    assert list_confirmation_requests("event") == [{"id": "request", "status": expected}]


def test_equipment_read_failure_never_claims_readiness(request_store):
    request_store.execute.side_effect = RuntimeError("private connection details")
    with pytest.raises(ServiceUnavailable) as error:
        list_confirmation_requests("event")
    assert "private" not in error.value.description


def test_missing_database_never_claims_readiness(monkeypatch):
    monkeypatch.setattr("app.equipment_request_repository.get_supabase_client", lambda: None)
    with pytest.raises(ServiceUnavailable):
        list_confirmation_requests("event")


def test_an_unresolved_request_beyond_the_first_page_still_blocks(request_store):
    rows = [{"id": str(i), "status": "Reserved",
             "items": [{"position": 1, "equipment_id": str(i), "quantity": 1}],
             "reservations": [{"equipment_id": str(i), "quantity": 1, "status": "Reserved"}]}
            for i in range(10)]
    rows.append({"id": "last", "status": "Requested",
                 "items": [{"position": 1, "equipment_id": "last", "quantity": 1}],
                 "reservations": []})
    request_store.execute.return_value = SimpleNamespace(data=rows)
    gate = EventConfirmation.from_arrangements(BOOKINGS, list_confirmation_requests("event"))
    assert not gate.can_confirm

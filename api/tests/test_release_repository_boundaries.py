"""SCRUM-161: persistence failures must not masquerade as successful empty results."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import Conflict, ServiceUnavailable

from app import event_repository as events
from app import venue_unavailability_repository as blocks
from app.booking_repository import list_venue_bookings_in_range

BLOCK = {
    "start_at": "2099-10-20T06:00:00Z",
    "end_at": "2099-10-20T07:00:00Z",
    "reason": "Maintenance",
    "note": "Repair",
}
OPERATIONS = [
    lambda: blocks.create_unavailability("venue", BLOCK, 3),
    lambda: blocks.list_unavailability("venue"),
    lambda: blocks.unblock_venue("block", "venue", 3),
    lambda: blocks.find_affected_bookings("venue", BLOCK["start_at"], BLOCK["end_at"]),
]


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize("configured", [False, True])
def test_block_storage_failure_is_explicit_and_hides_connection_details(
    monkeypatch, operation, configured
):
    client = MagicMock()
    client.table.side_effect = RuntimeError("PRIVATE connection credentials")
    monkeypatch.setattr(blocks, "get_supabase_client", lambda: client if configured else None)
    with pytest.raises(ServiceUnavailable) as error:
        operation()
    assert "PRIVATE" not in error.value.description
    assert "team" in error.value.description


def test_a_block_insert_without_a_receipt_cannot_claim_success(monkeypatch):
    client = MagicMock()
    client.table.return_value.insert.return_value.execute.return_value = SimpleNamespace(data=[])
    monkeypatch.setattr(blocks, "get_supabase_client", lambda: client)
    with pytest.raises(ServiceUnavailable, match="could not be saved"):
        blocks.create_unavailability("venue", BLOCK, 3)


@pytest.mark.parametrize(
    "operation", [events.list_planning_events, lambda: events.list_all_events_for_coordinator(2)]
)
@pytest.mark.parametrize("configured", [False, True])
def test_event_listing_outage_does_not_look_like_an_empty_queue(monkeypatch, operation, configured):
    client = MagicMock()
    client.table.side_effect = RuntimeError("PRIVATE SQL")
    monkeypatch.setattr(events, "get_supabase_client", lambda: client if configured else None)
    monkeypatch.setattr(events, "get_events_for_user", lambda user: [])
    with pytest.raises(ServiceUnavailable) as error:
        operation()
    assert "PRIVATE" not in error.value.description


@pytest.mark.parametrize(
    "operation,code,expected",
    [
        (lambda: events.update_event_status("event", "Planning", 2), "XX000", ServiceUnavailable),
        (lambda: events.update_event_status("event", "Planning", 2), "PT409", Conflict),
    ],
)
def test_status_write_errors_are_not_reported_as_success(monkeypatch, operation, code, expected):
    client = MagicMock()
    client.table.return_value.update.return_value.eq.return_value.execute.side_effect = APIError(
        {"code": code, "message": "PRIVATE SQL", "details": "private"},
    )
    monkeypatch.setattr(events, "get_supabase_client", lambda: client)
    with pytest.raises(expected) as error:
        operation()
    assert "PRIVATE" not in error.value.description


def test_legacy_decision_repository_returns_the_persisted_actor_and_reason(monkeypatch):
    client = MagicMock()
    saved = {"id": "event", "status": "Rejected", "decision_by": 2, "decision_reason": "Too late"}
    query = client.table.return_value.update.return_value.eq.return_value.eq.return_value
    query.execute.return_value = SimpleNamespace(data=[saved])
    monkeypatch.setattr(events, "get_supabase_client", lambda: client)
    assert events.record_event_decision("event", "Rejected", "Too late", 2) == saved
    values = client.table.return_value.update.call_args.args[0]
    assert values["decision_by"] == values["last_status_changed_by"] == 2
    assert values["decision_reason"] == "Too late" and values["decision_at"]


def test_calendar_query_widens_for_both_buffers_before_fetching_candidates(monkeypatch):
    client, query = MagicMock(), MagicMock()
    client.table.return_value = query
    for method in ("select", "eq", "in_", "lt", "gt"):
        getattr(query, method).return_value = query
    query.execute.return_value = SimpleNamespace(data=[{"id": "buffer-overlap"}])
    monkeypatch.setattr("app.booking_repository.get_supabase_client", lambda: client)
    rows = list_venue_bookings_in_range("venue", BLOCK["start_at"], BLOCK["end_at"], 30, 15)
    assert rows == [{"id": "buffer-overlap"}]
    query.lt.assert_called_once_with("start_at", "2099-10-20T07:45:00+00:00")
    query.gt.assert_called_once_with("end_at", "2099-10-20T05:15:00+00:00")

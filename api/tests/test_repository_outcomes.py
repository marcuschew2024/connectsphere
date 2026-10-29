"""Prescriptive repository outcomes: refusals, missing acknowledgements and bounded reads."""

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import (
    BadRequest,
    Conflict,
    Forbidden,
    NotFound,
    ServiceUnavailable,
)

from app import booking_repository as bookings
from app import equipment_repository as equipment
from app import equipment_request_repository as requests
from app import event_repository as events
from app import registration_repository as registrations
from app import venue_repository as venues

from .repository_doubles import database_result


@pytest.fixture
def store(monkeypatch):
    def install(module, data=None, error=None):
        client, query = database_result(data, error)
        monkeypatch.setattr(module, "get_supabase_client", lambda: client)
        return client, query
    return install


WRITES = [
    (bookings, "create_booking", ({}, 2), ServiceUnavailable),
    (bookings, "update_requested_booking", ("booking", {}, 2), Conflict),
    (bookings, "cancel_booking", ("booking", 2), Conflict),
    (bookings, "record_booking_decision", ("booking", "Confirmed", None, None, 3), Conflict),
    (venues, "create_venue", ({}, 3), ServiceUnavailable),
    (venues, "update_venue", ("venue", {}, 3, 1), ServiceUnavailable),
    (equipment, "save_equipment", ({}, 4), ServiceUnavailable),
    (equipment, "create_equipment_reservation", ("item", "event", 1, "s", "e", 4),
     ServiceUnavailable),
    (requests, "record_request", ("event", [], 2), ServiceUnavailable),
    (requests, "update_request_status", ("request", "Unavailable", "AV", 1, 4), ServiceUnavailable),
    (events, "insert_event", ({},), ServiceUnavailable),
    (events, "create_clarification", ("event", "Explain", 2), ServiceUnavailable),
    (events, "mark_clarification_resubmitted", ("event", 1), ServiceUnavailable),
    (events, "create_change_request", ("event", 1, "Later start"), ServiceUnavailable),
    (events, "update_change_request", ("event", 1, "Pending", "Approved", 2, None), Conflict),
    (events, "update_event_status", ("event", "Planning", 2), ServiceUnavailable),
    (events, "record_event_decision", ("event", "Planning", None, 2), ServiceUnavailable),
    (events, "update_event_fields", ("event", {"title": "Updated"}), ServiceUnavailable),
    (events, "complete_event_record", ("event", 2, None), ServiceUnavailable),
    (registrations, "set_registration_capacity", ("event", 1, 100), ServiceUnavailable),
]


@pytest.mark.parametrize("module,function,args,expected", WRITES,
                         ids=[f"{m.__name__}.{f}" for m, f, _, _ in WRITES])
def test_missing_write_acknowledgement_is_never_success(store, module, function, args, expected):
    store(module, [])
    with pytest.raises(expected):
        getattr(module, function)(*args)


@pytest.mark.parametrize("code", ["23P01", "23505"])
@pytest.mark.parametrize("function,args", [
    (bookings.create_booking, ({}, 2)),
    (bookings.update_requested_booking, ("booking", {}, 2)),
    (bookings.record_booking_decision, ("booking", "Confirmed", None, None, 3)),
])
def test_booking_race_conflict_is_a_retryable_refusal(store, code, function, args):
    store(bookings, error=APIError({"code": code, "message": "private constraint"}))
    with pytest.raises(Conflict) as error:
        function(*args)
    assert "no longer available" in error.value.description
    assert "private" not in error.value.description


@pytest.mark.parametrize("module,function,args,code,message,expected", [
    (venues, "create_venue", ({}, 3), "23514", "private", ServiceUnavailable),
    (venues, "update_venue", ("v", {}, 3, 1), "PT404", "private", NotFound),
    (venues, "update_venue", ("v", {}, 3, 1), "PT403", "private", Forbidden),
    (venues, "update_venue", ("v", {}, 3, 1), "XX000", "private", ServiceUnavailable),
    (equipment, "create_equipment_reservation", ("i", "e", 1, "s", "e", 4),
     "PT409", "private", Conflict),
    (equipment, "create_equipment_reservation", ("i", "e", 1, "s", "e", 4),
     "XX000", "private", ServiceUnavailable),
    (events, "complete_event_record", ("e", 2, None), "PT403", "private", Forbidden),
    (events, "complete_event_record", ("e", 2, None), "PT404", "private", NotFound),
    (events, "complete_event_record", ("e", 2, None), "PT409", "pending_bookings", Conflict),
    (events, "complete_event_record", ("e", 2, None), "PT409", "private", Conflict),
    (events, "complete_event_record", ("e", 2, None), "22023", "private", BadRequest),
    (events, "complete_event_record", ("e", 2, None), "XX000", "private", ServiceUnavailable),
    (registrations, "set_registration_capacity", ("e", 1, 10), "PT403", "private", Forbidden),
    (registrations, "set_registration_capacity", ("e", 1, 10), "PT404", "private", NotFound),
    (registrations, "set_registration_capacity", ("e", 1, 10), "PT409", "private", Conflict),
    (registrations, "set_registration_capacity", ("e", 1, 10), "22023", "private", BadRequest),
    (registrations, "register_attendee", ("e", 5, "info"), "22023",
     "registration_information_required", BadRequest),
    (registrations, "register_attendee", ("e", 5, "info"), "22023",
     "registration_information_too_long", BadRequest),
    (registrations, "register_attendee", ("e", 5), "XX000", "private", ServiceUnavailable),
])
def test_database_refusals_map_to_safe_http_errors(
    store, module, function, args, code, message, expected,
):
    store(module, error=APIError({"code": code, "message": message}))
    with pytest.raises(expected) as error:
        getattr(module, function)(*args)
    assert "private" not in error.value.description


@pytest.mark.parametrize("module,function,args,expected", [
    (bookings, "get_booking", ("missing",), None),
    (bookings, "list_requested_bookings", (), []),
    (bookings, "list_venue_bookings_in_range", ("v", "s", "e"), []),
    (venues, "get_venue", ("missing",), None),
    (equipment, "get_equipment", ("missing",), None),
    (registrations, "get_own_registration", ("e", 5), None),
    (registrations, "get_registration_confirmations", (5,), []),
    (events, "get_event_by_id", ("missing",), None),
])
def test_successful_empty_reads_are_distinct_from_outages(store, module, function, args, expected):
    store(module, [])
    assert getattr(module, function)(*args) == expected


def test_equipment_reads_keep_item_and_time_boundaries(store):
    row = {"id": "reservation", "equipment_id": "item", "quantity": 2}
    _, query = store(equipment, [row])
    assert equipment.get_reservations_for_window("start", "end", "item") == [row]
    query.eq.assert_called_with("equipment_id", "item")
    query.lt.assert_called_with("start_at", "end")
    query.gt.assert_called_with("end_at", "start")
    assert equipment.get_equipment("item") == row


def test_catalogue_pagination_uses_a_lookahead_without_returning_the_extra_row(store):
    rows = [{"id": str(i)} for i in range(7)]
    _, query = store(equipment, rows)
    assert equipment.list_equipment(2, operational_only=True) == (rows[:6], True)
    query.gt.assert_called_with("usable_quantity", 0)
    query.range.assert_called_with(6, 12)


def test_registration_discovery_lookahead_and_missing_registration(store):
    rows = [{"id": str(i)} for i in range(26)]
    _, query = store(registrations, rows)
    assert registrations.list_registration_events(2) == (rows[:25], True)
    query.eq.assert_called_with("status", "Confirmed")
    query.range.assert_called_with(25, 50)


def test_successful_booking_write_returns_the_database_acknowledgement(store):
    row = {"id": "booking", "status": "Requested"}
    _, query = store(bookings, [row])
    assert bookings.create_booking({"event_id": "event"}, 2) == row
    query.insert.assert_called_once()
    written = query.insert.call_args.args[0]
    assert written["requested_by"] == 2
    assert written["status"] == "Requested"
    assert written["requested_at"]


def test_overlap_lookup_expands_both_sides_by_the_configured_buffer(store):
    _, query = store(bookings, [])
    assert bookings.find_overlapping_bookings(
        "hall", "2099-10-20T10:00:00Z", "2099-10-20T11:00:00Z", 30,
    ) == []
    query.gt.assert_called_with("end_at", "2099-10-20T09:30:00+00:00")
    query.lt.assert_called_with("start_at", "2099-10-20T11:30:00+00:00")


def test_empty_draft_write_is_a_concurrent_edit_conflict(store):
    store(events, [])
    with pytest.raises(Conflict):
        events.save_event_draft("event", 1, {}, submitting=True)


def test_equipment_history_failure_is_not_an_empty_history(store, monkeypatch):
    monkeypatch.setattr(requests, "get_request", lambda *_: {"id": "request"})
    store(requests, error=RuntimeError("private connection details"))
    with pytest.raises(ServiceUnavailable):
        requests.list_request_history("request", {"id": 2, "role": "Coordinator"}, 1)


@pytest.mark.parametrize("role", ["Coordinator", "Tech Support"])
def test_equipment_history_is_scoped_and_hides_joined_fields(store, monkeypatch, role):
    monkeypatch.setattr(requests, "get_request", lambda *_: {"id": "request"})
    rows = [{"revision": i, "request": {"event": {"coordinator_id": 2}}} for i in range(21)]
    _, query = store(requests, rows)
    result, has_more = requests.list_request_history("request", {"id": 2, "role": role}, 2)
    assert has_more and len(result) == 20
    assert all("request" not in row for row in result)
    query.range.assert_called_with(20, 40)
    if role == "Coordinator":
        assert any(c.args == ("request.event.coordinator_id", 2) for c in query.eq.call_args_list)


def test_legacy_change_review_history_is_restored_once(store, monkeypatch):
    store(events, [{"id": 1, "action": "change_requested", "changed_at": "2026-10-01"},
                   {"id": 2, "action": "change_request_approved", "changed_at": "2026-10-03"}])
    monkeypatch.setattr(events, "get_change_requests", lambda _: [
        {"id": 9, "status": "Under Review", "reviewed_at": "2026-10-02", "reviewed_by": 2,
         "review_note": "Investigating"},
        {"id": 10, "status": "Approved", "reviewed_at": "2026-10-03"},
        {"id": 11, "status": "Pending"},
    ])
    history = events.get_status_history("event")
    assert [row["action"] for row in history] == [
        "change_requested", "change_request_under_review", "change_request_approved",
    ]
    assert history[1]["changed_by"] == 2
    assert history[1]["note"] == "Investigating"
    assert history[1]["event_id"] == "event"

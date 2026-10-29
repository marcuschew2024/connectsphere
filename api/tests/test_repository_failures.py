"""Database outages must never look like successful writes or empty, accessible data.

These are boundary unit tests; persisted happy paths and competing writes remain
the responsibility of the disposable-database acceptance suites.
"""

import importlib

import pytest
from werkzeug.exceptions import ServiceUnavailable

from .repository_doubles import database_result

USER = {"id": 2, "role": "Coordinator"}
CASES = [
    ("booking_repository", "find_overlapping_bookings", ("venue", "2099-10-20T10:00:00Z",
                                                         "2099-10-20T11:00:00Z")),
    ("booking_repository", "create_booking", ({}, 2)),
    ("booking_repository", "list_requested_bookings", ()),
    ("booking_repository", "get_booking", ("booking",)),
    ("booking_repository", "list_bookings_for_event_detail", ("event",)),
    ("booking_repository", "update_requested_booking", ("booking", {}, 2)),
    ("booking_repository", "cancel_booking", ("booking", 2)),
    ("booking_repository", "list_bookings_for_event", ("event",)),
    ("booking_repository", "record_booking_decision", ("booking", "Confirmed", None, None, 3)),
    ("booking_repository", "list_venue_bookings_in_range", ("venue", "start", "end")),
    ("venue_repository", "create_venue", ({}, 3)),
    ("venue_repository", "list_venues", (1,)),
    ("venue_repository", "get_venue", ("venue",)),
    ("venue_repository", "update_venue", ("venue", {}, 3, 1)),
    ("equipment_repository", "list_equipment", (1,)),
    ("equipment_repository", "get_equipment", ("item",)),
    ("equipment_repository", "save_equipment", ({}, 4)),
    ("equipment_repository", "get_reservations_for_window", ("start", "end")),
    ("equipment_repository", "create_equipment_reservation", ("item", "event", 1, "s", "e", 4)),
    ("equipment_repository", "list_event_equipment_reservations", ("event",)),
    ("equipment_repository", "release_equipment_reservations_for_event", ("event",)),
    ("equipment_request_repository", "list_requests", (USER, 1)),
    ("equipment_request_repository", "list_confirmation_requests", ("event",)),
    ("equipment_request_repository", "list_request_events", (2, 1)),
    ("equipment_request_repository", "get_request", ("request", USER)),
    ("equipment_request_repository", "record_request", ("event", [], 2)),
    ("equipment_request_repository", "update_request_status",
     ("request", "Unavailable", "AV", 1, 4)),
    ("equipment_request_repository", "save_request_reservations", ("request", {}, 4)),
    ("registration_repository", "set_registration_capacity", ("event", 1, 100)),
    ("registration_repository", "register_attendee", ("event", 5)),
    ("registration_repository", "list_registration_events", (1,)),
    ("registration_repository", "get_own_registration", ("event", 5)),
    ("registration_repository", "get_registration_confirmations", (5,)),
    ("event_repository", "insert_event", ({},)),
    ("event_repository", "get_event_by_id", ("event",)),
    ("event_repository", "get_events_for_user", (2,)),
    ("event_repository", "list_safety_review_events", (1,)),
    ("event_repository", "list_all_supervised_events", ()),
    ("event_repository", "save_event_draft", ("event", 1, {})),
    ("event_repository", "add_event_participant", ("event", 2, "Coordinator")),
    ("event_repository", "is_event_participant", ("event", 2)),
    ("event_repository", "add_status_history", ("event", "Planning", "Confirmed", 2)),
    ("event_repository", "get_status_history", ("event",)),
    ("event_repository", "create_clarification", ("event", "Clarify attendance", 2)),
    ("event_repository", "get_pending_clarification", ("event",)),
    ("event_repository", "get_pending_clarification_event_ids", ()),
    ("event_repository", "mark_clarification_resubmitted", ("event", 1)),
    ("event_repository", "create_change_request", ("event", 1, "Later start")),
    ("event_repository", "get_change_requests", ("event",)),
    ("event_repository", "update_change_request", ("event", 1, "Pending", "Approved", 2, "OK")),
    ("event_repository", "update_event_status", ("event", "Planning", 2)),
    ("event_repository", "list_event_equipment_requests", ("event",)),
    ("event_repository", "complete_event_record", ("event", 2, None)),
    ("event_repository", "record_event_decision", ("event", "Planning", None, 2)),
    ("event_repository", "get_notifications_for_user", (1,)),
    ("event_repository", "create_notification", (1, "event", "event_approved", "Approved")),
    ("event_repository", "update_event_fields", ("event", {"title": "Updated"})),
    ("event_repository", "log_event_edit", ("event", 2, ["title"], "ordinary")),
]


@pytest.mark.parametrize("failure", ["unconfigured", "connection_lost"])
@pytest.mark.parametrize("module_name,function_name,args", CASES,
                         ids=[f"{module}.{fn}" for module, fn, _ in CASES])
def test_database_failure_is_explicit_and_does_not_leak_internals(
    monkeypatch, module_name, function_name, args, failure,
):
    module = importlib.import_module(f"app.{module_name}")
    client, _ = database_result(error=RuntimeError("private database password and hostname"))
    monkeypatch.setattr(module, "get_supabase_client",
                        lambda: None if failure == "unconfigured" else client)
    kwargs = {"submitting": False} if function_name == "save_event_draft" else {}
    with pytest.raises(ServiceUnavailable) as error:
        getattr(module, function_name)(*args, **kwargs)
    assert error.value.code == 503
    assert "private database" not in error.value.description
    assert "password" not in error.value.description

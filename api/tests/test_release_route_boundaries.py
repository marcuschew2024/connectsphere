"""SCRUM-161: malformed requests, least privilege and editing audit failures."""

from unittest.mock import Mock, call
from uuid import uuid4

import pytest
from werkzeug.exceptions import ServiceUnavailable

from app import events
from app.event_validation import validate_event

from .conftest import ORIGIN, select_user
from .test_events import details as event_details  # noqa: F401

EVENT_ID = str(uuid4())


@pytest.fixture
def route_state(app, monkeypatch, request):
    fields, errors = validate_event(request.getfixturevalue("event_details"), submitting=True)
    assert not errors
    row = {**fields, "id": EVENT_ID, "organiser_id": 1, "coordinator_id": 2, "status": "Planning"}
    monkeypatch.setattr(events, "get_event_by_id", lambda _: row)
    monkeypatch.setattr("app.rbac.is_event_participant", lambda *args: True)
    write = Mock(side_effect=lambda _, changes: {**row, **changes})
    audit = Mock()
    monkeypatch.setattr(events, "update_event_fields", write)
    monkeypatch.setattr(events, "log_event_edit", audit)
    client = app.test_client()
    assert select_user(client, 2).status_code == 200
    return client, row, write, audit


@pytest.mark.parametrize(
    "path,method",
    [
        ("/events", "get"),
        (f"/events/{EVENT_ID}/safety-review-details", "get"),
        (f"/events/{EVENT_ID}/registration-capacity", "get"),
        (f"/events/{EVENT_ID}/withdrawal-policy", "get"),
        (f"/events/{EVENT_ID}/confirm", "post"),
        (f"/events/{EVENT_ID}/safety-check", "post"),
    ],
)
def test_event_routes_reject_an_untrusted_browser_origin(app, path, method):
    client = app.test_client()
    assert select_user(client, 1).status_code == 200
    response = getattr(client, method)(path, headers={"Origin": "https://untrusted.example"})
    assert response.status_code == 403
    assert "origin" in response.json["error"]


def test_event_list_rejects_an_unsupported_filter(app):
    client = app.test_client()
    select_user(client, 1)
    assert client.get("/events?status=Planning", headers=ORIGIN).status_code == 400


@pytest.mark.parametrize(
    "suffix,role",
    [("registrations", "Attendee"), ("confirm", "Coordinator"), ("safety-check", "Safety Officer")],
)
def test_missing_event_does_not_allow_a_registration_or_transition(app, monkeypatch, suffix, role):
    monkeypatch.setattr(events, "require_acting_user", lambda: {"id": 5, "role": role})
    monkeypatch.setattr(events, "get_event_by_id", lambda _: None)
    response = app.test_client().post(f"/events/{EVENT_ID}/{suffix}", json={}, headers=ORIGIN)
    assert response.status_code == 404


@pytest.mark.parametrize(
    "suffix,method,body",
    [
        ("", "patch", {"action": "draft"}),
        ("/registration-capacity", "put", {"capacity": 10}),
        ("/withdrawal-policy", "put", {"closes_at": None}),
    ],
)
def test_related_organiser_cannot_change_another_organisers_owned_settings(
    route_state, suffix, method, body
):
    client, row, write, _ = route_state
    select_user(client, 1)
    row["organiser_id"] = 6
    response = getattr(client, method)(f"/events/{EVENT_ID}{suffix}", json=body, headers=ORIGIN)
    assert response.status_code == 403
    assert "Organiser" in response.json["error"]
    write.assert_not_called()


def test_withdrawal_policy_rejects_query_parameters_and_closed_events(route_state):
    client, row, write, _ = route_state
    select_user(client, 1)
    assert (
        client.get(f"/events/{EVENT_ID}/withdrawal-policy?actor=6", headers=ORIGIN).status_code
        == 400
    )
    row["status"] = "Completed"
    response = client.put(
        f"/events/{EVENT_ID}/withdrawal-policy", json={"closes_at": None}, headers=ORIGIN
    )
    assert response.status_code == 409
    write.assert_not_called()


@pytest.mark.parametrize("body", [[], {"coordinator_id": 9}, {"title": ""}])
def test_planning_edit_rejects_malformed_unauthorised_or_incomplete_fields(route_state, body):
    client, _, write, audit = route_state
    assert client.patch(f"/events/{EVENT_ID}", json=body, headers=ORIGIN).status_code == 400
    write.assert_not_called()
    audit.assert_not_called()


def test_equivalent_event_details_do_not_create_a_write_or_audit_entry(route_state, request):
    client, row, write, audit = route_state
    payload = request.getfixturevalue("event_details")
    row.update(validate_event(payload, submitting=True)[0])
    response = client.patch(f"/events/{EVENT_ID}", json=payload, headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["changed_fields"] == []
    assert response.json["importance"] == "ordinary"
    write.assert_not_called()
    audit.assert_not_called()


@pytest.mark.parametrize("legacy_time", [None, "unreadable", 123])
def test_correcting_a_legacy_event_time_is_an_important_edit_even_if_audit_storage_fails(
    route_state, legacy_time, request
):
    client, row, write, audit = route_state
    payload = request.getfixturevalue("event_details")
    row.update(validate_event(payload, submitting=True)[0])
    row["event_datetime"] = legacy_time
    audit.side_effect = ServiceUnavailable("audit offline")
    response = client.patch(f"/events/{EVENT_ID}", json=payload, headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["changed_fields"] == ["event_datetime"]
    assert response.json["importance"] == "important"
    write.assert_called_once()
    audit.assert_called_once_with(EVENT_ID, 2, ["event_datetime"], "important")


def test_safety_detail_deduplicates_venues_and_does_not_expose_internal_fields(
    route_state, monkeypatch
):
    client, _, _, _ = route_state
    bookings = [
        {"venue_id": "first"},
        {"venue_id": "first"},
        {"venue_id": None},
        {"venue_id": "missing"},
    ]
    monkeypatch.setattr(events, "list_bookings_for_event_detail", lambda _: bookings)
    lookup = Mock(
        side_effect=lambda vid: {"id": vid, "capacity": 100, "created_by": 3, "operating_hours": {}}
        if vid == "first"
        else None
    )
    monkeypatch.setattr(events, "get_venue", lookup)
    monkeypatch.setattr(events, "list_event_equipment_reservations", lambda _: None)
    response = client.get(f"/events/{EVENT_ID}/safety-review-details", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json == {
        "bookings": bookings,
        "venues": [{"id": "first", "capacity": 100}],
        "equipment": {"reservations": []},
    }
    assert lookup.call_args_list == [call("first"), call("missing")]


def test_preassigned_insert_registers_both_participants(app, monkeypatch, request):
    client = app.test_client()
    select_user(client, 1)
    monkeypatch.setattr(
        events, "insert_event", lambda fields: {**fields, "id": EVENT_ID, "coordinator_id": 2}
    )
    participants, history = Mock(), Mock()
    monkeypatch.setattr(events, "add_event_participant", participants)
    monkeypatch.setattr(events, "add_status_history", history)
    response = client.post("/events", json=request.getfixturevalue("event_details"), headers=ORIGIN)
    assert response.status_code == 201
    assert participants.call_args_list == [
        call(EVENT_ID, 1, "Organiser"),
        call(EVENT_ID, 2, "Coordinator"),
    ]
    history.assert_called_once_with(EVENT_ID, None, "Submitted", 1)


def test_venue_edit_requires_an_object_and_suitability_page_has_bounds(app):
    client = app.test_client()
    select_user(client, 3)
    assert client.put(f"/venues/{uuid4()}", json=[], headers=ORIGIN).status_code == 400
    for page in ("0", "10001", "100000"):
        assert (
            client.get(f"/venues/suitability/{EVENT_ID}?page={page}", headers=ORIGIN).status_code
            == 400
        )

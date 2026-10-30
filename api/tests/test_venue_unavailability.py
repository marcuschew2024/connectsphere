from datetime import UTC, datetime, timedelta

import pytest

from app.venue_unavailability import (
    check_block_overlap,
    overlaps,
    parse_timestamp,
    validate_block,
)

from .conftest import ORIGIN, select_user

VID = "33333333-3333-4333-8333-333333333333"


def slot(hours=2):
    start = datetime(2099, 1, 1, 10, tzinfo=UTC)
    return {
        "start_at": start.isoformat(),
        "end_at": (start + timedelta(hours=hours)).isoformat(),
    }


@pytest.mark.parametrize("value,expected", [
    (None, "Start time is required."),
    ("not-a-date", "Start time must be an ISO timestamp."),
    ("2099-01-01T10:00:00", "Start time must include a timezone."),
])
def test_parse_timestamp_rejects_invalid_values(value, expected):
    _, error = parse_timestamp(value, "Start time")
    assert error == expected


def test_parse_timestamp_accepts_iso_z():
    value, error = parse_timestamp("2099-01-01T10:00:00Z", "Start time")
    assert error is None
    assert value == "2099-01-01T10:00:00Z"


def test_validate_block_accepts_supported_reason_and_normalises_note():
    data = {**slot(), "reason": "Maintenance", "note": "  Roof repair  "}
    fields, errors = validate_block(data)
    assert errors == {}
    assert fields["note"] == "Roof repair"


def test_validate_block_accepts_missing_note_and_rejects_extra_fields():
    fields, errors = validate_block({**slot(), "reason": "Safety"})
    assert errors == {} and fields["note"] is None
    assert validate_block({**slot(), "reason": "Safety", "id": "spoof"})[1]


def test_validate_block_rejects_payload_shape_reason_and_order():
    assert validate_block([])[1]["payload"]
    _, errors = validate_block({**slot(hours=-1), "reason": "Safety"})
    assert "end_at" in errors
    _, errors_both = validate_block(
        {"start_at": "invalid", "end_at": "invalid", "reason": "Safety"}
)
    assert "start_at" in errors_both and "end_at" in errors_both


def test_validate_block_rejects_invalid_note_length_and_type():
    _, errors = validate_block({**slot(), "reason": "Failure", "note": 123})
    assert errors["note"]
    _, errors = validate_block({**slot(), "reason": "Failure", "note": "x" * 2001})
    assert errors["note"]


def test_half_open_overlap_boundaries():
    assert not overlaps("2099-01-01T09:00:00Z", "2099-01-01T10:00:00Z",
                        "2099-01-01T10:00:00Z", "2099-01-01T11:00:00Z")
    assert overlaps("2099-01-01T09:59:00Z", "2099-01-01T10:01:00Z",
                    "2099-01-01T10:00:00Z", "2099-01-01T11:00:00Z")


def test_check_block_overlap():
    existing = [
        {"start_at": "2099-01-01T10:00:00Z", "end_at": "2099-01-01T12:00:00Z"},
    ]
    # Overlaps
    assert (
        check_block_overlap("2099-01-01T11:00:00Z", "2099-01-01T13:00:00Z", existing)
        == existing[0]
)
    # Adjacent (half-open) does not overlap
    assert check_block_overlap("2099-01-01T12:00:00Z", "2099-01-01T14:00:00Z", existing) is None
    # Empty list
    assert check_block_overlap("2099-01-01T10:00:00Z", "2099-01-01T12:00:00Z", []) is None


@pytest.fixture
def block_api(app, monkeypatch):
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.venues.get_venue", lambda venue_id: {"id": venue_id})
    created = {}

    def save(venue_id, fields, actor_id):
        created.update({"venue_id": venue_id, "fields": fields, "actor_id": actor_id})
        return {"id": "block-1", "venue_id": venue_id, **fields}

    monkeypatch.setattr("app.venues.create_unavailability", save)
    monkeypatch.setattr("app.venues.list_unavailability", lambda venue_id, start=None, end=None: [])
    monkeypatch.setattr(
        "app.venues.find_affected_bookings",
        lambda venue_id, start, end: [
            {"id": "booking-1", "event_id": "event-1", "requested_by": 2,
             "event": {"title": "Launch", "coordinator_id": 2}},
            {"id": "booking-2", "event_id": "event-2", "requested_by": 2,
             "event": {"title": "Workshop", "coordinator_id": 2}},
        ],
    )
    notifications = []
    monkeypatch.setattr(
        "app.venues.create_notification",
        lambda recipient, event, kind, message: notifications.append(
            {"recipient": recipient, "event": event, "kind": kind, "message": message}
        ),
    )
    client = app.test_client()
    select_user(client, 3)
    return client, created, notifications


def test_venue_staff_can_create_block_and_notify_each_coordinator_once(block_api):
    client, created, notifications = block_api
    response = client.post(
        f"/venues/{VID}/unavailability",
        json={**slot(), "reason": "Safety", "note": "Inspection"},
        headers=ORIGIN,
    )
    assert response.status_code == 201
    assert response.json["affected_booking_ids"] == ["booking-1", "booking-2"]
    assert len(notifications) == 1
    assert notifications[0]["event"] == "event-1"
    assert "alternative venue" in notifications[0]["message"]
    assert created["actor_id"] == 3 and created["venue_id"] == VID


def test_block_rejects_overlapping_active_block(block_api, monkeypatch):
    client, _, _ = block_api
    monkeypatch.setattr(
        "app.venues.list_unavailability",
        lambda venue_id, start=None, end=None: [

            {
                "id": "existing-1",
                "start_at": "2099-01-01T10:00:00Z",
                "end_at": "2099-01-01T12:00:00Z",
            },

        ],
    )
    response = client.post(
        f"/venues/{VID}/unavailability",
        json={**slot(), "reason": "Maintenance"},
        headers=ORIGIN,
    )
    assert response.status_code == 409
    assert "already blocked" in response.json["error"]


def test_block_rejects_non_staff_and_missing_venue(app, monkeypatch):
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.venues.get_venue", lambda venue_id: None)
    client = app.test_client()
    select_user(client, 2)
    assert client.post(
        f"/venues/{VID}/unavailability", json={**slot(), "reason": "Maintenance"}, headers=ORIGIN
    ).status_code == 403
    select_user(client, 3)
    assert client.post(
        f"/venues/{VID}/unavailability", json={**slot(), "reason": "Maintenance"}, headers=ORIGIN
    ).status_code == 404


def test_block_validates_payload(block_api):
    client, _, _ = block_api
    response = client.post(
        f"/venues/{VID}/unavailability",
        json={**slot(), "reason": "Unknown"},
        headers=ORIGIN,
    )
    assert response.status_code == 400
    assert response.json["fields"]["reason"]


def test_staff_and_coordinator_can_list_blocks(app, monkeypatch):
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr(
        "app.venues.list_unavailability",
        lambda venue_id, start=None, end=None: [{"id": "block-1", "venue_id": venue_id}],
    )
    client = app.test_client()
    for user_id in (2, 3):
        select_user(client, user_id)
        response = client.get(
            f"/venues/{VID}/unavailability?from=2099-01-01T00:00:00Z&to=2099-01-02T00:00:00Z",
            headers=ORIGIN,
        )
        assert response.status_code == 200 and len(response.json["blocks"]) == 1


def test_block_list_rejects_unpaired_range(app, monkeypatch):
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    client = app.test_client()
    select_user(client, 3)
    assert client.get(
        f"/venues/{VID}/unavailability?from=2099-01-01T00:00:00Z", headers=ORIGIN
    ).status_code == 400


def test_venue_staff_can_unblock(app, monkeypatch):
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr(
        "app.venues.unblock_venue",
        lambda block_id, venue_id, actor_id: {"id": block_id, "status": "Unblocked"},
    )
    client = app.test_client()
    select_user(client, 3)
    response = client.delete(f"/venues/{VID}/unavailability/block-1", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["block"]["status"] == "Unblocked"

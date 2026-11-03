"""The customer example and time-zone boundaries for maintenance queries."""

import pytest

from app.venue_unavailability import occupied_window

from .conftest import ORIGIN
from .test_venue_unavailability import VID, block_api, slot  # noqa: F401


@pytest.mark.parametrize("start,end", [
    ("2099-10-20T10:00:00+08:00", "2099-10-20T12:00:00+08:00"),
    ("2099-10-20T02:00:00Z", "2099-10-20T04:00:00Z"),
])
def test_customer_occupied_interval_is_independent_of_timestamp_offset(start, end):
    assert occupied_window(start, end, {
        "id": "room", "setup_time_minutes": 30, "turnaround_time_minutes": 45,
    }) == ("2099-10-20T01:30:00+00:00", "2099-10-20T04:45:00+00:00")


def test_venue_without_buffers_keeps_published_times():
    assert occupied_window("2099-10-20T02:00:00Z", "2099-10-20T04:00:00Z", {
        "id": "room",
    }) == ("2099-10-20T02:00:00+00:00", "2099-10-20T04:00:00+00:00")


def test_missing_recipient_never_broadcasts_or_suppresses_other_event_notice(request, monkeypatch):
    client, _, notices = request.getfixturevalue("block_api")
    monkeypatch.setattr("app.venues.find_affected_bookings", lambda *args: [
        {"id": "orphan", "event_id": "unknown", "event": {}},
        {"id": "valid", "event_id": "event-1", "requested_by": 2,
         "event": {"title": "Affected workshop", "coordinator_id": 2}},
    ])
    response = client.post(f"/venues/{VID}/unavailability", headers=ORIGIN,
                           json={**slot(), "reason": "Maintenance"})
    assert response.status_code == 201
    assert len(notices) == 1 and notices[0]["recipient"] == 2
    assert "Affected workshop" in notices[0]["message"]

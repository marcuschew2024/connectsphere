"""SCRUM-30 venue detail + availability read endpoints (route-level).

Repository functions are stubbed so these tests exercise routing, role gating, 404 and the
from/to validation — not the DB. The queries themselves live in booking_repository.
"""

import pytest

from .conftest import ORIGIN, select_user

VID = "33333333-3333-4333-8333-333333333333"
VENUE = {"id": VID, "name": "Auditorium A", "location": "L3", "operating_hours": {}}


@pytest.fixture
def stubbed(monkeypatch):
    monkeypatch.setattr("app.venues.get_venue", lambda vid: VENUE if vid == VID else None)
    monkeypatch.setattr(
        "app.venues.list_venue_bookings_in_range",
        lambda vid, frm, to: [
            {"id": "b1", "venue_id": vid, "start_at": frm, "end_at": to, "status": "Confirmed"},
        ],
    )


def _client(app, uid):
    c = app.test_client()
    assert select_user(c, uid).status_code == 200
    return c


def test_venue_detail_for_internal_user(app, stubbed):
    r = _client(app, 2).get(f"/venues/{VID}", headers=ORIGIN)  # Coordinator
    assert r.status_code == 200 and r.json["venue"]["id"] == VID


def test_venue_detail_missing_is_404(app, stubbed):
    client = _client(app, 3)  # Venue Staff
    missing = "00000000-0000-4000-8000-000000000000"
    assert client.get(f"/venues/{missing}", headers=ORIGIN).status_code == 404


def test_venue_detail_forbidden_for_organiser(app, stubbed):
    assert _client(app, 1).get(f"/venues/{VID}", headers=ORIGIN).status_code == 403  # Organiser


def test_venue_bookings_returns_range(app, stubbed):
    r = _client(app, 2).get(
        f"/venues/{VID}/bookings?from=2099-01-01T00:00:00Z&to=2099-01-08T00:00:00Z", headers=ORIGIN,
    )
    assert r.status_code == 200 and len(r.json["bookings"]) == 1


def test_venue_bookings_requires_from_and_to(app, stubbed):
    assert _client(app, 2).get(f"/venues/{VID}/bookings", headers=ORIGIN).status_code == 400

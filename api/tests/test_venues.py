"""SCRUM-24: validation, role checks, server-owned audit and safe failures."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import Conflict, ServiceUnavailable

from app import create_app
from app.venue_repository import create_venue, list_venues
from app.venue_validation import DAYS, validate_venue

from .conftest import ORIGIN, select_user


def details():
    return {
        "name": "Seminar Room A", "location": "Building B, Level 2", "capacity": 100,
        "facilities": ["Projector", "Wi-Fi"], "accessibility": ["Step-free access"],
        "supported_layouts": ["Classroom"],
        "operating_hours": {day: {"opens": "09:00", "closes": "18:00"} for day in DAYS},
    }


@pytest.fixture
def venue_api(app, monkeypatch):
    rows = []
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)

    def save(fields, actor):
        row = {**fields, "id": "venue-id", "created_by": actor,
               "created_at": "2026-09-24T06:00:00Z", "timezone": "Asia/Singapore"}
        rows.append(row)
        return row

    monkeypatch.setattr("app.venues.create_venue", save)
    monkeypatch.setattr("app.venues.list_venues", lambda page: (rows, False))
    client = app.test_client()
    select_user(client, 3)
    return client, rows


def test_staff_creates_venue_and_coordinator_can_read_it(venue_api):
    client, rows = venue_api
    response = client.post("/venues", json=details(), headers=ORIGIN)
    assert response.status_code == 201
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json["venue"]["created_by"] == 3
    assert response.json["venue"]["created_at"]
    assert len(rows) == 1
    select_user(client, 2)
    response = client.get("/venues", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["venues"][0]["name"] == "Seminar Room A"


@pytest.mark.parametrize("user_id", [1, 2, 4, 5])
def test_non_staff_cannot_create_even_with_a_direct_api_call(venue_api, user_id):
    client, rows = venue_api
    select_user(client, user_id)
    assert client.post("/venues", json=details(), headers=ORIGIN).status_code == 403
    assert not rows


@pytest.mark.parametrize("user_id", [1, 4, 5])
def test_other_roles_cannot_read_the_catalogue(venue_api, user_id):
    client, _ = venue_api
    select_user(client, user_id)
    assert client.get("/venues", headers=ORIGIN).status_code == 403


@pytest.mark.parametrize("method", ["get", "post"])
def test_venue_routes_require_a_session(app, method):
    assert getattr(app.test_client(), method)("/venues", headers=ORIGIN).status_code == 401


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://untrusted.example"}])
def test_venue_routes_require_the_frontend_origin(venue_api, headers):
    client, rows = venue_api
    assert client.post("/venues", json=details(), headers=headers).status_code == 403
    assert client.get("/venues", headers=headers).status_code == 403
    assert not rows


@pytest.mark.parametrize("field", ["id", "created_by", "created_at", "timezone", "role"])
def test_audit_and_identity_fields_cannot_be_spoofed(venue_api, field):
    client, rows = venue_api
    assert client.post("/venues", json={**details(), field: "spoof"},
                       headers=ORIGIN).status_code == 400
    assert not rows


@pytest.mark.parametrize("payload", [None, [], "venue", {}, {"name": "Only a name"}])
def test_bad_or_incomplete_payload_does_not_create_a_venue(venue_api, payload):
    client, rows = venue_api
    assert client.post("/venues", json=payload, headers=ORIGIN).status_code == 400
    assert not rows


@pytest.mark.parametrize("capacity", [0, -1, 1.5, True, "100", None, 2_147_483_648])
def test_invalid_capacity_is_explained(venue_api, capacity):
    client, rows = venue_api
    response = client.post("/venues", json={**details(), "capacity": capacity}, headers=ORIGIN)
    assert response.status_code == 400
    assert "capacity" in response.json["fields"]
    assert not rows


@pytest.mark.parametrize("field,value", [
    ("name", "  "), ("name", "n" * 201), ("location", "l" * 301),
    ("facilities", "Projector"), ("accessibility", [None]),
    ("supported_layouts", []), ("facilities", [""]),
    ("facilities", ["x"] * 21), ("facilities", ["x" * 81]),
])
def test_invalid_venue_fields_are_rejected(field, value):
    _, errors = validate_venue({**details(), field: value})
    assert field in errors


@pytest.mark.parametrize("slot", [
    {"opens": "18:00", "closes": "09:00"}, {"opens": "09:00", "closes": "09:00"},
    {"opens": "24:00", "closes": "25:00"}, {"opens": "9:00", "closes": "18:00"},
    {"opens": "09:60", "closes": "18:00"}, {"opens": 9, "closes": "18:00"},
    {"opens": "09:00"}, "closed", [],
    {"opens": "09:00", "closes": "18:00", "extra": True},
])
def test_invalid_opening_intervals_have_a_day_specific_error(slot):
    data = details()
    data["operating_hours"]["monday"] = slot
    _, errors = validate_venue(data)
    assert "operating_hours.monday" in errors


@pytest.mark.parametrize("hours", [None, {}, [], {day: None for day in DAYS}])
def test_hours_require_a_week_with_at_least_one_open_day(hours):
    _, errors = validate_venue({**details(), "operating_hours": hours})
    assert "operating_hours" in errors


def test_valid_boundaries_and_feature_normalisation():
    data = details()
    data.update({"name": "n" * 200, "location": "l" * 300, "capacity": 1,
                 "facilities": [" Projector ", "projector"], "accessibility": []})
    data["operating_hours"] = {day: None for day in DAYS}
    data["operating_hours"]["monday"] = {"opens": "00:00", "closes": "23:59"}
    original = deepcopy(data)
    clean, errors = validate_venue(data)
    assert not errors
    assert clean["facilities"] == ["Projector"]
    assert clean["accessibility"] == []
    assert data == original


@pytest.mark.parametrize("query", ["page=0", "page=-1", "page=abc", "page=1.2",
                                   "page=10001", "page=１２", "page=", "created_by=3"])
def test_invalid_catalogue_page_is_rejected(venue_api, query):
    client, _ = venue_api
    assert client.get(f"/venues?{query}", headers=ORIGIN).status_code == 400


def test_real_login_can_create_venues_without_enabling_the_demo_switcher(monkeypatch):
    app = create_app({"TESTING": True, "APP_ENV": "production", "SECRET_KEY": "test-only",
                      "FRONTEND_ORIGIN": ORIGIN["Origin"]})
    db = MagicMock()
    query = db.table.return_value.select.return_value.eq.return_value.limit.return_value
    query.execute.return_value = SimpleNamespace(
        data=[{"id": 42, "role": "Venue Staff", "display_name": "Venue Manager"}]
    )
    monkeypatch.setattr("app.auth.get_supabase_client", lambda: db)
    monkeypatch.setattr(
        "app.venues.create_venue", lambda fields, actor: {**fields, "created_by": actor}
    )
    client = app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = 42
    response = client.post("/venues", json=details(), headers=ORIGIN)
    assert response.status_code == 201
    assert response.json["venue"]["created_by"] == 42


def test_repository_maps_duplicate_and_hides_database_errors(monkeypatch):
    db = MagicMock()
    monkeypatch.setattr("app.venue_repository.get_supabase_client", lambda: db)
    db.table.side_effect = APIError({
        "code": "23505", "message": "private", "details": "", "hint": "",
    })
    with pytest.raises(Conflict, match="name and location already exists"):
        create_venue(details(), 3)
    db.table.side_effect = RuntimeError("private connection details")
    with pytest.raises(ServiceUnavailable, match="Check the catalogue before retrying"):
        create_venue(details(), 3)
    with pytest.raises(ServiceUnavailable, match="Please try again"):
        list_venues(1)


def test_missing_database_is_explained(monkeypatch):
    monkeypatch.setattr("app.venue_repository.get_supabase_client", lambda: None)
    with pytest.raises(ServiceUnavailable, match="not configured"):
        create_venue(details(), 3)

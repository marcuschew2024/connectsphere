"""API tests for retiring a venue and what a retired venue still allows (SCRUM-26).

The pure rules are unit-tested in test_venue_retirement.py and the transactional
retire_venue() function in test_venue_retirement_acceptance.py. These tests cover the
endpoint wiring: who may retire, input checks, refusals, Coordinators no longer being
offered a retired venue, bookings refused, the read-only venue and how database
refusals are reported. Database calls are monkeypatched.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from postgrest.exceptions import APIError
from werkzeug.exceptions import Conflict, Forbidden, NotFound, ServiceUnavailable

from app.venue_repository import get_display_name, retire_venue_record

from .conftest import ORIGIN, select_user
from .test_bookings import booking_api, payload  # noqa: F401
from .test_venue_updates import changes
from .test_venues import details

VENUE_ID = "11111111-1111-4111-8111-111111111111"
URL = f"/venues/{VENUE_ID}/retire"


def venue(retired=False, **extra):
    return {**details(), "id": VENUE_ID, "revision": 1, "is_retired": retired,
            "retired_at": "2026-10-31T02:00:00+00:00" if retired else None,
            "retired_by": 3 if retired else None, **extra}


@pytest.fixture
def retiring(app, monkeypatch):
    """A Venue Staff session, one active venue and a recorded retire_venue() call."""
    state = {"venue": venue(), "calls": []}
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    monkeypatch.setattr(
        "app.venues.get_venue",
        lambda venue_id: state["venue"] if venue_id == VENUE_ID else None,
    )

    def retire(venue_id, actor_id):
        state["calls"].append((venue_id, actor_id))
        return {"venue": {**state["venue"], "is_retired": True,
                          "retired_at": "2026-10-31T02:00:00+00:00", "retired_by": actor_id,
                          "revision": 2},
                "kept_confirmed_bookings": 2}

    monkeypatch.setattr("app.venues.retire_venue_record", retire)
    client = app.test_client()
    select_user(client, 3)
    return client, state


# Retiring records the actor and time and keeps confirmed bookings (AC2, AC3).
def test_venue_staff_retires_a_venue(retiring):
    client, state = retiring

    response = client.post(URL, json={}, headers=ORIGIN)

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    retired = response.json["venue"]
    assert retired["is_retired"] is True
    assert retired["retired_by"] == 3 and retired["retired_at"]
    assert retired["retired_by_name"] == "Demo Venue Staff"
    assert response.json["kept_confirmed_bookings"] == 2
    assert state["calls"] == [(VENUE_ID, 3)]


def test_a_request_without_a_body_is_accepted(retiring):
    client, state = retiring
    assert client.post(URL, headers=ORIGIN).status_code == 200
    assert state["calls"] == [(VENUE_ID, 3)]


@pytest.mark.parametrize("user_id", [1, 2, 4, 5])
def test_only_venue_staff_can_retire(retiring, user_id):
    client, state = retiring
    select_user(client, user_id)
    assert client.post(URL, json={}, headers=ORIGIN).status_code == 403
    assert state["calls"] == []


def test_retiring_requires_a_session_and_trusted_origin(app, retiring):
    client, state = retiring
    assert app.test_client().post(URL, json={}, headers=ORIGIN).status_code == 401
    assert client.post(URL, json={}).status_code == 403
    assert client.post(
        URL, json={}, headers={"Origin": "https://attacker.example"}
    ).status_code == 403
    assert state["calls"] == []


@pytest.mark.parametrize("body", [{"retired_by": 1}, {"retired_at": "2020-01-01"}, ["x"]])
def test_audit_fields_cannot_be_supplied(retiring, body):
    client, state = retiring
    response = client.post(URL, json=body, headers=ORIGIN)
    assert response.status_code == 400
    assert "recorded automatically" in response.json["error"]
    assert state["calls"] == []


def test_an_already_retired_venue_is_refused(retiring):
    client, state = retiring
    state["venue"] = venue(retired=True)
    response = client.post(URL, json={}, headers=ORIGIN)
    assert response.status_code == 409
    assert response.json["error"] == "This venue is already retired."
    assert state["calls"] == []


@pytest.mark.parametrize("path", [
    "/venues/22222222-2222-4222-8222-222222222222/retire", "/venues/not-a-uuid/retire",
])
def test_an_unknown_venue_is_not_found(retiring, path):
    client, state = retiring
    assert client.post(path, json={}, headers=ORIGIN).status_code == 404
    assert state["calls"] == []


def test_database_refusals_reach_the_user(retiring, monkeypatch):
    client, _ = retiring

    def refuse(venue_id, actor_id):
        raise Conflict("Decide the 2 outstanding booking requests for this venue before "
                       "retiring it.")

    monkeypatch.setattr("app.venues.retire_venue_record", refuse)
    response = client.post(URL, json={}, headers=ORIGIN)
    assert response.status_code == 409
    assert "2 outstanding booking requests" in response.json["error"]


# A retired venue keeps its record and is shown with its retirement (AC1, AC3).
def test_a_retired_venue_is_still_readable_with_who_retired_it(retiring, monkeypatch):
    client, state = retiring
    state["venue"] = venue(retired=True)
    monkeypatch.setattr("app.venues.get_display_name", lambda user_id: f"User {user_id}")
    for user_id in (2, 3):
        select_user(client, user_id)
        response = client.get(f"/venues/{VENUE_ID}", headers=ORIGIN)
        assert response.status_code == 200
        assert response.json["venue"]["retired_by_name"] == "User 3"


def test_an_active_venue_detail_needs_no_extra_lookup(retiring, monkeypatch):
    client, _ = retiring
    lookup = MagicMock()
    monkeypatch.setattr("app.venues.get_display_name", lookup)
    response = client.get(f"/venues/{VENUE_ID}", headers=ORIGIN)
    assert "retired_by_name" not in response.json["venue"]
    lookup.assert_not_called()


def test_a_retired_venue_cannot_be_edited(retiring, monkeypatch):
    client, state = retiring
    state["venue"] = venue(retired=True)
    save = MagicMock()
    monkeypatch.setattr("app.venues.update_venue", save)
    response = client.put(f"/venues/{VENUE_ID}", json=changes(), headers=ORIGIN)
    assert response.status_code == 409
    assert "cannot be edited" in response.json["error"]
    save.assert_not_called()


# Retired venues are excluded from Coordinators' new-booking searches (AC1).
CATALOGUE = [
    {**details(), "id": "active-1", "location": "Building B"},
    {**details(), "id": "retired-1", "location": "Building B", "is_retired": True},
    {**details(), "id": "active-2", "location": "Building B"},
]


@pytest.fixture
def catalogue(app, monkeypatch):
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    monkeypatch.setattr("app.venues.list_venues", lambda page: (CATALOGUE, False))
    monkeypatch.setattr("app.venue_search.list_venues", lambda page: (CATALOGUE, False))
    return app.test_client()


@pytest.mark.parametrize("query", ["", "?location=Building"])
def test_coordinators_are_not_offered_retired_venues(catalogue, query):
    select_user(catalogue, 2)
    response = catalogue.get(f"/venues{query}", headers=ORIGIN)
    assert response.status_code == 200
    assert [row["id"] for row in response.json["venues"]] == ["active-1", "active-2"]


@pytest.mark.parametrize("query", ["", "?location=Building"])
def test_venue_staff_still_see_retired_venues_for_history(catalogue, query):
    select_user(catalogue, 3)
    response = catalogue.get(f"/venues{query}", headers=ORIGIN)
    assert [row["id"] for row in response.json["venues"]] == ["active-1", "retired-1", "active-2"]


def test_coordinator_pages_stay_full_when_venues_are_retired(app, monkeypatch):
    """Retired venues are skipped before pagination, so no page comes back short."""
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    rows = [{**details(), "id": f"venue-{index}", "is_retired": index % 2 == 0}
            for index in range(20)]
    monkeypatch.setattr(
        "app.venues.list_venues",
        lambda page: (rows[(page - 1) * 6:page * 6], page * 6 < len(rows)),
    )
    client = app.test_client()
    select_user(client, 2)
    first = client.get("/venues?page=1", headers=ORIGIN).json
    second = client.get("/venues?page=2", headers=ORIGIN).json
    assert [row["id"] for row in first["venues"]] == [f"venue-{n}" for n in (1, 3, 5, 7, 9, 11)]
    assert first["has_more"] is True
    assert [row["id"] for row in second["venues"]] == [f"venue-{n}" for n in (13, 15, 17, 19)]
    assert second["has_more"] is False


def test_suitability_ranking_leaves_out_retired_venues(catalogue, monkeypatch):
    monkeypatch.setattr("app.venues.get_event_by_id", lambda event_id: {
        "id": event_id, "expected_attendance": 20, "event_datetime": "2099-10-20T06:00:00Z",
    })
    select_user(catalogue, 2)
    response = catalogue.get("/venues/suitability/event-1", headers=ORIGIN)
    assert response.status_code == 200
    assert [row["venue_id"] for row in response.json["venues"]] == ["active-1", "active-2"]


# A retired venue takes no new or moved booking requests (AC1).
def test_a_new_booking_request_for_a_retired_venue_is_refused(booking_api, monkeypatch):  # noqa: F811
    client, created, notifications, _ = booking_api
    monkeypatch.setattr("app.bookings.get_venue", lambda venue_id: {
        "id": venue_id, "capacity": 300, "is_retired": True,
    })
    response = client.post("/venues/bookings", json=payload(), headers=ORIGIN)
    assert response.status_code == 409
    assert response.json["error"] == "This venue is retired and no longer accepts bookings."
    assert created == [] and notifications == []


def test_a_request_cannot_be_moved_to_a_retired_venue(booking_api, monkeypatch):  # noqa: F811
    client, _, _, event = booking_api
    monkeypatch.setattr("app.bookings.get_booking", lambda booking_id: {
        "id": booking_id, "event_id": event["id"], "venue_id": "venue-1",
        "requested_by": 2, "status": "Requested", **{k: v for k, v in payload().items()
                                                   if k not in {"event_id", "venue_id"}},
    })
    monkeypatch.setattr("app.bookings.get_venue", lambda venue_id: {
        "id": venue_id, "capacity": 300, "is_retired": venue_id == "venue-retired",
    })
    save = MagicMock()
    monkeypatch.setattr("app.bookings.update_requested_booking", save)
    response = client.patch(
        "/venues/bookings/booking-1", json={"venue_id": "venue-retired"}, headers=ORIGIN,
    )
    assert response.status_code == 409
    assert "retired" in response.json["error"]
    save.assert_not_called()


# --- Repository: how retire_venue() refusals are reported ---

def _client_returning(data=None, error=None):
    def execute():
        if error:
            raise error
        return SimpleNamespace(data=data)

    return SimpleNamespace(rpc=lambda name, params: SimpleNamespace(execute=execute))


@pytest.mark.parametrize(
    ("code", "message", "details", "exception", "text"),
    [
        ("PT403", "Venue Staff required", None, Forbidden, "Only Venue Staff"),
        ("PT404", "Venue not found", None, NotFound, "Venue not found"),
        ("PT409", "already_retired", None, Conflict, "already retired"),
        ("PT409", "outstanding_requests", "1", Conflict, "the 1 outstanding booking request "),
        ("PT409", "outstanding_requests", "4", Conflict, "the 4 outstanding booking requests"),
        ("PT409", "outstanding_requests", None, Conflict, "outstanding booking requests"),
        ("PT409", "something_new", None, ServiceUnavailable, "Reload it"),
        ("42883", "function does not exist", None, ServiceUnavailable, "Reload it"),
    ],
)
def test_database_refusals_are_translated(monkeypatch, code, message, details, exception, text):
    error = APIError({"code": code, "message": message, "details": details, "hint": None})
    monkeypatch.setattr(
        "app.venue_repository.get_supabase_client", lambda: _client_returning(error=error),
    )
    with pytest.raises(exception) as raised:
        retire_venue_record(VENUE_ID, 3)
    assert text in raised.value.description


@pytest.mark.parametrize("make", [
    lambda: None,
    lambda: _client_returning(data=["not", "a", "dict"]),
    lambda: _client_returning(data={"kept_confirmed_bookings": 0}),
    lambda: SimpleNamespace(rpc=lambda name, params: (_ for _ in ()).throw(OSError())),
])
def test_an_unconfirmed_retirement_is_reported(monkeypatch, make):
    monkeypatch.setattr("app.venue_repository.get_supabase_client", make)
    with pytest.raises(ServiceUnavailable):
        retire_venue_record(VENUE_ID, 3)


def test_a_confirmed_retirement_is_returned(monkeypatch):
    result = {"venue": {"id": VENUE_ID, "is_retired": True}, "kept_confirmed_bookings": 1}
    monkeypatch.setattr(
        "app.venue_repository.get_supabase_client", lambda: _client_returning(data=result),
    )
    assert retire_venue_record(VENUE_ID, 3) == result


def test_display_name_lookup_is_best_effort(monkeypatch):
    query = MagicMock()
    query.select.return_value = query
    query.eq.return_value = query
    query.execute.return_value = SimpleNamespace(data=[{"display_name": "Demo Venue Staff"}])
    monkeypatch.setattr("app.venue_repository.get_supabase_client",
                        lambda: SimpleNamespace(table=lambda name: query))
    assert get_display_name(3) == "Demo Venue Staff"
    query.execute.return_value = SimpleNamespace(data=[])
    assert get_display_name(3) is None
    monkeypatch.setattr("app.venue_repository.get_supabase_client", lambda: None)
    assert get_display_name(3) is None

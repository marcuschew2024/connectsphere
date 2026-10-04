"""SCRUM-28: filters, pagination, availability and the authenticated API contract."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from werkzeug.datastructures import MultiDict
from werkzeug.exceptions import BadRequest, ServiceUnavailable

from app.booking_repository import find_overlapping_bookings
from app.venue_search import (
    availability,
    filter_options,
    matches_filters,
    parse_filters,
    search_venues,
)

from .conftest import ORIGIN, select_user
from .test_venues import details


def filters(**values):
    return parse_filters(MultiDict(values))


def slot(**values):
    return filters(date="2026-10-05", start_time="09:00", end_time="18:00", **values)


def test_combined_filters_match_case_whitespace_and_inclusive_capacity():
    venue = details()
    original = deepcopy(venue)
    query = filters(location="building b", attendance="100", capacity="99", layout=" classroom ",
                    facilities="projector, WI-FI", accessibility=" step-free   access ")
    assert matches_filters(venue, query)
    assert venue == original


@pytest.mark.parametrize("values", [
    {"location": "Building C"}, {"attendance": "101"}, {"capacity": "101"},
    {"layout": "Theatre"}, {"facilities": "Projector, Stage"},
    {"accessibility": "Hearing loop"}, {"facilities": "Project"},
])
def test_each_filter_can_exclude_a_venue(values):
    assert not matches_filters(details(), filters(**values))


@pytest.mark.parametrize("values", [
    {"attendance": "0"}, {"capacity": "-1"}, {"attendance": "1.5"},
    {"capacity": "2147483648"}, {"attendance": "１２"}, {"capacity": "1" * 5000},
    {"location": "a" * 301}, {"layout": "a" * 81}, {"facilities": "a,,b"},
    {"facilities": "a" * 81}, {"accessibility": ",".join(["a"] * 21)},
    {"date": "2026-10-05"}, {"start_time": "09:00", "end_time": "10:00"},
    {"date": "2026-02-30", "start_time": "09:00", "end_time": "10:00"},
    {"date": "20261005", "start_time": "09:00", "end_time": "10:00"},
    {"date": "2026-10-05", "start_time": "9:00", "end_time": "10:00"},
    {"date": "2026-10-05", "start_time": "09:00", "end_time": "24:00"},
    {"date": "2026-10-05", "start_time": "10:00", "end_time": "10:00"},
    {"date": "2026-10-05", "start_time": "18:00", "end_time": "09:00"},
    {"created_by": "3"},
])
def test_invalid_filters_have_a_client_error(values):
    with pytest.raises(BadRequest):
        filters(**values)


def test_repeated_parameters_are_rejected_and_blank_optional_filters_are_ignored():
    with pytest.raises(BadRequest):
        parse_filters(MultiDict([("page", "1"), ("page", "2")]))
    assert filters(location=" ", facilities="", date="") == {}


def test_search_filters_before_pagination_and_preserves_rows(monkeypatch):
    # A full source page fails the filter; matching rows span later pages.
    rows = [{**details(), "id": str(index), "capacity": 10 if index < 6 else 100}
            for index in range(20)]
    original = deepcopy(rows)

    def read(page):
        start = (page - 1) * 6
        return rows[start:start + 6], start + 6 < len(rows)

    monkeypatch.setattr("app.venue_search.list_venues", read)
    first, more = search_venues(1, filters(attendance="100"))
    second, more2 = search_venues(2, filters(attendance="100"))
    last, more3 = search_venues(3, filters(attendance="100"))
    assert [row["id"] for row in first + second + last] == [str(i) for i in range(6, 20)]
    assert more and more2 and not more3
    assert all(row["search_availability"] == "not_checked" for row in first)
    assert search_venues(4, filters(attendance="100")) == ([], False)
    assert search_venues(1, filters(attendance="101")) == ([], False)
    assert rows == original


@pytest.mark.parametrize("statuses,expected", [
    ([], "available"), (["Confirmed"], "booked"), (["Blocked"], "blocked"),
    (["Confirmed", "Blocked"], "blocked"),
])
def test_availability_uses_existing_booking_check_with_singapore_offset(
    monkeypatch, statuses, expected,
):
    check = MagicMock(return_value=[{"status": status} for status in statuses])
    monkeypatch.setattr("app.venue_search.find_overlapping_bookings", check)
    assert availability({**details(), "id": "venue-1"}, slot()) == expected
    check.assert_called_once_with("venue-1", "2026-10-05T09:00:00+08:00",
                                  "2026-10-05T18:00:00+08:00")


def test_retired_closed_and_unchecked_do_not_query_bookings(monkeypatch):
    check = MagicMock()
    monkeypatch.setattr("app.venue_search.find_overlapping_bookings", check)
    venue = details()
    assert availability({**venue, "is_retired": True}, slot()) == "retired"
    assert availability({**venue, "is_retired": True}, {}) == "retired"
    assert availability(venue, {}) == "not_checked"
    query = filters(date="2026-10-05", start_time="08:59", end_time="10:00")
    assert availability(venue, query) == "closed"
    query = filters(date="2026-10-05", start_time="17:00", end_time="18:01")
    assert availability(venue, query) == "closed"
    venue["operating_hours"]["monday"] = None
    assert availability(venue, slot()) == "closed"
    check.assert_not_called()


def test_database_failure_never_claims_available(monkeypatch):
    monkeypatch.setattr("app.venue_search.find_overlapping_bookings",
                        MagicMock(side_effect=ServiceUnavailable("Could not check availability.")))
    with pytest.raises(ServiceUnavailable):
        availability({**details(), "id": "venue-1"}, slot())


def test_overlap_query_keeps_half_open_boundaries_and_ignores_unconfirmed_requests(monkeypatch):
    db = MagicMock()
    query = MagicMock()
    db.table.return_value = query
    for method in ("select", "eq", "in_", "lt", "gt"):
        getattr(query, method).return_value = query
    query.execute.return_value = SimpleNamespace(data=[])
    monkeypatch.setattr("app.booking_repository.get_supabase_client", lambda: db)
    assert find_overlapping_bookings("venue-1", "start", "end") == []
    query.in_.assert_called_once_with("status", ["Confirmed", "Blocked"])
    query.lt.assert_called_once_with("start_at", "end")
    query.gt.assert_called_once_with("end_at", "start")


@pytest.fixture
def search_api(app, monkeypatch):
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    monkeypatch.setattr("app.venue_search.list_venues",
                        lambda page: ([{**details(), "id": "venue-1"}], False))
    return app.test_client()


@pytest.mark.parametrize("user_id,status", [(1, 403), (2, 200), (3, 200), (4, 403), (5, 403)])
def test_search_preserves_catalogue_permissions(search_api, user_id, status):
    select_user(search_api, user_id)
    response = search_api.get("/venues?attendance=100&location=Building", headers=ORIGIN)
    assert response.status_code == status
    assert response.headers["Cache-Control"] == "no-store"
    if status == 200:
        assert response.json["venues"][0]["id"] == "venue-1"
        assert response.json["page"] == 1
        assert response.json["has_more"] is False


def test_search_requires_session_and_origin(search_api):
    assert search_api.get("/venues?location=B", headers=ORIGIN).status_code == 401
    select_user(search_api, 2)
    assert search_api.get("/venues?location=B").status_code == 403


def test_api_validation_and_empty_results(search_api):
    select_user(search_api, 2)
    invalid = search_api.get("/venues?attendance=-1", headers=ORIGIN)
    assert invalid.status_code == 400
    assert "positive whole number" in invalid.json["error"]
    response = search_api.get("/venues?attendance=101", headers=ORIGIN)
    assert response.json == {"venues": [], "page": 1, "has_more": False}


@pytest.mark.parametrize("values", [{"available_only": "yes"}, {"available_only": "true"}])
def test_available_only_needs_a_valid_toggle_and_complete_slot(values):
    with pytest.raises(BadRequest):
        filters(**values)


def test_available_only_false_can_browse_without_a_slot():
    assert filters(available_only="false") == {"available_only": False}


def test_available_only_filters_before_pagination_and_checks_each_venue_once(monkeypatch):
    rows = [{**details(), "id": str(index)} for index in range(16)]
    monkeypatch.setattr("app.venue_search.list_venues", lambda page: (
        rows[(page - 1) * 6:page * 6], page * 6 < len(rows),
    ))
    check = MagicMock(side_effect=lambda venue, _: "available" if int(venue["id"]) % 2
                     else "booked")
    monkeypatch.setattr("app.venue_search.availability", check)
    first, more = search_venues(1, slot(available_only="true"))
    assert [row["id"] for row in first] == ["1", "3", "5", "7", "9", "11"]
    assert more is True
    assert check.call_count == 14  # Includes the next available result, checked once.
    last, more = search_venues(2, slot(available_only="true"))
    assert [row["id"] for row in last] == ["13", "15"]
    assert more is False


def test_suggestions_include_later_pages_deduplicate_and_exclude_retired(monkeypatch):
    monkeypatch.setattr("app.venue_search.list_venues", lambda page: (
        [{**details(), "facilities": ["Projector", " projectOR "]}], True,
    ) if page == 1 else (
        [{**details(), "facilities": ["Stage"]},
         {**details(), "is_retired": True, "facilities": ["Retired-only feature"]}], False,
    ))
    assert filter_options() == {"facilities": ["Projector", "Stage"],
                                "accessibility": ["Step-free access"]}


@pytest.mark.parametrize("user_id,status", [(1, 403), (2, 200), (3, 200), (4, 403), (5, 403)])
def test_suggestions_require_catalogue_permissions(search_api, user_id, status):
    select_user(search_api, user_id)
    response = search_api.get("/venues/filter-options", headers=ORIGIN)
    assert response.status_code == status
    if status == 200:
        assert response.json["facilities"] == ["Projector", "Wi-Fi"]

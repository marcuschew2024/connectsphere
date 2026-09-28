"""
Combined Unit and API Integration Test Suite for SCRUM-29 Venue Suitability.

This file contains both:
1. Unit Tests for Suitability Engine & Rules (app.venue_suitability)
2. Integration Tests for the Flask HTTP Endpoint (GET /venues/<v_id>/suitability/<e_id>)

Ensures 100% statement and branch coverage across all rules, fallback paths, and API status codes.
"""

from unittest.mock import patch

from app.venue_suitability import (
    AccessibilityRule,
    CapacityRule,
    FacilityRule,
    LayoutRule,
    SuitabilityEngine,
    SuitabilityRule,
)

from .conftest import ORIGIN, select_user


# Custom dummy rule for testing custom rule engine injection
class AlwaysWarnRule(SuitabilityRule):
    def evaluate(self, event: dict, venue: dict) -> str | None:
        return "Always custom warning"


# ============================================================================
# UNIT TESTING
# ============================================================================

# --------------- CapacityRule ---------------

def test_capacity_rule_passes_when_attendance_is_within_capacity():
    rule = CapacityRule()
    event = {"expected_attendance": 80}
    venue = {"capacity": 100}
    assert rule.evaluate(event, venue) is None


def test_capacity_rule_passes_on_exact_capacity_match():
    rule = CapacityRule()
    event = {"expected_attendance": 100}
    venue = {"capacity": 100}
    assert rule.evaluate(event, venue) is None


def test_capacity_rule_flags_when_attendance_exceeds_capacity():
    rule = CapacityRule()
    event = {"expected_attendance": 150}
    venue = {"capacity": 100}
    result = rule.evaluate(event, venue)
    assert result == "Expected attendance (150 pax) exceeds venue capacity (100 pax) by 50 pax."


def test_capacity_rule_handles_string_numbers():
    rule = CapacityRule()
    event = {"expected_attendance": "150"}
    venue = {"capacity": "100"}
    result = rule.evaluate(event, venue)
    assert result == "Expected attendance (150 pax) exceeds venue capacity (100 pax) by 50 pax."


def test_capacity_rule_handles_missing_expected_attendance():
    rule = CapacityRule()
    assert rule.evaluate({}, {"capacity": 100}) is None
    assert rule.evaluate({"expected_attendance": None}, {"capacity": 100}) is None


def test_capacity_rule_handles_missing_venue_capacity():
    rule = CapacityRule()
    assert rule.evaluate({"expected_attendance": 100}, {}) is None
    assert rule.evaluate({"expected_attendance": 100}, {"capacity": None}) is None


def test_capacity_rule_handles_invalid_non_numeric_values():
    rule = CapacityRule()
    assert rule.evaluate({"expected_attendance": "invalid"}, {"capacity": 100}) is None
    assert rule.evaluate({"expected_attendance": 100}, {"capacity": "invalid"}) is None


# --------------- LayoutRule ---------------

def test_layout_rule_passes_when_no_requirements_specified():
    rule = LayoutRule()
    assert rule.evaluate({}, {"supported_layouts": ["Banquet"]}) is None
    assert rule.evaluate({"venue_requirements": "   "}, {"supported_layouts": ["Banquet"]}) is None


def test_layout_rule_passes_when_requested_layout_is_supported():
    rule = LayoutRule()
    event = {"venue_requirements": "Requires Banquet layout and stage"}
    venue = {"supported_layouts": ["Banquet", "Theatre"]}
    assert rule.evaluate(event, venue) is None


def test_layout_rule_flags_when_requested_layout_is_unsupported():
    rule = LayoutRule()
    event = {"venue_requirements": "Requires Banquet layout"}
    venue = {"supported_layouts": ["Theatre", "Classroom"]}
    result = rule.evaluate(event, venue)
    assert result is not None
    assert "not listed in the venue's supported layouts" in result
    assert "Banquet" in result


def test_layout_rule_handles_theater_spelling_normalisation():
    rule = LayoutRule()
    event = {"venue_requirements": "Theater style seating"}
    venue = {"supported_layouts": ["Theatre"]}
    assert rule.evaluate(event, venue) is None


def test_layout_rule_handles_none_supported_layouts():
    rule = LayoutRule()
    event = {"venue_requirements": "Requires Banquet layout"}
    venue = {"supported_layouts": None}
    result = rule.evaluate(event, venue)
    assert result is not None
    assert "not listed in the venue's supported layouts" in result
    assert "Banquet" in result


# --------------- FacilityRule ---------------

def test_facility_rule_passes_when_no_facility_required():
    rule = FacilityRule()
    assert rule.evaluate({}, {"facilities": ["Projector"]}) is None


def test_facility_rule_passes_when_all_facilities_present():
    rule = FacilityRule()
    event = {
        "venue_requirements": "Projector needed",
        "equipment_requirements": "Sound System",
    }
    venue = {"facilities": ["HD Projector", "Wireless Sound System"]}
    assert rule.evaluate(event, venue) is None


def test_facility_rule_flags_missing_facilities():
    rule = FacilityRule()
    event = {"venue_requirements": "Projector and Stage required"}
    venue = {"facilities": ["Whiteboard"]}
    result = rule.evaluate(event, venue)
    assert "Missing required facility feature(s): Projector, Stage." in result


# ---------------  AccessibilityRule ------------------

def test_accessibility_rule_passes_when_none_required():
    rule = AccessibilityRule()
    assert rule.evaluate({}, {"accessibility": ["Ramp"]}) is None
    assert rule.evaluate({"accessibility_requirements": "None"}, {"accessibility": []}) is None
    assert rule.evaluate({"accessibility_requirements": "N/A"}, {"accessibility": []}) is None


def test_accessibility_rule_passes_when_feature_present():
    rule = AccessibilityRule()
    event = {"accessibility_requirements": "Wheelchair access required"}
    venue = {"accessibility": ["Wheelchair Ramp", "Accessible Toilet"]}
    assert rule.evaluate(event, venue) is None


def test_accessibility_rule_flags_missing_feature():
    rule = AccessibilityRule()
    event = {"accessibility_requirements": "Wheelchair access required"}
    venue = {"accessibility": ["Elevator"]}
    result = rule.evaluate(event, venue)
    assert "Missing required accessibility feature(s): Wheelchair." in result


# --------------- SuitabilityEngine ---------------

def test_suitability_engine_default_rules_evaluation_pass():
    engine = SuitabilityEngine()
    event = {
        "expected_attendance": 50,
        "venue_requirements": "Banquet",
        "accessibility_requirements": "Wheelchair",
    }
    venue = {
        "capacity": 100,
        "supported_layouts": ["Banquet"],
        "facilities": ["Projector"],
        "accessibility": ["Wheelchair Ramp"],
    }
    report = engine.evaluate_suitability(event, venue)
    assert report["is_suitable"] is True
    assert report["flags"] == []
    assert report["checked_rules_count"] == 4


def test_suitability_engine_returns_multiple_flags():
    engine = SuitabilityEngine()
    event = {
        "expected_attendance": 150,
        "venue_requirements": "Banquet layout and Projector",
        "accessibility_requirements": "Wheelchair",
    }
    venue = {
        "capacity": 100,
        "supported_layouts": ["Theatre"],
        "facilities": [],
        "accessibility": [],
    }
    report = engine.evaluate_suitability(event, venue)
    assert report["is_suitable"] is False
    assert len(report["flags"]) == 4
    assert report["checked_rules_count"] == 4


def test_suitability_engine_accepts_custom_rules():
    engine = SuitabilityEngine(rules=[AlwaysWarnRule()])
    report = engine.evaluate_suitability({}, {})
    assert report["is_suitable"] is False
    assert report["flags"] == ["Always custom warning"]
    assert report["checked_rules_count"] == 1


def test_suitability_engine_allows_dynamic_add_rule():
    engine = SuitabilityEngine()
    engine.add_rule(AlwaysWarnRule())
    report = engine.evaluate_suitability({}, {})
    assert report["is_suitable"] is False
    assert report["checked_rules_count"] == 5
    assert "Always custom warning" in report["flags"]


# ============================================================================
# INTEGRATION TESTING (Flask API Routes)
# ============================================================================

@patch("app.venues.get_event_by_id")
@patch("app.venues.get_venue")
def test_api_suitability_endpoint_returns_suitable_result(
    mock_get_venue, mock_get_event, app
):
    mock_get_event.return_value = {
        "id": "event-111",
        "expected_attendance": 50,
        "venue_requirements": None,
    }
    mock_get_venue.return_value = {
        "id": "venue-222",
        "capacity": 100,
        "supported_layouts": ["Theatre"],
    }

    client = app.test_client()
    select_user(client, 2)  # Coordinator

    response = client.get("/venues/venue-222/suitability/event-111", headers=ORIGIN)
    assert response.status_code == 200
    data = response.json
    assert data["suitability"]["is_suitable"] is True
    assert data["suitability"]["flags"] == []
    assert data["event_id"] == "event-111"
    assert data["venue_id"] == "venue-222"


@patch("app.venues.get_event_by_id")
@patch("app.venues.get_venue")
def test_api_suitability_endpoint_returns_unsuitable_advisory_flags(
    mock_get_venue, mock_get_event, app
):
    mock_get_event.return_value = {
        "id": "event-111",
        "expected_attendance": 150,
        "venue_requirements": "Banquet layout",
    }
    mock_get_venue.return_value = {
        "id": "venue-222",
        "capacity": 100,
        "supported_layouts": ["Theatre"],
    }

    client = app.test_client()
    select_user(client, 2)  # Coordinator

    response = client.get("/venues/venue-222/suitability/event-111", headers=ORIGIN)
    assert response.status_code == 200
    data = response.json
    assert data["suitability"]["is_suitable"] is False
    assert len(data["suitability"]["flags"]) == 2


@patch("app.venues.get_event_by_id")
def test_api_suitability_returns_404_when_event_not_found(mock_get_event, app):
    mock_get_event.return_value = None

    client = app.test_client()
    select_user(client, 2)

    response = client.get("/venues/venue-222/suitability/missing-event", headers=ORIGIN)
    assert response.status_code == 404
    assert response.json["error"] == "The requested event was not found."


@patch("app.venues.get_event_by_id")
@patch("app.venues.get_venue")
def test_api_suitability_returns_404_when_venue_not_found(
    mock_get_venue, mock_get_event, app
):
    mock_get_event.return_value = {"id": "event-111"}
    mock_get_venue.return_value = None

    client = app.test_client()
    select_user(client, 2)

    response = client.get("/venues/missing-venue/suitability/event-111", headers=ORIGIN)
    assert response.status_code == 404
    assert response.json["error"] == "The requested venue was not found."


def test_api_suitability_rejects_unauthenticated_callers(app):
    client = app.test_client()
    response = client.get("/venues/v1/suitability/e1", headers=ORIGIN)
    assert response.status_code == 401


def test_api_suitability_rejects_untrusted_origin(app):
    client = app.test_client()
    select_user(client, 2)
    response = client.get("/venues/v1/suitability/e1", headers={"Origin": "http://evil.com"})
    assert response.status_code == 403


# ============================================================================
# API INTEGRATION TESTS: multi-venue suitability (GET /venues/suitability/<event_id>)
# ============================================================================

@patch("app.venues.list_venues")
@patch("app.venues.get_event_by_id")
def test_api_all_venue_suitability_returns_ranked_results(
    mock_get_event, mock_list_venues, app
):
    mock_get_event.return_value = {"id": "event-111", "expected_attendance": 150}
    mock_list_venues.return_value = (
        [
            {"id": "venue-a", "name": "Small Room", "capacity": 50,
             "supported_layouts": ["Theatre"]},
            {"id": "venue-b", "name": "Big Hall", "capacity": 200,
             "supported_layouts": ["Theatre", "Banquet"]},
        ],
        False,  # has_more
    )

    client = app.test_client()
    select_user(client, 2)  # Coordinator

    response = client.get("/venues/suitability/event-111", headers=ORIGIN)
    assert response.status_code == 200
    data = response.json
    assert data["event_id"] == "event-111"
    assert data["page"] == 1
    assert data["has_more"] is False

    # Both venues evaluated, and the suitable one is ranked first.
    assert len(data["venues"]) == 2
    assert data["venues"][0]["venue_id"] == "venue-b"
    assert data["venues"][0]["suitability"]["is_suitable"] is True
    assert data["venues"][1]["venue_id"] == "venue-a"
    assert data["venues"][1]["suitability"]["is_suitable"] is False


@patch("app.venues.list_venues")
@patch("app.venues.get_event_by_id")
def test_api_all_venue_suitability_empty_catalogue(mock_get_event, mock_list_venues, app):
    mock_get_event.return_value = {"id": "event-111", "expected_attendance": 150}
    mock_list_venues.return_value = ([], False)

    client = app.test_client()
    select_user(client, 2)

    response = client.get("/venues/suitability/event-111", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["venues"] == []


@patch("app.venues.list_venues")
@patch("app.venues.get_event_by_id")
def test_api_all_venue_suitability_does_not_clobber_single_venue_route(
    mock_get_event, mock_list_venues, app
):
    """
    The literal /suitability/<event_id> route must be matched before the
    parameterised /<venue_id>/suitability/<event_id> route, otherwise a request
    to the multi-venue endpoint would treat "suitability" as a venue id and 404.
    """
    mock_get_event.return_value = {"id": "event-111", "expected_attendance": 150}
    mock_list_venues.return_value = (
        [{"id": "venue-a", "name": "Hall", "capacity": 200, "supported_layouts": ["Theatre"]}],
        False,
    )

    client = app.test_client()
    select_user(client, 2)

    response = client.get("/venues/suitability/event-111", headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["venues"][0]["venue_id"] == "venue-a"

    # The single-venue route still works for a real venue id.
    with patch("app.venues.get_venue") as mock_get_venue:
        mock_get_venue.return_value = {
            "id": "venue-a", "name": "Hall", "capacity": 200,
            "supported_layouts": ["Theatre"],
        }
        single = client.get("/venues/venue-a/suitability/event-111", headers=ORIGIN)
        assert single.status_code == 200
        assert single.json["venue_id"] == "venue-a"


@patch("app.venues.list_venues")
@patch("app.venues.get_event_by_id")
def test_api_all_venue_suitability_404_when_event_missing(
    mock_get_event, mock_list_venues, app
):
    mock_get_event.return_value = None

    client = app.test_client()
    select_user(client, 2)

    response = client.get("/venues/suitability/missing-event", headers=ORIGIN)
    assert response.status_code == 404
    assert response.json["error"] == "The requested event was not found."


def test_api_all_venue_suitability_rejects_unauthenticated(app):
    client = app.test_client()
    response = client.get("/venues/suitability/e1", headers=ORIGIN)
    assert response.status_code == 401


def test_api_all_venue_suitability_rejects_bad_page(app):
    client = app.test_client()
    select_user(client, 2)
    response = client.get("/venues/suitability/e1?page=abc", headers=ORIGIN)
    assert response.status_code == 400


def test_api_all_venue_suitability_rejects_untrusted_origin(app):
    client = app.test_client()
    select_user(client, 2)
    response = client.get(
        "/venues/suitability/e1", headers={"Origin": "http://evil.com"}
    )
    assert response.status_code == 403

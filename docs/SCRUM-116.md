# SCRUM-116: Venue suitability layout + facility/accessibility rules

Split from SCRUM-29. Add LayoutRule + facility/accessibility rules to the SuitabilityEngine.

## Summary

The `SuitabilityEngine` evaluates an event's requested layout, facilities, and accessibility requirements against candidate venues.
When a venue lacks a requested feature or does not support a layout, an advisory flag is generated. Flags are advisory and do not hard-block a Coordinator from booking the venue.

## Acceptance Criteria → Evidence

| AC | Behaviour | Tests & Evidence |
| --- | --- | --- |
| 1 | Flag when a required layout is not supported. | `api/tests/test_venue_suitability.py::test_layout_rule_*`, `test_combined_rules` |
| 2 | Flag when a required facility or accessibility feature is missing. | `api/tests/test_venue_suitability.py::test_facility_rule_*`, `test_accessibility_rule_*` |
| 3 | Advisory only — does not block a booking request or catalogue search. | `api/tests/test_venue_search.py`, `frontend/e2e/venue-suitability.spec.ts` |

## Implementation Details

- **`api/app/venue_suitability.py`**:
  - `LayoutRule`: checks `event["layout"]` against `venue["supported_layouts"]` using fuzzy matching (e.g., handles spelling and formatting variations).
  - `FacilityAccessibilityRule` (`FacilityRule` & `AccessibilityRule`): checks requested facilities and accessibility features against `venue["facilities"]` and `venue["accessibility"]`.
  - `SuitabilityEngine`: composes `CapacityRule`, `LayoutRule`, `FacilityRule`, and `AccessibilityRule`. Returns structured results containing `is_suitable`, `flags`, and `checked_rules_count`.
- **`api/app/venue_search.py`**:
  - Catalogue filtering ensures suitability flags remain non-blocking advisories rather than dropping candidate venues out of the search results unexpectedly.
  - Achieved 100% statement coverage across `venue_suitability.py` and `venue_search.py`.

## Verification

- **Backend Unit Tests:** `pytest tests/test_venue_suitability.py tests/test_venue_search.py` (100 tests passed, 100% coverage).
- **Playwright E2E:** `frontend/e2e/venue-suitability.spec.ts` asserts unsupported layout and missing facility advisory notices.
- **Traceability Matrix:** `docs/testing/e2e-traceability.md` Row 11 (`Venue suitability`).

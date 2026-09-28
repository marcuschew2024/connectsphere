# SCRUM-29: venue suitability check

A Coordinator can ask whether a venue is suitable for an event before booking it.
The check is advisory, not blocking: it returns warnings a Coordinator can act on,
but never rejects a booking on its own.

## Acceptance criteria

- A 150-pax event against a 100-capacity room is clearly flagged unsuitable.
- A requested layout the venue does not support is flagged.
- A requested facility the venue does not offer is flagged.
- A requested accessibility feature the venue does not offer is flagged.
- Flags are advisory: a flagged venue still returns `200` and is usable.
- Free-text requirements match venue data without exact spelling
  (`theater`/`theatre`, `board room`/`boardroom`, `wheel chair`/`wheelchair`).
- A Coordinator can check one venue or every venue on the current catalogue page.

## 1. How the engine works

The engine is the OOP core for this feature. It composes four rules and runs them
in one pass:

| Rule | Checks |
| --- | --- |
| `CapacityRule` | `expected_attendance` against `venue.capacity`. |
| `LayoutRule` | Requested layouts against `venue.supported_layouts`. |
| `FacilityRule` | Requested facilities against `venue.facilities`. |
| `AccessibilityRule` | Requested accessibility features against `venue.accessibility`. |

`SuitabilityRule` is an abstract base class. Each concrete rule implements
`evaluate(event, venue) -> str | None`, returning a warning string or `None`.
`SuitabilityEngine` orchestrates them:

```python
engine = SuitabilityEngine()          # default: all four rules
engine.add_rule(OverlapRule())        # SCRUM-33 extends without touching this file
result = engine.evaluate_suitability(event, venue)
```

`evaluate_suitability` returns:

```json
{
  "is_suitable": true,
  "flags": [],
  "checked_rules_count": 4
}
```

`is_suitable` is `true` only when `flags` is empty. `add_rule` lets future
stories extend the engine without modifying existing code.

## 2. Free-text matching

Coordinators type requirements into free-text fields, so a venue's canonical
feature names ("u-shape", "boardroom") can be written many ways
("u shaped", "board room", "wheel chair"). Naive substring matching silently
misses these variants.

`_normalise()` lower-cases, collapses whitespace, treats hyphens as spaces, and
applies spelling synonyms from `_SYNONYMS`:

| Variant | Canonical |
| --- | --- |
| `theater` | `theatre` |
| `u shaped`, `u-shape` | `u shape` |
| `board room`, `board-room` | `boardroom` |
| `wheel chair`, `wheel-chair` | `wheelchair` |
| `wi-fi` | `wifi` |

Canonical forms keep their spaces so whole-phrase matching works; collapsing them
into one underscore token would let a substring like `shape` or `access` falsely
match.

`find_requested(canonical, request_text)` returns `(found, hint)`:

- `(True, None)` — an exact or normalised-variant match.
- `(False, None)` — the feature is not mentioned at all.
- `(False, hint)` — a near-miss typo, reported as a "Did you mean" hint rather
  than silently dropped.

Near-misses use a conservative edit-distance rule: distance exactly 1 and length
difference at most 1, on tokens of length 5 or more. This catches real typos
(`projrctor`, `banqet`, `microfone`) while avoiding misleading hints for genuinely
ambiguous pairs (`seating` vs `stage`, distance 2).

## 3. API endpoints

Both endpoints require **Venue Staff, Coordinator or Organiser**, check the
configured frontend origin, and reject anonymous or wrong-origin requests with
`403`. A missing event returns `404`; a missing venue returns `404`.

### Check one venue

```http
GET /venues/<venue_id>/suitability/<event_id>
```

Header:

```text
Origin: http://localhost:3001
```

Response `200`:

```json
{
  "suitability": {
    "is_suitable": false,
    "flags": [
      "Expected attendance (150 pax) exceeds venue capacity (100 pax) by 50 pax."
    ],
    "checked_rules_count": 4
  },
  "event_id": "YOUR_EVENT_ID",
  "venue_id": "YOUR_VENUE_ID"
}
```

### Check every venue

```http
GET /venues/suitability/<event_id>?page=1
```

This literal route is registered **before** the parameterised
`/<venue_id>/suitability/<event_id>` route, otherwise Flask/Werkzeug matches
`suitability` as a venue id and never reaches this handler.

`page` must be `1`–`10000`; pages reuse the catalogue page size of six venues.
Results rank best-first: fully suitable venues, then advisory (flagged but usable)
venues, then unsuitable ones.

Response `200`:

```json
{
  "event_id": "YOUR_EVENT_ID",
  "venues": [
    {
      "venue_id": "YOUR_VENUE_ID",
      "venue": { "id": "YOUR_VENUE_ID", "name": "Hall", "capacity": 200, ... },
      "suitability": { "is_suitable": true, "flags": [], "checked_rules_count": 4 }
    }
  ],
  "page": 1,
  "has_more": false
}
```

## 4. Data contract

Read-only; no schema changes. The engine reads existing columns:

| Table | Column | Meaning |
| --- | --- | --- |
| `public.venues` | `capacity` | Positive integer. |
| | `supported_layouts` | Array, e.g. `["Theatre", "Banquet"]`. |
| | `facilities` | Array, e.g. `["Projector", "WiFi"]`. |
| | `accessibility` | Array, e.g. `["Wheelchair", "Ramp"]`. |
| `public.events` | `expected_attendance` | Positive integer. |
| | `venue_requirements` | Free text, e.g. `"Banquet layout, projector"`. |
| | `equipment_requirements` | Free text, e.g. `"sound system, microphone"`. |
| | `accessibility_requirements` | Free text; `none` / `n/a` means no needs. |

## 5. Files

| File | Responsibility |
| --- | --- |
| `api/app/venue_suitability.py` | `SuitabilityRule` ABC, four concrete rules, `SuitabilityEngine`, and the free-text normalisation helpers. |
| `api/app/venues.py` | The two suitability routes, placed after the catalogue, venue-detail and venue-bookings routes. |
| `api/app/venue_repository.py` | `get_venue()` — shared with SCRUM-30's detail route. |
| `api/app/event_repository.py` | `get_event_by_id()`. |
| `api/tests/test_venue_suitability.py` | Unit and API integration coverage. |

## 6. Tests — `api/tests/test_venue_suitability.py`

| Test | Coverage |
| --- | --- |
| `test_capacity_rule_flags_when_attendance_exceeds_capacity` | Attendance above capacity is flagged with the excess. |
| `test_capacity_rule_passes_when_attendance_is_within_capacity` | Under capacity passes. |
| `test_capacity_rule_passes_on_exact_capacity_match` | Exact capacity passes. |
| `test_capacity_rule_handles_string_numbers` | String numerics are coerced. |
| `test_capacity_rule_handles_missing_expected_attendance` | Missing attendance is skipped safely. |
| `test_capacity_rule_handles_missing_venue_capacity` | Missing capacity is skipped safely. |
| `test_capacity_rule_handles_invalid_non_numeric_values` | Invalid values are skipped safely. |
| `test_layout_rule_flags_when_requested_layout_is_unsupported` | Requested layout not in `supported_layouts` is flagged. |
| `test_layout_rule_handles_theater_spelling_normalisation` | `theater` resolves to `theatre`. |
| `test_layout_rule_handles_none_supported_layouts` | A `None` layouts list is handled. |
| `test_layout_rule_passes_when_requested_layout_is_supported` | Supported layout passes. |
| `test_layout_rule_passes_when_no_requirements_specified` | Empty requirements pass cleanly. |
| `test_facility_rule_flags_missing_facilities` | Requested facility absent is flagged. |
| `test_facility_rule_passes_when_all_facilities_present` | All facilities present passes. |
| `test_facility_rule_passes_when_no_facility_required` | No facility required passes. |
| `test_accessibility_rule_flags_missing_feature` | Requested accessibility feature absent is flagged. |
| `test_accessibility_rule_passes_when_feature_present` | Feature present passes. |
| `test_accessibility_rule_passes_when_none_required` | `none` / `n/a` skips the check. |
| `test_suitability_engine_default_rules_evaluation_pass` | Default four-rule engine passes a suitable venue. |
| `test_suitability_engine_returns_multiple_flags` | Multiple rules can flag in one pass. |
| `test_suitability_engine_accepts_custom_rules` | A custom rule is honoured. |
| `test_suitability_engine_allows_dynamic_add_rule` | `add_rule()` registers a rule after construction. |
| `test_api_suitability_endpoint_returns_suitable_result` | `GET /venues/<id>/suitability/<event_id>` returns `is_suitable: true`. |
| `test_api_suitability_endpoint_returns_unsuitable_advisory_flags` | The same route returns advisory flags and still `200`. |
| `test_api_suitability_returns_404_when_event_not_found` | Unknown event returns `404`. |
| `test_api_suitability_returns_404_when_venue_not_found` | Unknown venue returns `404`. |
| `test_api_suitability_rejects_unauthenticated_callers` | Anonymous requests return `403`. |
| `test_api_suitability_rejects_untrusted_origin` | Wrong `Origin` header returns `403`. |
| `test_api_all_venue_suitability_returns_ranked_results` | Multi-venue endpoint ranks suitable first. |
| `test_api_all_venue_suitability_empty_catalogue` | Empty catalogue page returns an empty list. |
| `test_api_all_venue_suitability_does_not_clobber_single_venue_route` | The literal route stays ahead of the parameterised one. |
| `test_api_all_venue_suitability_404_when_event_missing` | Multi-venue endpoint returns `404` for an unknown event. |
| `test_api_all_venue_suitability_rejects_unauthenticated` | Anonymous multi-venue requests return `403`. |
| `test_api_all_venue_suitability_rejects_bad_page` | Invalid `page` returns `400`. |
| `test_api_all_venue_suitability_rejects_untrusted_origin` | Wrong `Origin` returns `403`. |

## 7. Verification

Run the API tests and lint from `api`:

```powershell
cd api
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
```

The current local run has **438 passed, 25 skipped** after merging SCRUM-30's
venue-detail and venue-bookings routes from `main` into this branch, and ruff is
clean on all changed files.

The stale duplicate `api/tests/unit/test_venue_suitability_unit.py` (22 tests
with outdated assertions) was removed; its coverage is carried by
`test_venue_suitability.py`.

These are local results. The branch has not been pushed, so no remote CI result is
claimed. The usual review and CI checks still apply before merging.

## Known limitations and future work

- The endpoints exist and are tested, but nothing calls them yet — the
  suitability UI was removed, so a Coordinator has no button to trigger a check.
  Re-adding a trigger on the event page is the remaining product piece.
- Matching is per-pair (event vs venue) and on-demand; the engine does not run
  unprompted, and nothing triggers it when a venue is created or updated.
- The vocabulary covers the layouts, facilities and accessibility features in use;
  a feature not in the vocabulary is silently ignored rather than flagged.
- Overlap checks (SCRUM-33) are not implemented; `add_rule` is ready for them.
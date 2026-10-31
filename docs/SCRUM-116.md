# SCRUM-116: Venue suitability layout, facility and accessibility rules

## Summary

The suitability engine checks an event's requested layout, facilities and accessibility features
against the selected venue. Missing requirements produce advisory flags and never reject a booking.

## Implementation

- `LayoutRule` flags layouts not listed by the venue.
- `FacilityRule` flags required facilities not listed by the venue.
- `AccessibilityRule` flags required accessibility features not listed by the venue.
- `SuitabilityEngine` combines these rules with the capacity rule.
- Unsuitable results remain usable by Coordinators; booking endpoints must not block on them.

## Verification

- `api/tests/test_venue_suitability.py`
- `frontend/e2e/venue-suitability.spec.ts`
- Existing suitability row in `docs/testing/e2e-traceability.md`

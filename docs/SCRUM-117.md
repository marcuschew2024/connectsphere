# SCRUM-117: Venue suitability advisory flags in UI

Split from SCRUM-29. Surface SuitabilityEngine results as advisory (non-blocking) flags in venue search/detail/booking views.

## Summary

Surfaces `SuitabilityEngine` outputs as clear, advisory warning banners in the UI when Coordinators browse venues, inspect venue details, or submit booking requests. Warnings highlight over-capacity, unsupported layouts, or missing accessibility/facility features while keeping the booking action enabled.

## Acceptance Criteria → Evidence

| AC | Behaviour | Tests & Evidence |
| --- | --- | --- |
| 1 | Over-capacity / unsupported-layout / missing-facility flags shown on candidate venues. | `frontend/src/app/venues/page.tsx`, `frontend/e2e/venue-suitability.spec.ts` |
| 2 | Flags are advisory — the Coordinator still decides and can submit a booking request. | `frontend/src/app/venues/bookings/new/page.tsx`, `frontend/e2e/venue-suitability.spec.ts` |
| 3 | Given a 150-pax event and a 100-capacity room, it is clearly marked over capacity. | `frontend/e2e/venue-suitability.spec.ts` (150 attendees vs 100 capacity banner assertion) |

## Implementation Details

- **`frontend/src/lib/event-venue-requirements.ts`**:
  - Parses planning event requirements into standardized fields: `attendance`, `layout`, `facilities`, `accessibility`.
  - Comprehensive unit test suite in `frontend/src/lib/event-venue-requirements.test.ts` (100% pass).
- **`frontend/src/app/venues/page.tsx`**:
  - Adds event picker for Coordinators in the catalogue search view.
  - Candidate venue cards render alert banners displaying any advisory issues detected for the chosen event.
- **`frontend/src/app/venues/bookings/new/page.tsx`**:
  - Evaluates suitability on the booking creation form and renders an amber advisory region (`Venue suitability advisory`).
  - Submit button remains active and unblocked.

## Verification

- **Frontend Unit Tests:** `npm run test:unit` (`event-venue-requirements.test.ts` passed).
- **Playwright E2E:** `frontend/e2e/venue-suitability.spec.ts` verifies:
  1. 150-pax event in 100-pax room displays "Over capacity".
  2. Banquet layout requirement displays "Layout Banquet is not supported".
  3. Wheelchair / projector displays missing feature advisory.
  4. Coordinator successfully clicks and submits the booking despite advisories.
- **Traceability Matrix:** Marked Row 11 as ✅ in `docs/testing/e2e-traceability.md`.

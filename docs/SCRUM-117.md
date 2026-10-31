# SCRUM-117: Advisory suitability flags in the venue UI

## Summary

Venue suitability results are shown as advisory warnings in the booking form, venue catalogue and
venue detail page. Warnings do not prevent a Coordinator from submitting a booking request.

## Implementation

- Coordinators can select a Planning event in the venue catalogue.
- Catalogue cards show unsuitability flags for the selected event.
- The selected event is carried to venue detail and suitability flags are shown there.
- The booking form shows the same suitability response before submission.
- Capacity, layout, facility and accessibility flags remain advisory.

## Verification

- `frontend/e2e/venue-suitability.spec.ts`
- `frontend/e2e/bookings.spec.ts`
- Frontend lint, production build and targeted Playwright tests

# SCRUM-60 — Block a Venue

## Acceptance coverage

- Venue Staff can create an unavailable period with a supported reason and optional note.
- Active blocks participate in venue search and calendar availability.
- Existing bookings are preserved; overlapping active arrangements remain visible and receive an in-app replacement request.
- Venue Staff can unblock an active period while preserving the historical record.
- Coordinators can reach the replacement flow through the existing venue search and booking request screens.

## Implementation

- A separate `venue_unavailability` table preserves block history and keeps it independent from `venue_bookings`.
- Partial overlaps affect an arrangement because all conflict checks use half-open interval overlap.
- Database enforcement prevents new or updated active bookings entering an active venue block.
- Calendar responses add active blocks with status `Blocked` to the existing booking contract.

## Verification

- Automated backend route and pure-rule tests cover validation, permissions, block creation, affected-booking notification, listing, and unblocking.
- Playwright E2E coverage covers Venue Staff block-period UI.
- Human owner and venue-block policy decisions require review before merge.

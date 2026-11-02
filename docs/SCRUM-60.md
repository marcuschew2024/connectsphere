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

## Outstanding gap (as of 2 Nov 2026) — audit R5

Maintenance conflicts still compare a block against a booking's **raw** `start_at`/`end_at`,
not its buffered occupied window. A block ending at 14:00 therefore does not conflict with a
14:00 event that needs setup from 13:30, and that booking's Coordinator is not alerted.

Three places need the occupied interval:

| Location | Role |
| --- | --- |
| `api/app/venue_search.py` (`availability`) | passes raw times to `list_unavailability` |
| `api/app/venue_unavailability_repository.py` (`find_affected_bookings`) | decides which Coordinators are notified |
| `supabase/migrations/20261030220000_scrum_60_venue_unavailability.sql` (`reject_booking_in_active_venue_block`) | compares `new.start_at`/`new.end_at` |

The database fix depends on `occupied_start` / `occupied_end` from SCRUM-137's migration,
which the audit reports has not successfully applied to the release database. This work is
therefore **blocked on coordination with SCRUM-137's owner** and is not included in the
2 Nov 2026 increment.

Note: the block notification already resolves its recipient as `event.coordinator_id` first
(`api/app/venues.py`), so SCRUM-60's alerting already follows reassignment correctly.

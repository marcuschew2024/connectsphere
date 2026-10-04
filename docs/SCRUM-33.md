# SCRUM-33: Double-booking overlap detection and hard-block

SCRUM-33 adds the reusable OOP overlap policy used by venue booking submission and
Venue Staff approval. The implementation lives in `api/app/venue_overlap.py`.

## Policy

- Published `start_at`/`end_at` are the only interval boundaries. No setup or turnaround
  buffer is added.
- Intervals are half-open, `[start, end)`: a booking ending exactly when another starts
  is allowed.
- `Confirmed` and `Blocked` bookings are hard conflicts and cannot overlap.
- `Requested`/`Pending` bookings are tentative holds. A second overlapping hold is
  rejected, but a later confirmed decision takes precedence over a stale hold.
- A booking on another venue never conflicts.

`OverlapEngine.evaluate()` returns an `OverlapResult` with separate hard and tentative
conflicts. `can_request` rejects either kind; `can_confirm` rejects only hard conflicts.
This keeps the policy pure and unit-testable while repository queries and the database
constraints provide persistence and concurrency protection.

## Database migration

Run [`supabase/create_venue_bookings.sql`](../supabase/create_venue_bookings.sql) after
the event, venue, and notification migrations. It installs two exclusion constraints:

- `venue_bookings_no_overlap_hard` for `Confirmed`/`Blocked` periods.
- `venue_bookings_one_tentative_hold` for `Requested`/`Pending` periods.

The migration drops the previous SCRUM-31 combined constraint before creating the two
policy-specific constraints, so it is safe to rerun.

## Test coverage

`api/tests/test_venue_overlap.py` covers hard conflicts, maintenance blocks, one hold,
confirmed-over-hold precedence, touching boundaries, venue isolation, and self-exclusion.
Booking route tests cover request-time hard/hold rejection and approval-time hard-blocks.
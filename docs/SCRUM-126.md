# SCRUM-126: Multiple venue bookings per event

SCRUM-126 extends the event-to-venue relationship to one-to-many. Existing single-
venue events remain valid; each booking row retains the same `event_id` and is managed
independently.

## Delivered behavior

- Coordinators can add another venue arrangement for the same Planning event.
- The event detail page lists every booking, including venue, time, attendance, layout,
  and status.
- Each booking is independently validated for suitability inputs, capacity, opening
  hours, published-slot availability, and overlap conflicts.
- Coordinators can change their own `Requested` booking or cancel one `Requested` or
  `Confirmed` booking. These operations update only the selected booking ID; sibling
  bookings and the parent event remain intact.
- `EventConfirmation` evaluates all event bookings. A partial approval cannot confirm
  the event; all pending bookings must be settled and at least one booking must be
  `Confirmed`. Rejected bookings are settled history and do not block confirmation.

## Migration

Run `supabase/create_venue_bookings.sql` after the existing event, venue, and
notification migrations. The migration is rerunnable and adds the lifecycle audit
columns used by independent booking changes.

## Test coverage

- `api/tests/test_booking_lifecycle.py`: event booking list, independent change,
  independent cancellation, and ownership denial.
- `api/tests/test_event_confirmation_route.py`: all-bookings confirmation gate.
- `api/tests/test_venue_overlap.py` and booking decision tests: suitability/availability
  and conflict regression coverage.
- `frontend/e2e/bookings.spec.ts` and event browser suites: booking UI regression.
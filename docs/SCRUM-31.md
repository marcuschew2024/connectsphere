# SCRUM-31: Submit a venue booking request

Run [`supabase/create_venue_bookings.sql`](../supabase/create_venue_bookings.sql) after
`create_events.sql`, `create_venues.sql`, and `event_decision_notifications.sql`.

Coordinators can submit a request from `/venues/bookings/new` for an event in Planning.
The request records venue, start/end time, attendance, layout, special requirements,
requesting Coordinator, and request timestamp. It is stored with status `Requested`.
Venue Staff receive an in-app notification and can review requests from
`/venues/bookings`.

The API rejects past or reversed slots, invalid attendance/layout/requirements, events
that are not in Planning, and any slot overlapping an existing `Confirmed` or `Blocked`
booking for the same venue. The database exclusion constraint is the concurrency
backstop for confirmed/blocked bookings; the API availability check gives a clear
submission error before insertion.

## Acceptance coverage

- Positive: Coordinator submission returns `Requested`, actor, timestamp, and details; Venue Staff notification is created.
- Negative: non-Coordinators cannot submit; invalid fields and non-Planning events are rejected.
- Boundary: positive attendance, ISO timezone slots, end-after-start, layout and special-requirement limits are validated.
- Conflict: confirmed/blocked overlap returns `409` without creating a request.
- Regression: existing venue catalogue and booking decision pages remain available; the decision UI accepts both legacy `Pending` and SCRUM-31 `Requested` records.

Automated coverage is in `api/tests/test_bookings.py` and the SCRUM-31 scenarios in
`frontend/e2e/bookings.spec.ts`.

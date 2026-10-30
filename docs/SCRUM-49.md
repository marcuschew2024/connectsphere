# SCRUM-49: In-app notifications for every role (R07)

Run [`supabase/migrations/20261030015221_scrum_49_notification_recipient_role.sql`](../supabase/migrations/20261030015221_scrum_49_notification_recipient_role.sql)
after `event_decision_notifications.sql` (which creates the `notifications` table).

Notifications use a **hybrid recipient model** (Decision Log D27). Each row targets exactly
one of:

- a specific user (`recipient_id`) — Organiser, Coordinator or Attendee, who are tied to an
  event; or
- an unassigned role pool (`recipient_role`) — Venue Staff or Tech Support, who review from a
  shared queue (no per-event assignment of those roles exists in Release 1; Customer
  Clarification S1 Q10/Q16, S2 Q9/Q13).

`GET /notifications` returns rows where `recipient_id = current user OR recipient_role =
current user's role`. The earlier Organiser-only gate (the R07 defect — recipients other than
the Organiser never saw their notifications) is removed, and the Home feed is shown for every
role. Record-level isolation holds: a user sees only their own and their pool's notifications,
and attendees never see internal planning content.

The database enforces the shape with two CHECK constraints: exactly one of `recipient_id` /
`recipient_role` is set, and `recipient_role` is restricted to `Venue Staff` / `Tech Support`.
The pure `notification_visibility` value object (`can_see` / `recipient_fields`) holds the rule;
the repository mirrors it in a PostgREST `.or_()` query.

## Recipient / trigger matrix

Implemented in this story:

- Organiser ← decision on their request, clarification, change-request update
- Coordinator ← change requested, booking outcome, assignment/reassignment (written DB-side by SCRUM-130)
- Venue Staff (pool) ← new venue booking request
- Tech Support (pool) ← new equipment request

Deferred to their owning stories (the notification primitive is now available to them): booking
outcome (SCRUM-119), hold expiry (SCRUM-79), event cancelled/rescheduled (SCRUM-69 / SCRUM-48),
waitlist slot available (SCRUM-80).

## Acceptance coverage

- Positive: every authenticated role gets a 200 feed; Venue Staff and Tech Support see their
  pool queues; Organiser/Coordinator see their personal notifications.
- Isolation: a user never sees another user's personal notification, nor a pool they are not in.
- Boundary/negative (database): a notification targeting both, neither, or a non-pool role is
  rejected; a valid pool target is accepted.
- Regression: existing Organiser/Coordinator feeds and the venue-booking / equipment-request
  flows continue to work with pool notifications.

## Trade-off

Pool notifications have no "claimed by X" de-duplication — every holder of a pool role sees
every pool item. This is acceptable for Release 1 (no assignment model exists); per-staff
routing would be a future story.

## Tests

- Backend unit: `api/tests/test_notification_visibility.py`
- Backend route: `api/tests/test_notifications_feed.py`, and the all-roles case in
  `api/tests/test_event_decisions.py`
- Backend database acceptance: `api/tests/test_notifications_feed_acceptance.py`
  (migration registered in `supabase/tests/run.sh`)
- Emission: `api/tests/test_bookings.py`, `api/tests/test_equipment_requests.py`
- Frontend e2e: `frontend/e2e/notifications.spec.ts`

# SCRUM-132: Complete and close an event

The assigned Coordinator marks a delivered event as Completed. Completion closes the
event: its record becomes read-only and its remaining resource holds are released.
This fills the gap where the lifecycle ended at Preparation (Customer Brief step 14).

## Workflow

- Only the assigned Coordinator can call `POST /events/{event_id}/complete`.
- The body is optional: `{"note": "..."}` records post-event notes or issues
  (at most 2000 characters).
- The event must be in **Preparation**. That means it was confirmed and passed the
  operational safety check, so it has been delivered (team decision, 2026-10-25).
- Completion is blocked with a clear message while arrangements are incomplete:
  - a venue booking is still awaiting approval (`Requested`/`Pending`), or
  - an equipment request has not been actioned by Tech Support (`Requested`).
- On success, in one database transaction (`complete_event`):
  - the status becomes `Completed`;
  - the completion time, actor and note are written to the status history
    (action `event_completed`);
  - equipment reservations that are still `Reserved`/`Pending` become `Released`;
  - confirmed venue bookings whose slot has not ended become `Cancelled`.
    Bookings that already took place stay `Confirmed` as the delivery record.
- The response returns the event and how many holds were released.

## Read-only after completion

| Action on a Completed event | Result |
| --- | --- |
| Generic `PATCH /events/{id}/status` (any target) | 409 |
| Setting `Completed` through the generic status route | 409 (use the completion step) |
| Editing event details | 409 (only Planning events are editable) |
| Raising or reviewing a change request (SCRUM-46) | 409 |
| Cancelling one of its venue bookings | 409 |
| Reserving equipment for it, or updating its equipment requests | 409 (existing database rule) |

Completed events leave the active queues: Coordinator review (Submitted only),
safety review (Confirmed only) and the equipment-request event list (Planning only).
They stay visible on the event page and in `GET /events` for related users.

## Not included

- Linking actual attendance (SCRUM-68) is optional in the story and waits for the
  registration stories.
- Rejected and Cancelled events are also terminal, but the generic status route
  still allows changing them. Changing that was left out to keep this story's
  scope to Completed.

## Database setup

Apply [`20261025120000_scrum_132_complete_event.sql`](../supabase/migrations/20261025120000_scrum_132_complete_event.sql)
after the event, venue booking, equipment request and equipment reservation
migrations. It is safe to rerun. The disposable CI database applies it automatically.

## Tests

- `api/tests/test_event_completion.py`: completion rule (pure unit tests).
- `api/tests/test_event_completion_route.py`: endpoint, permissions, input checks and
  read-only rules.
- `api/tests/test_event_completion_acceptance.py`: real database, including resource
  release, database re-checks and two simultaneous completions.
- `frontend/e2e/event-complete.spec.ts`: completion panel, blocked message and the
  read-only view.

## Manual check

1. Apply the migration in Supabase.
2. As **Demo Coordinator**, open an event in **Preparation** that is assigned to you.
3. Optionally add post-event notes, choose **Mark event complete**, then
   **Confirm completion**.
4. The badge shows **Completed**, a read-only banner appears and the status history
   shows **Event completed** with your note.
5. As **Demo Organiser**, open the same event: no **Request a change** form is shown.

# SCRUM-69: Cancel an event

An authorised user cancels an event. Cancelling releases its venue bookings and
equipment reservations and tells registered Attendees, all in one database
transaction. Who counts as authorised is recorded in
[Decision Log D32](DECISION_LOG.md).

## Who can cancel

| User | Can cancel? |
| --- | --- |
| The event's **assigned Coordinator** | Yes |
| The **Event Coordinator Lead** | Yes, any event, including an unassigned submission |
| Organiser | No. They ask through **Request a change** (SCRUM-46) |
| Another Coordinator, Venue Staff, Tech Support, Attendee, Safety Officer | No (403, logged in `access_denied_log`) |

Events can be cancelled while **Submitted** (including the legacy intake sub-states),
**Planning**, **Confirmed** or **Preparation**. Drafts are private (404).
Completed, Rejected and already Cancelled events are closed (409).

## Workflow

- `POST /events/{event_id}/cancel` with `{"reason": "..."}` (1–2000 characters,
  trimmed). Any other field is refused.
- The `cancel_event` database function locks the event, re-checks the actor and the
  state, then in one transaction:
  - cancels every `Requested`, `Pending`, `Held` and `Confirmed` venue booking for the
    event (stamping `last_changed_by`/`last_changed_at`);
  - releases `Reserved`/`Pending` equipment reservations;
  - sets the event to `Cancelled` and records `event_cancelled` in the status history
    with the actor, time and reason;
  - notifies every **Registered** Attendee: *The event "…" you registered for has been
    cancelled.* The internal reason is not shared with Attendees;
  - notifies the Organiser, including the reason;
  - notifies the assigned Coordinator when the Lead cancelled.
- Registrations are **not** changed. Per D31, cancellation is not an attendee withdrawal,
  so Attendees' own registration list shows *Registered* on a *Cancelled* event.
- The response returns the event, how many bookings and reservations were released,
  and how many Attendees were notified.

## Read-only after cancelling

| Action on a Cancelled event | Result |
| --- | --- |
| `PATCH /events/{id}/status` to any status | 409 |
| Setting `Cancelled` through `PATCH /events/{id}/status` | 409 (use the cancellation step) |
| Cancelling again | 409 |
| Raising or reviewing a change request | 409 |
| Reserving equipment, new registrations, booking a venue | 409 (existing rules) |

The event stays visible on its page, with a "cancelled" banner, and in event lists.

## Database setup

Apply [`20261030180000_scrum_69_cancel_event.sql`](../supabase/migrations/20261030180000_scrum_69_cancel_event.sql)
after the registration (SCRUM-40/41/43), Event Coordinator Lead (SCRUM-131),
unassigned queue (SCRUM-130) and notification recipient (SCRUM-49) migrations.
It only adds a function and is safe to rerun. The disposable CI database applies it
automatically.

## Tests

- `api/tests/test_event_cancellation.py`: authorised-user, state and reason rules.
- `api/tests/test_event_cancellation_route.py`: endpoint permissions, input checks, the
  gated generic status route and the repository's error mapping.
- `api/tests/test_event_cancellation_acceptance.py`: real database, covering resource
  release, registrations unchanged, notification recipients, refused actors,
  database re-checks, two simultaneous cancellations and the read-only cancelled event.
- `frontend/e2e/event-cancel.spec.ts`: the cancel panel, the required reason,
  confirmation, refusals, who sees the panel, and the read-only view.

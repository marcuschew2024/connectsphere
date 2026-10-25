# SCRUM-46: Request a change

Organisers can request changes after an event is submitted. The request is kept
separate from the event data so a submitted or confirmed event cannot be edited
directly by the organiser.

## Workflow

- An organiser submits `POST /events/{event_id}/change-requests` with only a
  `description` (1-2000 characters).
- The event must be submitted, assigned to a Coordinator, and not be a draft,
  rejected, or cancelled.
- The assigned Coordinator and the organiser can list requests with
  `GET /events/{event_id}/change-requests`.
- The assigned Coordinator reviews a request with
  `PATCH /events/{event_id}/change-requests/{request_id}`. Valid transitions are
  `Pending -> Under Review`, `Pending -> Approved`, `Pending -> Rejected`,
  `Under Review -> Approved`, `Under Review -> Rejected`, and
  `Approved -> Implemented`.
- Every request is recorded in `event_change_requests`, appears in the event
  history, and creates an in-app notification for the other party.

The request has no time-based expiry or penalty. It does not mutate event details;
the Coordinator remains responsible for applying an approved change through the
appropriate operational workflow.

## Database setup

Apply [`20261025000000_scrum_46_change_requests.sql`](../supabase/migrations/20261025000000_scrum_46_change_requests.sql)
after the event schema. The disposable CI database setup applies this migration
automatically.

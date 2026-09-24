# SCRUM-17: Auto-assign a Coordinator

Run [`supabase/auto_assign_coordinator.sql`](../supabase/auto_assign_coordinator.sql)
after `seed_users.sql` and `create_events.sql`. The migration is safe to rerun.

When a completed event request is inserted, PostgreSQL assigns the lowest-ID user
whose role is `Coordinator` and records `coordinator_assigned_at`. A constraint
requires every non-draft event to have both values, and the coordinator queue index
uses `coordinator_id`. The API adds the assigned Coordinator to
`event_participants` so access remains durable.

The database stores `Submitted` as the internal review marker. Coordinator responses
retain that marker so `/events/review` can filter the queue; organiser and attendee
responses expose it as `Planning`. Drafts are never assigned. There is no assignment
or reassignment endpoint.

The selection is deterministic rather than load-balanced because the current story
does not define availability or workload rules. A future assignment policy can replace
the trigger without changing the API contract.
# SCRUM-17: Auto-assign a Coordinator

Run [`supabase/auto_assign_coordinator.sql`](../supabase/auto_assign_coordinator.sql)
after `seed_users.sql` and `create_events.sql`. The migration is safe to rerun.

When a completed event request is inserted **or an existing draft is submitted**,
PostgreSQL assigns the lowest-ID user
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

## Fix and verification

The original trigger ran only on INSERT. Submitting a saved draft is an UPDATE,
so it did not receive a Coordinator and failed the database's assignment check.
The trigger now also runs when status is updated. The draft transaction records
Coordinator membership and submission history together; a failure rolls it all back.

The five US-4.1 acceptance cases run against real PostgreSQL through PostgREST in
`api/tests/test_request_acceptance.py`. They check assignment, the Coordinator queue,
Planning status for the Organiser, no manual assignment, and multiple requests.
`supabase/tests/assignment.sql` also checks rollback when no Coordinator exists.
See [SCRUM-16](SCRUM-16.md) for the commands and simple walkthrough.

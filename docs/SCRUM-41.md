# SCRUM-41: Enforce registration capacity

[Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-41) · Jerome · Sprint 4 · 3 points.

An organiser sets a signup limit before confirmation. Registrations cannot exceed
that limit, including when two attendees compete for the last place. Expected
attendance remains a planning estimate, separate from registration capacity.

## Setup and walkthrough

Apply `supabase/migrations/20261026150854_scrum_41_registration_capacity.sql` after
`create_events.sql` and `edit_planning.sql`. It is safe to rerun and preserves existing
events. Their capacity starts unset and their registration count starts at zero;
registration remains closed until the organiser deliberately sets a limit.

1. Open an event as its Organiser while it is in Planning.
2. Under **Registration capacity**, enter **Maximum attendees** and choose **Save capacity**.
3. The panel shows the saved limit and remaining places. Empty, fractional, zero and
   out-of-range limits get an inline correction; failed saves retain the entered value.
4. Once confirmed, the capacity becomes read-only. Changes require the existing
   change-request process; this story does not implement automatic approval/application
   of capacity changes on confirmed events.

The panel follows semantic theme tokens, supports keyboard submission and narrow
screens, and displays a clear **Full** state. Older backend responses without the new
columns keep rendering the existing event page without this panel.

## Scope and API contract

| Endpoint | Caller | Contract |
| --- | --- | --- |
| `GET /events/{uuid}/registration-capacity` | Existing related event user | Aggregate capacity, count, remaining places and full flag; no attendee identities |
| `PUT /events/{uuid}/registration-capacity` | Owning Organiser | `{"capacity":100}`; positive PostgreSQL integer; only Draft/Planning (including legacy planning states) |
| `POST /events/{uuid}/registrations` | Signed-in Attendee | `{}`; identity comes from the session; Confirmed event, configured capacity, unique attendee and free place required |

All endpoints use the existing session and configured-Origin guards. The signup write
is the smallest capacity-protected seam needed for SCRUM-40. It does not require an
existing participant link (a new attendee has none). **SCRUM-40 still owns attendee
discovery/UI, required registration information, confirmation delivery, notification
integration and access after registration.** SCRUM-44 owns the attendee's registration
list/status view; SCRUM-43 owns withdrawal UI, organiser-defined withdrawal conditions,
notifications and its HTTP endpoint. No waiting list exists or is advertised here;
full events are rejected with HTTP 409, as allowed by this story's acceptance criteria.

The write returns the saved registration only after commit. Full/closed/unconfigured
events and duplicates return 409; wrong roles or ownership return 403; bad inputs
return 400; database failures return a generic 503 without internal details. A timeout
is not treated as a confirmed success: callers should refresh before retrying.

## Design and invariants

- `RegistrationCapacity` is the pure value object for boundary/availability decisions;
  the route precheck gives useful errors, and SQL independently rechecks on every write.
- `events.registration_capacity` is nullable; `registered_count` is nonnegative and
  cannot exceed capacity. An unset capacity permits zero registrations.
- `event_registrations` has one row per `(event_id, attendee_id)`. Its trigger locks the
  parent event row and conditionally increments the counter in the same transaction as
  insertion. Concurrent signups serialize; a failed insert rolls its increment back.
  Direct backend table inserts also pass through this trigger.
- Future Registered/Withdrawn state changes adjust exactly one place. This is a database
  seam for SCRUM-43, not a withdrawal workflow. Event/attendee identity is immutable.
- Setting capacity locks the same event row, checks role, ownership and stored status,
  and records the change in `event_edit_log` atomically. Capacity cannot be set below
  the registered count, or edited after confirmation through the new endpoint.
- All functions use `SECURITY INVOKER` with an empty search path. Registration rows
  have RLS enabled and no browser-role table privileges or RPC execution grants.
  Flask remains the only trusted writer; no browser-supplied actor is accepted.
- Existing confirmation, venue/equipment, status-transition and safety rules are
  unchanged. The migration adds no new confirmation prerequisite to existing events.

## Verification

The SQL harness applies the new migration twice, then checks exactly 100 accepted
registrations and rejection of the 101st, duplicate protection, counter consistency,
draft-save compatibility, capacity reduction rejection and browser-role permissions.

New unit/route tests cover full−1/full/full+1, input types and limits, owner/role/session/
Origin checks, identity spoofing, safe failure messages and database race responses.
Acceptance tests use a disposable PostgreSQL/PostgREST pair, including two truly
concurrent RPCs for a single remaining place and direct-insert bypass attempts.
Browser tests cover save/summary, validation, failures, locked/full/read-only states,
mobile layout and keyboard submission. No existing test assertions were changed.

The test harness has fixture-only delete grants and demo attendees; these are absent
from the application migration. Never apply `supabase/tests/*.sql` to shared Supabase.

Final local verification on 26 Oct 2026:

- Full API regression against freshly created disposable Postgres/PostgREST:
  **1,018 passed**, **85% application coverage** (including 36 new capacity tests).
- Database migration replay (twice), existing SQL checks and new capacity/permission
  checks: **passed**, including the explicit 100/100 refusal case.
- Full Playwright suite: **164 passed**, including six new capacity scenarios.
  A separate test port, 3141, avoided the unrelated app already running on port 3000.
  Desktop and mobile screenshots were inspected through the test artifacts.
- Frontend lint and **16 unit tests passed**. Production build and TypeScript checks
  passed with `npm run build -- --webpack`. The default Turbopack build hit this
  environment's worker-socket restriction; the repository build/CI command is unchanged.
- Backend Ruff and `git diff --check`: **passed**.
- `npm ci` refreshed all frontend dependencies from the committed lockfile, which is
  unchanged. Its advisory audit reports pre-existing dev-dependency findings in
  Vitest/tinypool (two critical) and @vitest/mocker (one moderate). npm proposes a
  Vitest major-version upgrade; no forced dependency upgrade was bundled into SCRUM-41.

Remote CI has not run for this branch. The migration has only been applied to the
disposable database, not the shared Supabase environment.

## Review ownership

**Delegated:** implement SCRUM-41's capacity invariant and a usable organiser control,
with the smallest reusable registration write for SCRUM-40.

**Constraints:** Jira acceptance criteria, Sprint 4 planning, root/backend/frontend
AGENTS rules, existing session/RBAC architecture and semantic UI design system.

**Human review needed:** Jerome must review the schema/counter trigger, session-only
identity, capacity edit policy, API seam for SCRUM-40 and its integration contract.
This is an AI-proposed implementation; these decisions have not been represented as
already human-approved. See D15 in `DECISION_LOG.md`.

**Accountable owner:** Jerome. Shared deployment, remote CI and merge remain separate
from the local implementation and verification.

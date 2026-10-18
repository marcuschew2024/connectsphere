# SCRUM-38 — Review and update equipment requests

[Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-38) · Jerome · 5 points · Sprint 3 stretch.
Requirements: [Sprint 3 scope](https://spm-g6t4.atlassian.net/wiki/spaces/CS/pages/11141141)
and [Sprint 3 test scenarios](https://spm-g6t4.atlassian.net/wiki/spaces/CS/pages/11141162).

The Coordinator already records demand in SCRUM-35. Tech Support can now open a
request, record its current arrangements, and leave an optional update note. The
Coordinator sees the same persisted status and an attributed history on reload.

## Start the demo

1. Pull the feature branch and retain the existing user, event and equipment setup.
2. After `supabase/create_equipment_requests.sql`, Marcus runs the complete
   [`20261018111728_scrum_38_equipment_request_status.sql`](../supabase/migrations/20261018111728_scrum_38_equipment_request_status.sql)
   in the development project's SQL Editor. It preserves existing requests and
   can be repeated. Never run `supabase/tests/` against the shared project.
3. Restart Flask on 5001 and Next.js on the port matching `FRONTEND_ORIGIN`
   (this workspace uses `http://localhost:3001`). Existing demo roles are reused;
   no new role seed is needed for SCRUM-38.
4. As Coordinator, submit an equipment request for an assigned Planning event.
5. Select **Demo Tech Support → Review equipment requests → Review request**.
   Choose **Reserved**, enter an update note and select **Save status**.
6. Switch to **Demo Coordinator → View equipment requests → View request**.
   Check the current status, note, original items and **Status history**.
   The Coordinator has no update form. **Refresh request** fetches newer changes.
7. Change the status again as Tech Support. In two tabs, save from one and then
   try the older version in the other: the stale save must fail and offer reload.

The new migration has only been applied to a disposable local database during
implementation. Its existence can be checked without changing shared data:

```sql
select
  to_regclass('public.equipment_request_history') as history_table,
  to_regprocedure('public.update_equipment_request_status(uuid,text,text,integer,integer)') as update_function;
```

## Status rules and scope

| Status | Meaning recorded by Tech Support |
| --- | --- |
| Requested | Arrangements are outstanding or have been reopened. |
| Reserved | Tech Support reports that the requested equipment has been arranged. |
| Partially fulfilled | Some of the requested equipment is arranged; notes can explain the remainder. |
| Unavailable | Tech Support cannot currently fulfil the request. |

Any of these statuses may change to a different one, allowing corrections and
reopened arrangements. Re-saving the same status is rejected rather than adding
a duplicate history entry. Update notes are optional, trimmed, and limited to
2000 characters. Original requested quantities and technical notes stay intact.

Planning, Confirmed and Preparation events can still receive arrangement updates.
Cancelled, Completed and Rejected events are read-only. These lifecycle and
stale-update safeguards supplement Jira's three acceptance criteria.

Status is an aggregate report for the whole request. Updating it does not create,
release or change equipment reservations. Actual stock handling remains in
SCRUM-36/37; the UI tells Tech Support to reserve stock before reporting Reserved.
There are no automatic notifications or live push updates: the queue/detail reads
return the latest saved state, and the detail page has an explicit refresh action.
The existing SCRUM-39 `technical_resolved` integration is separate; this story
does not replace its hardcoded confirmation seam or treat a manual status as proof
of sufficient stock. Per-item fulfilment quantities are outside this story.

## Design and API contract

```text
Tech Support review form → Flask identity/input checks
  → one database transaction: lock request, check revision, save status + history
  → Coordinator detail/queue reads the persisted result
```

| Route | Access and response |
| --- | --- |
| `GET /equipment/requests/{id}` | Tech Support, or the event's currently assigned Coordinator; `{request}` with event, requester and ordered items. |
| `GET /equipment/requests/{id}/history?page=1` | Same access; `{history, page, has_more}`, 20 updates per page, newest revision first. |
| `PATCH /equipment/requests/{id}/status` | Tech Support only; body below; `200 {request}` with the updated header. |

```json
{"status":"Partially fulfilled","notes":"Microphones ready; awaiting a projector.","revision":1}
```

The signed-in real user takes precedence over the development session. Origin and
role checks run on every endpoint. Unknown body keys, including client-supplied
actors and timestamps, are rejected. A missing or unrelated request returns 404;
other roles receive 403. Coordinator access follows current event assignment,
matching SCRUM-35, including after reassignment.

`equipment_requests` gains `revision`, `update_notes`, `updated_by`, `updated_at`.
Creation audit stays in `requested_by`/`requested_at`; old requests start at revision
1 with no fabricated update history. `equipment_request_history` stores each real
change's old/new status, notes, actor ID/name snapshot and database timestamp.
Its `(request_id, revision)` primary key also supports bounded history reads.

The database function verifies Tech Support, holds the event lifecycle stable,
then locks the request. Only the submitted current revision can advance. Two
simultaneous edits cannot silently overwrite each other. Updating the header and
inserting history occur in one transaction; an audit failure rolls back the status.

The backend-only RPC follows the existing SCRUM-34/35 contract. `SECURITY DEFINER`
is used to allow that atomic write while denying direct table updates; an empty
search path and qualified objects prevent name substitution. Execute is revoked
from PUBLIC, anon and authenticated and granted only to service_role. Flask uses
its own app-user session, not Supabase Auth UUIDs, and supplies the trusted actor.
The new history table has RLS and no browser grants; only the backend may read it.

Files to read: the new request detail page, `equipment_requests.py`,
`equipment_request_repository.py`, then the migration. The queue links to detail.
Errors retain form input, and ambiguous save failures require a read before retry.

## Acceptance evidence — 18 October 2026

The Confluence stretch checklist specifies the scenarios; the IDs below identify
their concrete automated cases for this implementation.

| Case | Coverage and result |
| --- | --- |
| TC-38-01 · AC1 | All four statuses, notes and original request items persist. Queue → review → update browser flow passes. |
| TC-38-02 · AC2 | Assigned Coordinator sees status/notes after reload, with no edit controls. Other Coordinators and unrelated roles cannot read detail/history. Reassignment immediately changes access. |
| TC-38-03 · AC3 | Actor/time are server-owned; history matches stored revisions and timestamps. Simulated audit failure rolls back the status. |
| TC-38-04 · RBAC/input | Other roles and forged metadata are rejected through the API; the database also checks role and input. History/table/function privileges are checked directly. |
| TC-38-05 · concurrency/lifecycle | Competing saves yield exactly one success; stale or duplicate updates add no history. Closed events remain readable but cannot be changed. |

Local results: **859 API tests** against disposable PostgreSQL/PostgREST, including
58 new SCRUM-38 checks; **143 browser tests**, including 10 new SCRUM-38 checks;
**16 frontend unit tests**; Ruff, ESLint, production Webpack build, migration
repeat checks and SQL permissions/rollback checks. Browser tests use controlled
API responses; separate API/database tests prove real persistence and isolation.
Desktop and mobile screenshots are attached to the Playwright report and inspected.

The Supabase database advisor completed against the disposable database with no
SCRUM-38 findings. Two existing warnings remain: the mutable search path on
`release_equipment_on_event_cancel` and `btree_gist` installed in `public`.

The initial full local API run exposed an existing fixture problem: unmocked
denial logging inherited `api/.env` credentials and added 31 test denial entries
to the shared `access_denied_log` at 19:21 SGT. Those audit entries were retained.
The shared test fixture now clears database credentials and cached clients for
every test. The clean rerun passed, and a read-only check confirmed no further
shared denial entries. The new migration and feature test data remained local.

For a repeat full database run, recreate the disposable compose database first:
some pre-existing acceptance tests retain notification fixtures between runs.
Use `compose.acceptance.yml` with `supabase/tests/run.sh`, then set
`POSTGREST_TEST_URL=http://127.0.0.1:55433` for pytest. Browser checks use a separate
production-test port (`PLAYWRIGHT_PORT=3108` locally).

Human review, PR CI, the shared migration/demo and merge are still required before
Done. Local automated evidence is not a human approval or shared deployment.

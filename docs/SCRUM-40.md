# SCRUM-40 — Register for a confirmed event

[Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-40) · Jerome · Sprint 4 · 5 points.

Implemented on `feature/SCRUM-40-event-registration`. After manual workflow review,
the owner explicitly requested push and merge on 29 Oct 2026, subject to green CI.
Shared Supabase deployment remains a separate step.

## Acceptance and walkthrough

1. Sign in with an Attendee account, or select Demo Attendee in local development.
2. Home → **Browse events** shows confirmed events with date/time and place availability.
3. Open an event, read its description and registration requirements, and enter
   **Registration information**. It is required when the organiser supplied instructions.
4. Choose **Register for event**. Only a committed signup shows **Registration confirmed**,
   with the event information, registration reference and registration timestamp.
5. Home → **Registration confirmations** retains the in-app message and reopens the
   receipt. Refreshing the event retrieves the attendee's own stored receipt, including
   after the event proceeds to Preparation. This is receipt recovery, not SCRUM-44's
   full registration-list/status workflow.

Guests must sign in. Full, unconfirmed, unconfigured, not-yet-open and closed events
reject signups with a clear message. Duplicate signups do not consume another place or
send another confirmation. Failed requests retain entered information and offer
**Refresh registration** to recover a committed signup after a lost response.
No waiting list is enabled; full events say no places are available.

## Setup and deployment boundary

After the existing event/notification and SCRUM-41 migrations, apply
`supabase/migrations/20261029044510_scrum_40_attendee_registration.sql` before deploying
this API/frontend. It adds nullable event registration dates and an information column,
guards registration eligibility, and atomically creates access and confirmation.
It is safe to replay and preserves existing registrations.

This migration has only been applied to a disposable local database. Review is required
before applying it to the shared Supabase project. Do not apply `supabase/tests/*.sql`
to shared data; the harness includes fixture-only permissions.

Opening time is inclusive and closing time exclusive. NULL bounds preserve the current
Confirmed + configured-capacity rule, with no artificial dates backfilled. SCRUM-42
owns the organiser's registration-period editor; any dates stored in these columns are
already enforced by Flask and PostgreSQL. Invalid date ordering is rejected by storage.

## API and implementation

| Endpoint | Contract |
| --- | --- |
| `GET /events/registration-offers?page=1` | Attendee only; 25 confirmed event offers per page, `has_more`; explicit public details, aggregate capacity and unavailability reason |
| `GET /events/{uuid}/registration-offer` | Attendee only; confirmed event or own historical receipt; no private drafts, internal planning data or other attendees |
| `POST /events/{uuid}/registrations` | Attendee only; `{"information":"IS, year 2"}`; legacy `{}` remains valid without requirements; identity/status/time supplied by server |
| `GET /events/registration-confirmations` | Attendee only; latest 50 confirmations for the session user, filtered to `registration_confirmed` |

The POST preserves SCRUM-41's `201 {"registration": ...}` envelope. Missing/invalid
information returns 400; wrong role/Origin 403; guest 401; missing receipt/event 404;
full/closed/duplicate signup 409; uncertain database failures return a safe 503.
All registration responses are `no-store`. Existing organiser `/notifications` remains
organiser-only, with its original UI and tests.

`RegistrationRequest` keeps information/window rules independent of Flask/storage;
`RegistrationCapacity` remains the capacity authority. Repositories own queries.
The capacity trigger still locks the parent event and prevents overselling. Additional
eligibility validation runs after that lock and uses wall time after any wait. The
receipt trigger writes participant access and confirmation in the same transaction;
notification failure rolls the signup and count back.

The existing real-auth resolver now takes priority in `require_acting_user`, matching
`/session`; the demo fallback remains development-only. See D18–D19 in the Decision Log.

## Verification

New API tests encode account/Origin/role boundaries, public projections, required text,
identity spoofing, window edges and own-receipt recovery. Real database tests cover
persistence, receipt isolation, rejection without partial writes, and competing final
places. SQL checks validate backend-only access, invoker functions and complete rollback
when confirmation delivery fails. New browser tests cover discovery → signup → receipt,
Home confirmation, validation, full/closed/duplicate/failure/recovery, guest access,
mobile layout and keyboard use.

Existing tests are not modified, deleted or renamed. `supabase/tests/run.sh` is extended
only to replay the new migration and run the new SQL checks. Existing acceptance tests
retain notification fixtures, so full backend runs use a freshly provisioned database.

Final local verification on 29 Oct 2026:

- Fresh disposable PostgreSQL/PostgREST full API regression: **1,071 passed**, no skips,
  **85% application coverage**. This includes 34 new rule/route tests and four new
  database acceptance tests, plus the existing auth/RBAC/capacity regressions.
- All SQL checks and two applications of the new migration: **passed**, including
  browser permissions and forced-confirmation-failure rollback.
- Full Playwright regression on a separate production server, port 3140:
  **178 passed**, including 12 new registration scenarios. Desktop/mobile form and
  confirmation screenshots were visually inspected; no overflow or clipping found.
- Frontend **16 unit tests**, ESLint, backend Ruff and `git diff --check`: **passed**.
- Production webpack build and TypeScript: **passed**. The standard Turbopack build
  fails in this environment while binding a worker port (`Operation not permitted`),
  the same local restriction recorded for SCRUM-41. The build/CI command is unchanged.

Remote CI has not run because the owner requested local review without pushing.
No shared database migration, remote branch, commit or merge was created.

## Reviewer questions and ownership

- **Delegated:** implement SCRUM-40's four Jira acceptance criteria and the attendee
  discovery/information/receipt/access work explicitly handed off by SCRUM-41.
- **Constrained by:** Jira, existing session/RBAC/value-object/repository patterns,
  SCRUM-41's capacity invariant, root/area AGENTS rules, semantic UI tokens and preserved
  test contracts. No remote push, merge or shared database migration.
- **Evidence:** the acceptance, SQL, browser and regression checks above; final counts
  are recorded below. CI remains a required merge gate.
- **Human review needed:** schema/trigger order and rollback, account resolution across
  existing actions, public projections/participant access, 4,000-character free-text
  collection, unbounded date defaults/SCRUM-42 handoff, and attendee UX. See D18–D19.
- **Accountable owner:** Jerome. Codex proposes the implementation; Jerome reviews and
  owns the design and merge decision. Jira stays In Progress until review; Done follows merge.

## Review fix — Coordinator events remain reachable after approval

Manual review found a navigation gap in the existing workflow: the Coordinator's
only event list filtered to Submitted requests, so approving a request into Planning
removed the route back to its confirmation action. Added **My events** at
`/events/managed`, reached from the sidebar, Home → **Manage events**, and the existing
review queue. It uses the existing session-scoped `GET /events` response to keep
Planning, Confirmed, Preparation and closed records reachable. Request review keeps
its Submitted-only behaviour.

Delegated: unblock step 4 of the attendee test flow by making the Coordinator's
Planning event and **Confirm event** action discoverable. Constraints: reuse existing
event access, confirmation/safety gates, API and design tokens; no schema, permission
or business-status changes. Existing tests were preserved.

Verification: **186 full browser tests passed**, including eight new navigation,
confirmation, lifecycle, role, retry, empty-state and mobile checks; **16 frontend
unit tests**, **40 existing API confirmation/capacity tests**, ESLint, production
webpack build/TypeScript and diff checks passed. The live development app was also
checked with Demo Coordinator. No event decisions were submitted during manual review.

Jerome should review placement, assigned-event visibility and the path back from
request review. Jerome remains accountable. The fix stays local on the SCRUM-40
feature branch; nothing was pushed or merged.

## Review fix — First capacity on an already Confirmed event

The owner reached **Full demo run - Jerome 1** in Confirmed with an unset capacity
and zero registrations. Switching to its Organiser did not help: the original rule
locked every capacity write after confirmation, creating a setup dead end.

Proposed fix (D20): the owning Organiser can set the first capacity once on a Confirmed
event with NULL capacity and zero registrations. A saved Confirmed limit stays locked,
even with no attendees yet. Other roles, other Organisers, Preparation and terminal
states retain their restrictions. The event stays Confirmed and the change is audited.

Review and apply
`supabase/migrations/20261029062324_scrum_40_initial_confirmed_capacity.sql`
after SCRUM-41 before using the new control with the shared database. The migration
only replaces the existing backend-only function; it does not choose a capacity or
change any event record. Until it is applied, the old database lock still rejects
the first save. Shared deployment awaits the owner's approval.

After application: Demo Organiser → the Confirmed event → Registration capacity →
Maximum attendees → Save capacity. The summary and success message remain visible;
the editor then disappears and the existing post-confirmation lock message applies.
An unknown/failed save retains the entered value and does not claim success.

Delegated: remove the unset-capacity dead end encountered during the SCRUM-40 manual
test. Constraints: keep confirmation independent of registration setup, preserve
established limits, ownership, signup concurrency, safety states and audit attribution.
Human review: Jerome must approve the one-time exception and migration (D20), and owns
the domain/API/schema decision. Existing test assertions are preserved; the SQL harness
is only extended with replay/security checks for the new migration.

Verification on 29 Oct 2026: fresh disposable-database regression **1,092 passed**,
no skips, **85% application coverage**; full browser regression **191 passed** (five
new scenarios); **16 frontend unit tests**, frontend ESLint, backend Ruff, production
webpack build/TypeScript and diff checks passed. Both applications of the migration
and the invoker/search-path/backend-only privilege checks passed. The new audit-writing
fixture cleans its own audit rows before removing parent events; no existing test
assertions were changed. No remote push, commit, CI run or merge is part of this fix.

## Merge authorization — 29 Oct 2026

After manually exercising the Organiser/Coordinator/Attendee workflow and discussing
the capacity-lock issue, the owner explicitly requested pushing this branch and
merging it. This authorizes the complete reviewed branch, including the one-time
first-capacity exception in D20, once remote lint, build and e2e checks pass.
Jerome remains accountable for the schema/API/access decisions recorded in D18–D20.
The earlier local-only review notes above describe prior stages of this work.

Deployment of `20261029062324_scrum_40_initial_confirmed_capacity.sql` to shared
Supabase remains separate from the Git merge. No shared event status or capacity
will be changed by pushing/merging this branch. The user's untracked `outputs/`
directory is excluded from the commit.

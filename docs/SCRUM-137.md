# SCRUM-137 / R1: consistent venue buffers, including existing conflicts

## What is fixed

The hosted DB now has the original four occupied-interval columns. A second defect remained:
raising a venue's buffers could overlap two existing bookings and roll back the venue update
before its conflict report ran. The follow-up migration lets the buffer update commit,
recomputes occupied times, and atomically records the affected pair without cancelling,
rescheduling or deleting either booking.

Current venue buffers define `[start_at - setup, end_at + turnaround)`. New and changed
bookings are checked against current occupied windows inside a serialized database write.
Touching boundaries remain allowed. Search, API checks and calendar keep their existing
contracts; no production Python or frontend change is required for R1.

**Important change to the original audit checklist:** the two named GiST exclusions now
cover raw intervals as defence in depth. Occupied-window enforcement is provided by the
new guarded trigger. Checking only whether an exclusion mentions `occupied_start` is no
longer a valid deployment test: an unconditional occupied exclusion conflicts with the
requirement to preserve/flag buffer-induced overlaps. See Decision Log D65.

## Acceptance and verification

| Requirement | Evidence |
| --- | --- |
| Configurable buffers save even when existing bookings become conflicting | Real PUT tests reproduce 15/30→15/60 and setup-only increases; assert successful response and both report entries |
| Preserve records and flag affected bookings | Published fields/status unchanged; one normalized persisted pair; cancellation and reduction clear reports |
| New or changed slots remain protected | Direct DB checks for Confirmed, Blocked, Requested, Pending, Held; forged occupied values and multirow bypass fail |
| Search, booking API and calendar agree | Search booked/available, API 409/201 and stored calendar occupied times asserted against the same DB |
| Half-open boundaries | Exact occupied boundary accepted; setup-only overlap refused |
| Inactive/expired slots release occupancy | Cancelled, Rejected, Expired and expired Held scenarios; existing hold suite unchanged |
| Concurrent writes cannot bypass checks | Two SQL sessions: both booking/buffer orderings, two inserts, two approvals, REPEATABLE READ |
| Staff can complete the real workflow | Playwright INTEGRATED-R1 uses real login, browser edit, real API/DB, persisted report and protected subsequent booking |
| Upgrade/replay | Full disposable SQL harness, follow-up applied twice, original occupancy/expiry checks run again afterward |

Initial proof: **9 failed before / 9 passed after** the candidate migration. Expanded API
checks: **15 passed**. SQL concurrency: **5 scenarios passed**. Final full-suite results are
recorded below after execution; this document is not a substitute for green CI.

## Hosted deployment: what the release owner must do

1. Review D65 and the migration with Jessica/Ernest. Work is isolated in
   `feature/SCRUM-137-buffer-update-conflicts`, based on `e602a44`; it is not deployed or merged.
2. Confirm the target is `pqdkfrvqjeqlsdwvddcd` (SPM ConnectSphere). Use the read-only preflight
   below. Take the team's normal backup before deployment. Preserve bookings; do not delete
   or silently cancel them to make a constraint pass.
3. If the original four columns and old R1 migration are already installed (as verified on
   2026-11-03), apply **only**
   `supabase/migrations/20261102171833_scrum_137_preserve_buffer_conflicts.sql`.
   It is transactional and replay-safe. Do not rerun the original SCRUM-137 afterwards.
   An environment still missing R1 must first follow the original SCRUM-129 → SCRUM-137 →
   hold-release prerequisite sequence, including human reconciliation of pre-existing
   conflicts that block the original migration. This follow-up is not a bootstrap replacement.
4. Record filename, commit, project, actor, timestamp and outcome in the release deployment
   record (or deploy through the team's migration runner so migration history records it).
   SQL Editor execution alone does not populate Supabase CLI migration history.
5. Run the verification query below. On an approved QA venue, repeat the staff buffer edit
   and confirm the report, unchanged booking status/times, calendar and request boundary.
   Shared production writes are deliberately not part of automated tests.
6. Verify SCRUM-167 separately once its notification change is integrated. Current main
   does not implement that follow-up; R1 restores its successful-save/report prerequisite.
   R5 maintenance handling remains separate and paused.

### Read-only preflight

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='venue_bookings'
  and column_name in ('setup_minutes','turnaround_minutes','occupied_start','occupied_end');
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.venue_bookings'::regclass and contype='x';
select tgname, tgenabled from pg_trigger
where tgrelid in ('public.venues'::regclass,'public.venue_bookings'::regclass)
  and not tgisinternal;
```

### Read-only verification after deployment

```sql
-- Must be zero: every persisted occupied window matches current venue buffers.
select count(*) as stale_occupied_windows
from public.venue_bookings b join public.venues v on v.id=b.venue_id
where b.setup_minutes is distinct from v.setup_time_minutes
   or b.turnaround_minutes is distinct from v.turnaround_time_minutes
   or b.occupied_start is distinct from b.start_at-make_interval(mins=>v.setup_time_minutes)
   or b.occupied_end is distinct from b.end_at+make_interval(mins=>v.turnaround_time_minutes);
-- Inspect affected pairs; non-zero is valid and requires staff resolution, not deletion.
select * from public.problematic_venue_bookings order by venue_id, booking_id;
-- All enabled: lock first, recompute/enforce, refresh report; venue refresh also remains.
select tgname, tgenabled from pg_trigger
where tgname in ('a_venue_bookings_lock_buffers','venue_bookings_set_buffer_interval',
 'venue_bookings_refresh_conflict_report','venues_refresh_booking_buffers');
-- Must both be false: internal helper cannot be invoked as a Data API RPC.
select has_function_privilege('service_role','public.lock_venue_buffer_writes(uuid)','execute'),
       has_function_privilege('authenticated','public.refresh_venue_buffer_conflicts(uuid)','execute');
```

### Rollback

A failed migration rolls back atomically. After a successful deployment, do not reinstall the
old exclusion on occupied intervals while flagged pairs exist: it will fail. Preserve the
new enforcement, investigate with the release owner, and use a reviewed forward migration.
A full rollback requires human reconciliation of affected bookings first.

## Review and accountability

- **Delegated:** repair R1 buffer updates and prove consistency with SCRUM-129 AC1–3/Week 7.
- **Constraints:** half-open intervals, existing FCFS tiers, server-side access checks,
  preserved booking history, isolated tests, no weakened existing assertions.
- **Evidence:** new real DB/API and Playwright cases, replay and simultaneous SQL tests,
  plus full regression/lint/build results below and CI before merge.
- **Human review:** database locking, snapshot behavior, raw-exclusion/trigger division,
  privileges, report lifecycle and deployment order (D65).
- **Accountability:** Jessica (policy), Ernest (database review), Jerome/release owner
  (hosted deployment). Agent implementation is not human sign-off.

## Local execution results — 2026-11-03

- Backend: **2,378 passed**, **100% statement and branch coverage**, Python 3.12 CI-compatible
  container, against the isolated `connectsphere-r1` database.
- New focused R1 API/DB cases: **15 passed** (included in the full backend total).
- Full real Playwright integration suite: **15 passed**, including the new INTEGRATED-R1
  browser save/report/boundary journey; no response mocking.
- Frontend unit tests: **652 passed** across 45 files.
- Full SQL harness: passed; follow-up replayed twice; unchanged occupancy and expiry checks
  passed under the replacement enforcement. Five concurrent SQL scenarios passed, plus
  replay **with unresolved flagged conflicts** preserved both Confirmed bookings and report.
- Production build, frontend ESLint, backend Ruff, and `git diff --check`: passed.
- Local catalog security check: all six internal functions use an empty search path and
  reject EXECUTE for anon/authenticated/service_role; guard table has RLS enabled.
- Hosted security advisor was read for baseline context only; it does not inspect this local
  candidate. Existing hosted notices are not evidence this candidate has been deployed.

**Not yet done:** human design/review sign-off, remote CI, merge, hosted migration application
and hosted smoke verification. SCRUM-167 delivery is separate. No hosted data was changed.
- Existing mocked browser regression suite: **331 passed**, no retries.

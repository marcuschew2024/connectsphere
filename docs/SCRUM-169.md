# SCRUM-169 — maintenance includes setup and turnaround (R5)

Parent: SCRUM-60. Related: SCRUM-129, SCRUM-120, Week 7 changes 1 and 2.
Owner: Jessica Ang; database/concurrency review: Ernest Wong.

## Problem and resulting behavior

A 10:00–12:00 booking with 30 minutes of setup and 45 minutes of turnaround occupies
09:30–12:45. Maintenance at 09:45–10:00 or 12:00–12:30 previously escaped search,
booking enforcement and affected-booking notification. All three now use physical
occupation. Maintenance has its own recorded interval; it receives no additional buffer.
Exact occupied endpoints may touch without conflict.

New/changed bookings cannot overlap an existing active block. Venue Staff can still add
an operational block affecting an existing booking: the event and booking survive and
the current coordinator receives a notice directing them to replacement arrangements.
One notice per coordinator lists every affected event, preserving the existing notification
count contract. Its event link opens the first affected event; the message names the others.
Cancelled/rejected/expired bookings and expired tentative records are not reported as affected.

## Implementation

- `venue_unavailability.occupied_window` reuses the existing pure BookingInterval model.
- Search queries maintenance over that proposed occupied window.
- Existing-booking queries use persisted R1 occupied columns, with expired-hold filtering.
- The new migration derives a proposed booking interval inside the maintenance guard.
  It cannot trust `NEW.occupied_*`: the R1 population trigger runs later alphabetically.
- Maintenance writes acquire R1 D65's versioned per-venue guard before validation. A
  committed booking is visible to the subsequent block report, or a committed block is
  visible to the booking guard. Stale snapshots abort safely; unrelated venues do not share
  a lock. Both write orderings and two competing blocks are tested; see D66.
- R1 buffer refreshes and harmless metadata edits preserve existing affected bookings.
- Calendar maintenance display takes precedence over confirmed occupancy so an outage
  cannot be hidden by an existing booking's setup/turnaround window.
- No new role, automatic cancellation, status-transition rule, or replacement policy.

## Acceptance criteria and executable evidence

| Required behavior | Evidence |
| --- | --- |
| Setup-only and turnaround-only maintenance blocks availability and booking | `test_search_and_new_booking_agree_on_maintenance_window`; `test_database_itself_refuses_buffer_only_maintenance` |
| Half-open boundaries and zero buffers | Same search test boundary cases; `test_zero_buffers_do_not_expand_maintenance` |
| Changed booking cannot enter a blocked buffer and failed edit is atomic | `test_edit_into_buffer_only_maintenance_is_atomic` |
| New block identifies existing arrangements, notifies coordinator, preserves records | `test_new_block_flags_existing_booking_notifies_and_preserves_event` |
| Current coordinator, every affected event, no inactive/expired false positives | Live-hold/reassignment, multi-event summary, and inactive-status acceptance tests |
| Unblocking restores availability with audit; role restrictions hold | Unblocking and nonstaff acceptance tests |
| Concurrent block and booking do not silently miss each other | `supabase/tests/maintenance_concurrency.sh`, both orderings, REPEATABLE READ and competing blocks; SQL harness runs it |
| Calendar, notice navigation, replacement request/approval, unaffected sibling preservation | Two `INTEGRATED-R5` journeys in `frontend/integration/release-exits.spec.ts` |
| Equivalent timezone representations | `api/tests/test_maintenance_window.py` |

All new backend acceptance tests are in `api/tests/test_maintenance_buffers_acceptance.py`.
Existing assertions were retained. Before production changes, the first 18 new cases gave
14 failures and 4 passes, demonstrating the missing behavior rather than only confirming
the implementation. Final execution results are recorded below after verification.

## Deployment and limits

R1 PR #103, including its occupied columns and per-venue write guard, must be installed first. Apply the new migration
`supabase/migrations/20261102174539_scrum_169_maintenance_occupied_windows.sql` through
the reviewed release process. The disposable SQL harness applies it twice.

This change does not silently notify historical conflicts during migration. Before rollout,
review existing active maintenance against active booking occupied intervals, excluding
expired holds. Any previously missed affected events need coordinator follow-up. Existing
events/bookings must not be deleted to make the rollout pass.

R1 PR #103 is merged into this branch; R4 event readiness comes from current main. Browser
evidence is Chromium; no cross-browser or production load result is claimed.

## Review accountability

- Delegated: close R5 against SCRUM-60/129 and test normal, boundary, failure and concurrency paths.
- Constraints: existing half-open intervals, role guards, preservation/replacement ACs, test protection.
- Evidence: regression failures before the fix, disposable DB/API, SQL concurrency and browser tests.
- Human review: migration and lock trade-off, venue acceptance and coordinator summary behavior.
- Accountable owners: Jessica for venue behavior, Ernest for database review, release owner for deployment.

No push, merge or hosted migration deployment is claimed by this local implementation record.

## Release steps

This fix needs **both application code and a database migration**: the API/search/report
changes and calendar priority are in the repository; direct SQL booking enforcement is in
`supabase/migrations/20261102174539_scrum_169_maintenance_occupied_windows.sql`.

1. Review D66 with Jessica/Ernest and run CI before merge. R1 PR #103 is already merged.
2. Confirm R1's occupied columns and `public.lock_venue_buffer_writes(uuid)` exist in the
   release database. The R5 migration fails clearly if the R1 guard is absent. On 2026-11-03,
   a read-only check of hosted project `pqdkfrvqjeqlsdwvddcd` found this R1 prerequisite
   present and the old maintenance guard still comparing raw times.
3. Apply the R5 migration through the reviewed release process and deploy the API/frontend
   changes. Record project, commit, migration filename, actor, time and result. SQL Editor
   execution alone does not add CLI migration history.
4. Review existing active maintenance overlaps before rollout using the read-only query
   below. The migration does not retrospectively send notices for old blocks.
5. Smoke-test an approved QA venue: a 14:00–15:00 event with 30/45-minute buffers occupies
   13:30–15:45. Blocks at 13:45–14:00 and 15:00–15:30 must block search/new booking and
   identify existing booking IDs. Blocks ending 13:30 or starting 15:45 must not conflict.
   Check the maintenance calendar, targeted coordinator notice and replacement workflow.

```sql
-- Preflight: R1 dependency must exist.
select to_regprocedure('public.lock_venue_buffer_writes(uuid)');
-- Read-only review of existing active blocks against physical room occupation.
select u.id as block_id, b.id as booking_id, b.event_id, b.venue_id,
       u.start_at as block_start, u.end_at as block_end,
       b.occupied_start, b.occupied_end
from public.venue_unavailability u
join public.venue_bookings b on b.venue_id=u.venue_id
where u.status='Active' and b.status in ('Requested','Pending','Held','Confirmed')
  and not (b.status in ('Requested','Pending','Held')
           and b.expires_at is not null and b.expires_at <= now())
  and b.occupied_start < u.end_at and u.start_at < b.occupied_end
order by b.venue_id, u.start_at, b.id;
-- Post-deployment: both triggers enabled; helpers unavailable as service-role RPCs.
select tgname, tgenabled from pg_trigger where tgname in
 ('a_venue_blocks_lock_buffers','reject_booking_in_active_venue_block');
select has_function_privilege('service_role','public.serialize_venue_block_writes()','execute'),
       has_function_privilege('service_role','public.reject_booking_in_active_venue_block()','execute');
```

Both EXECUTE checks should be false. Trigger functions run internally with their explicitly
restricted definer privileges. Do not roll back to the raw-time guard as a production fix;
that would reopen R5. A failed migration rolls back atomically.

## Final local execution evidence — 2026-11-03

Verified on top of merged R1 (`4b32c6b`) and current rescheduling code, using the isolated
`connectsphere-r5` PostgreSQL/PostgREST stack. No hosted database writes were made.

- Focused R5 API/domain cases: **42 passed**; the original pre-fix baseline was 14 failures
  / 4 passes across the initial 18 cases. New calendar unit cases also pass.
- Full backend: **2,463 passed**, **100% statement and branch coverage** (Python 3.12).
- Full real Playwright browser/API/DB integration: **17 passed**, including both R5
  replacement journeys and the R1 buffer-change journey; no mocked HTTP responses.
- Existing browser regression: **337 passed**, no retries.
- Frontend unit: **655 passed** across 46 files.
- Full SQL harness and migration replay passed. Four R5 concurrency scenarios passed:
  booking-first, block-first, REPEATABLE READ, and two competing maintenance blocks.
  Existing R1 concurrency and replay checks also passed on the combined schema.
- Build, frontend ESLint, backend/QA Ruff, 8 QA tooling tests, 26 requirement mapping
  validations, and `git diff --check` passed. Existing assertions were not weakened.
- Catalog inspection confirmed the two R5 functions have an empty search_path and no
  EXECUTE privilege for anon, authenticated or service_role.

**Remaining release gates:** human review of D66, remote CI/merge for R5, application
release and hosted R5 migration/smoke verification. R1 PR #103 is already pushed and merged
with green CI; this record does not claim R5 has been pushed, merged or deployed.

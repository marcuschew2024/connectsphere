# SCRUM-163 — Real Playwright venue flows

[Jira task](https://spm-g6t4.atlassian.net/browse/SCRUM-163).
Branch: `feature/SCRUM-163-venue-e2e-flows`, updated to `572ef1e` (PR #94).
The original implementation and accuracy audit below used baseline `f2e2a75`.

Release 1 rows 8, 10 and 13 now have browser-to-database scenarios in
[`venue-flows.spec.ts`](../frontend/integration/venue-flows.spec.ts). Each uses real
password sign-in, production Next.js, Flask and disposable PostgreSQL/PostgREST.
There are no intercepted or fabricated HTTP responses. The accuracy audit also fixed
the calendar's omission of setup/turnaround occupancy, implementing SCRUM-137's existing
rule; see [D55](DECISION_LOG.md). The existing integrated CI job discovers the new file automatically.

PR #94's controlled-browser assertions are retained unchanged. This follow-up adds
real persistence, notification-recipient and occupied-slot evidence to those same
venue flows. The traceability matrix names both evidence layers explicitly. This
scope completes those venue scenarios; it does not assert that every Release 1
requirement or deployment condition has full real-stack E2E coverage.

| Scenario | Acceptance evidence |
| --- | --- |
| INTEGRATED-12 / row 13 | Coordinator submits through the booking form; Venue Staff approves in the UI; the stored booking is Confirmed; the requesting Coordinator receives exactly one approval notice, follows its link and sees the venue after reload; a different Coordinator receives no such notice. The calendar shows the confirmed slot after reload. A second event cannot book the same time or a slot whose setup overlaps turnaround; both return 409 without creating bookings. A later slot whose buffered boundaries only touch is accepted. |
| INTEGRATED-13 / row 8 | Staff creates, edits and retires a venue through the UI. Stored name, location, capacity, facilities, accessibility, layouts, hours, buffers, timezone and creation audit are checked. The Coordinator sees the catalogue fields and opening hours. Edits and retirement survive reload; the retired venue is absent from Coordinator search and its edit page is read-only. |
| INTEGRATED-14 / row 10 | Four real venues initially appear. Combined date/time, minimum-capacity, Projector and available-only filters retain the match and exclude separate small, missing-facility and maintenance-blocked venues. Changing only the date restores the maintenance-blocked venue while the other exclusions remain. |

Prerequisite events and search fixtures use authenticated real API calls. The new
tests exercise venue actions in the browser; they do not claim to exercise event
creation/assignment forms in these scenarios. Unique names and location filters
isolate runs; test records live only for the disposable database lifetime. These
scenarios do not establish concurrent-write behaviour, every error branch or human
release acceptance. Existing lower-level tests remain necessary.

## Run and watch

Use the standard [verification setup](testing/README.md) to install dependencies,
initialise the disposable database and build the frontend. From `frontend/`:

```sh
npm run test:integrated -- venue-flows.spec.ts
# Open Chromium and watch the same flows:
npm run test:integrated -- venue-flows.spec.ts --headed
# Run the full integrated regression suite:
npm run test:integrated
```

Playwright starts the API on 5001 and production frontend on 3107, refusing to reuse
existing servers. The Python executable defaults to `api/.venv/bin/python`; set
`QA_PYTHON` if using a different environment. Failures retain screenshots and traces
under `frontend/test-results/integrated`; the HTML report is in
`frontend/playwright-integrated-report`.

For a second worktree when another task owns database port 55433, initialise a
separate stack from the repository root:

```sh
ACCEPTANCE_REST_PORT=55434 docker compose -p connectsphere-venue-flows -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-venue-flows -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh
```

Then run in `frontend/` with `POSTGREST_TEST_URL=http://127.0.0.1:55434` before the
Playwright command. API/frontend ports must still be free. The launcher accepts only
the exact localhost/127.0.0.1 URLs on 55433 and 55434, clears hosted Supabase
credentials, and rejects other targets before importing the app. Compose defaults
to 55433, so CI behaviour is unchanged. Stop only your own named disposable stack
with `docker compose -p connectsphere-venue-flows -f compose.acceptance.yml down -v`.

## Review and accountability

- **Delegated:** add the three missing real user-flow scenarios and connect them to
  the existing requirement mappings; prove the tests execute locally. The user then
  requested a deeper accuracy audit and explicitly authorised fixing the calendar gap.
- **Constrained:** existing booking, retirement, buffer and role rules; accessible
  selectors; production sessions; isolated database; no changes to existing test
  assertions from main, schema or business policy. The audit strengthens the new
  SCRUM-163 assertions and adds occupied timestamps to the calendar read response.
- **Evidence:** the verification results below and repeatable commands above. The
  first development run caught two selectors matching Next.js's route announcer;
  scoping the new assertions to page content fixed this without changing expectations.
- **Human review:** Jessica reviews catalogue/search expectations and buffer cases;
  Ernest reviews approval/notification expectations; Marcus reviews test independence,
  the additional fixed local database port and the release evidence. Ernest also
  reviews D55's additive calendar API fields.
- **Accountable owner:** Marcus owns SCRUM-163 and release/merge acceptance. Local
  green tests do not establish hosted CI or independent acceptance. On 2 November
  the user explicitly authorised pushing and merging this verified change, subject
  to the repository's green-CI gate.

## Local verification on 1 November 2026

The following records the initial implementation run. The deeper audit below
supersedes its narrower calendar claim.

- All 14 integrated journeys passed on a freshly bootstrapped disposable database
  (39.9 seconds, zero failures/skips). SQL bootstrap and both migration passes passed.
- Three new integrated journeys passed on the real stack, including after an earlier
  run left test records in that same disposable database.
- ESLint and TypeScript passed; Ruff passed for `scripts/qa`.
- All eight evidence-tool/database-isolation tests passed; 26 requirement mappings
  validated; whitespace checks passed.
- The unchanged application at baseline `f2e2a75` had already passed its production
  build and all 326 controlled-browser tests during the preceding inspection.
  Those mocked-browser results are separate from the real integrated evidence.

## Accuracy audit and calendar correction

The original e2e asserted only the confirmed event hour. Strengthening it to assert
the exact Tuesday setup/event/turnaround cells reproduced a real failure: a
14:00–15:00 booking with 30-minute buffers left 13:30–14:00 and 15:00–15:30 visually
available. The repository expanded its fetch window but returned only raw event
timestamps. The fix returns the existing `occupied_start`/`occupied_end` database
fields and uses them in the calendar classifier. Raw event times, booking enforcement,
database writes and schema are unchanged. Maintenance/legacy rows retain raw-slot
fallback. Three new pure calendar tests cover buffer cells, touching boundaries,
tentative styling and fallback.

The fix's real-stack run then exposed an incomplete test schema: `supabase/tests/run.sh`
had never applied the merged SCRUM-137 occupied-interval migration. Enabling it exposed
its malformed conflict guard (`END` instead of `END IF`). The one-line correction is
the same as unmerged commit `0400378`; the guard still rejects existing conflicts.
The bootstrap now applies this existing migration twice and executes a new rollback-only
SQL check of the stored interval, a true setup-only overlap and a compatible touching
boundary. No new schema design or shared-database deployment is included. The older
inactive `venue_buffers_137.sql` has not been changed or claimed as passing.

**Reviewable test strengthening:** the new SCRUM-163 scenario now checks exact submitted
times, absence of an approval notice before approval, exact calendar day and buffer
cells, unchanged raw calendar times, full venue details after retirement and same-day
search timing boundaries. An audit-only draft assertion expected a Requested booking
to appear Available; the first run correctly rejected that assumption. It was corrected
to the documented Tentative hold state, without changing the application rule or tests
from main. The subsequent failure at `Tue 1pm: Confirmed` is the actual defect's
pre-fix evidence. No assertions were removed to hide the defect.

Three temporary negative-control API launchers deliberately suppressed the approval
notification, discarded layout edits or ignored the facility filter. Each corresponding
e2e failed at its intended assertion (missing notice, persisted Theatre still checked,
or non-matching venue still visible). These were runtime faults outside the repository,
not changes to production code. Their nonzero test exits are successful defect-detection
checks, not passing application tests.

Final audit results, including source/artifact SHA256s, are saved in
[`testing/venue-flow-audit-2026-11-01.json`](testing/venue-flow-audit-2026-11-01.json).

| Final check | Result |
| --- | --- |
| Fresh complete SQL bootstrap | Passed, including SCRUM-137 twice and the new persisted-buffer check |
| Real Playwright suite | 14 passed, zero failed/skipped; 53.8 seconds |
| Three venue flows repeated three times on the same database | 9 passed, zero failed/skipped; 30.3 seconds |
| Controlled-browser regression | 326 passed, zero failed/skipped |
| Frontend unit suite | 599 passed |
| Focused backend calendar/repository regression | 201 passed |
| Deliberate fault checks on final code | All 3 detected at the intended assertion |
| Combined frontend source-coverage gate | 100% lines (2,326), statements (2,868), functions (918), branches (2,900) |
| Build / static / tooling | Production build, ESLint, TypeScript, Ruff, whitespace, 8 tooling tests and 26 mapping validations passed |

The full backend acceptance suite, cross-browser testing and hosted CI were not run
for this change. The audit database was isolated from other work and removed afterward.
No shared database, push, merge or production deployment is included. Marcus/Jessica/
Ernest review responsibilities above remain in force.

## PR #94 integration verification — 2 November 2026

Fast-forwarded this isolated feature branch to latest `origin/main` (`572ef1e`),
including Jessica's merged PR #94. Her existing booking assertions are unchanged.
The real venue scenarios, buffer display correction and complete SQL bootstrap
described above now run together with her tests. Rows 8, 10, 13 and 14 in the
traceability matrix explicitly reference the real evidence.

| Check on the combined branch | Result |
| --- | --- |
| Production build, ESLint and TypeScript | Passed |
| Complete controlled-browser suite, one worker, no retries | 326 passed; zero failures/skips |
| Complete real browser/API/database suite, fresh isolated database, no retries | 14 passed; zero failures/skips |
| Frontend unit suite | 599 passed |
| Focused backend calendar/repository regression | 201 passed |
| Fresh SQL bootstrap, including SCRUM-137 replay and persisted buffers | Passed |
| Ruff, whitespace, requirement mappings and test tooling | Passed; 26 mappings validated and 8 tooling tests passed |

The four timeouts from the earlier unmodified-main inspection did not recur in
this complete single-worker browser run. Their original cause is not established;
no assertions, timeouts or retry settings were changed to obtain a pass.

Reproduce the browser run with `PLAYWRIGHT_PORT=3120 npm run test:e2e -- --workers=1`
from `frontend/`. For the real suite, use the fresh-database instructions above and
`POSTGREST_TEST_URL=http://127.0.0.1:55434 npm run test:integrated` (set `QA_PYTHON`
when needed). Both commands execute all tests in their respective suites.

[Machine-readable verification](testing/venue-flow-pr94-verification-2026-11-02.json)
records the baseline, source hashes and result-artifact hashes. The earlier
mutation checks and combined coverage remain separately dated historical evidence;
they were not rerun for this follow-up. No full backend acceptance, cross-browser,
concurrent-write or hosted-CI claim is made. The disposable stack is removed after
verification. Review/accountability remain as listed above; this work is unpushed
and unmerged.

# SCRUM-161 — Permission evidence and complete backend/shared-logic coverage

[Jira](https://spm-g6t4.atlassian.net/browse/SCRUM-161) · Owner: Jerome.
Scope expanded at the user’s request to every backend application module and frontend
`src/lib` runtime module. Statement and branch targets are 100%; whole-page unit
coverage remains separately visible.

Baseline: main `3acb2b5` (1 November 2026). Branch:
`feature/SCRUM-161-meaningful-test-coverage`.

## Delivered behaviour and proof

- Real password/browser/API/database journey `INTEGRATED-05` signs in as Attendee,
  Venue Staff and Tech Support. An unrelated event's details return 403 without the
  private purpose; the page explains denial and offers no lifecycle actions. Forged
  Planning/Confirmed/Cancelled/Completed requests are refused and the owner's persisted
  event stays identical. No API responses are mocked in this journey.
- Controlled browser scenarios cover all three roles when a legitimate read is allowed:
  no management controls or roster link, stable read-only state after reload, no mutation
  requests. The forbidden page has an explanation and a link home.
- Existing real-database SCRUM-135 tests independently prove related membership does not
  grant status mutation, refusal is logged, and attendee reads use the public projection.
  These tests remain intact. The traceability row now distinguishes denied/status
  responses from permitted staff planning reads; this is not a new access policy.
- Equipment tests cover missing records, malformed JSON, missing/forged fields, invalid
  quantities/times, read-role restrictions and empty reservation lists. Invalid operations
  assert no write. A real-database test also confirms stock and reservations stay unchanged.
- Registration persistence tests verify invalid withdrawal-policy and database failure
  messages, exception status and omission of private database details.
- Frontend unit tests cover request-state versus visible-stage mapping, assignment versus
  review, terminal states, unknown statuses, significant-change re-review presentation,
  booking labels and Singapore audit timestamps across a UTC date boundary.

## Bugs exposed and fixed

1. `int(quantity)` silently accepted `true` and `1.5` as one reserved unit. The new tests
   reproduced 201 before the fix. Reservations now require a positive JSON integer within
   the existing limit. Strings, floats and booleans are refused with 400.
2. Reservation timestamps with non-string types could escape as type errors; malformed
   date strings reached PostgREST before validation and returned a misleading 503. The
   real-database regression reproduced that failure. Both availability and reservation
   routes now validate the existing time-window rule before querying reservations.

`equipment_window` extracts the existing timezone/order check into a shared pure helper.
Stock calculations and half-open interval rules are unchanged. See Decision Log D50 for
constraints and the compatibility trade-off. No schema change is required.

## Verification method and limits

The unchanged baseline and final backend suite ran against a dedicated disposable
Postgres/PostgREST stack, separate from manual testing. Existing loopback-only test
safety assertions were preserved by running Python inside the disposable service's
network namespace. The new real browser journey used separate API/frontend ports and
real password sessions. Manual-test data and hosted Supabase were not changed.

The existing four integrated journeys were not rerun locally for this change; the newly
added fifth journey was run. The full integrated lane remains a required hosted CI check
before merge. All existing backend/browser/unit tests are preserved, and coverage
inclusions/exclusions are unchanged. The backend gate is raised from 80% to 100%, and `src/lib` now has a 100%
statement/branch/function/line gate. Whole-source frontend reporting remains enabled.

Frontend **whole-source V8 unit coverage** includes pages that are tested with Playwright;
it remains a separate unit-only report. The combined source report below now also
accounts for execution in the controlled browser suite. Report `src/lib` separately without hiding those
pages from the coverage denominator. `equipment-requests.ts` mostly declares types; its runtime status choices are tested.
Type declarations do not add runtime coverage evidence.

Uncovered UI branches, additional booking-edit browser journeys, and other owners’
release scope are not declared complete here. Waiting-list creation/promotion remains deferred under
SCRUM-80. The final freeze smoke run and shared deployment verification remain separate.

## Reviewer questions

1. **Delegated:** close Jerome’s missing permission evidence and every backend/shared
   frontend logic coverage gap; fix defects the tests expose.
2. **Constrained:** Jira acceptance criteria, root/backend/frontend AGENTS, existing
   repository/value-object separation, real isolated database, no weakened existing tests.
3. **Evidence:** executed counts and coverage below; red-before-green quantity and real
   database date regressions; full frontend build/lint/browser checks and mapping validation.
4. **Human review:** D50’s strict JSON integer contract, the two behaviour-preserving
   search/suggestion simplifications, the new coverage gates, unchanged interval semantics,
   all three browser roles, and the distinction between attendee projection and permitted
   staff reads. Hosted CI is still required before merge.
5. **Accountable:** Jerome owns the implementation; relevant story owners review domain
   behaviour. Local verification is not independent human acceptance or release sign-off.

## Executed results — 1 November 2026

- Backend: **2,259 passed**, no failures or skips (baseline: 2,153).
- Frontend units: **148 passed** (baseline: 94).
- Controlled browser suite: **320 passed**, including four new permission/forbidden cases.
- Additional real browser/API/database journey: **1 passed**, exercising all three roles
  in the first pass; not rerun for the subsequent test/refactor-only expansion.
- Production build, full ESLint, Ruff, whitespace checks, SQL shell syntax, 26 requirement
  mappings and seven evidence-tool tests passed. The build needed network access for
  the existing Google font. No hosted CI or merge is claimed for this branch.

| Scope | Statements: before → after | Branches: before → after |
|---|---:|---:|
| Backend app, every measured module | 97.34% → **100.00%** | 96.31% → **100.00%** |
| Frontend `src/lib`, every runtime module | 69.05% → **100.00%** | 95.88% → **100.00%** |
| Frontend whole-source unit coverage | 3.99% → **5.78%** | 86.29% → **90.79%** |

Frontend shared logic covers all 475 measured statements, 239 branches and 38 functions.
Whole-source frontend coverage is 475/8,205 statements. Browser execution remains outside this V8 unit report. The separate combined report
below now measures it; **the whole application is not at 100%**.
The frontend whole-source branch percentage is not evidence that 90.79% of UI decisions
were tested: V8 cannot enumerate all branches of modules never loaded by unit tests.
Complete coverage also does not certify every Release 1 acceptance criterion.

## Expanded verification

The expanded pass adds session loading, signed-out/outage distinction, cancellation and
stale-response tests; assignment API contracts, legacy sort fallbacks and resource
formatting; event owner-only settings, malformed edits, safety-detail projection and
audit-storage failures; booking time/hold boundaries; repository outages; and a real
venue-block lifecycle with notifications, touching-boundary filtering and persisted
unblock audit. No existing test assertion is removed or relaxed.

The venue search loop now uses explicit exhaustion/look-ahead exits. Its previous
`while len(matches) <= PAGE_SIZE` condition could never become false: the body already
broke when a look-ahead match was found. Removing that redundant condition changes no
search result or pagination rule; existing pagination tests remain intact.

Venue suitability no longer selects a lexicographically smallest typo that was never
returned or otherwise used. It returns the same canonical suggestion upon finding a
qualifying typo. This removes an unnecessary set-iteration-dependent branch; tests
cover multiple typos and reversed input order. No matching or suggestion rule changes.

`jsdom` is pinned as a test-only dependency for React hook lifecycle tests. The
disposable SQL bootstrap grants DELETE on venue blocks solely so acceptance fixtures
can clean up their rows. Production permissions and migrations are unchanged.

The full backend run passed the new 100% gate, and Vitest passed its `src/lib` gate.
No new coverage exclusions were added. Existing tests remain intact; test additions preserved their existing assertions. The later combined-report step
also changes browser fixture imports, as explained below. Local results are ready for Jerome’s review; push/merge and hosted CI
remain pending.

## Combined frontend report

At the user's further request, an opt-in source-instrumented lane now accounts for unit
and controlled-browser execution together. It uses the same counter map in both runs,
includes untouched files, checks source hashes, and keeps separate unit/browser/combined
reports. D51 records the measurement contract and limits. Browser tests change only their
fixture import; assertions, actions, test names and mocked API responses are unchanged.
An additional collector probe verifies that counters survive two full reloads.

`PLAYWRIGHT_PORT=3137 npm run test:coverage:combined` passed on 1 November 2026:
three merger checks, 148 unit tests, the instrumented production build and 321 browser
tests (320 application scenarios plus one collector probe). The 95-file baseline includes
untouched sources. Collection retained 364 documents across 321 test receipts; 37 tests
retained more than one document. No application source or existing assertion changed.

| Same-source Istanbul report | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Unit only | 9.11% | 6.70% | 9.33% | 9.36% |
| Browser only | 80.56% | 75.32% | 79.69% | 83.07% |
| **Combined union** | **81.63%** | **76.74%** | **80.68%** | **83.95%** |

The combined totals are 2,285/2,799 statements, 2,152/2,804 branches, 735/911 functions
and 1,900/2,263 lines. The original V8 unit-only report stays separate; its 5.78% figure
uses a different counting model and is not the baseline for this table.

Remaining gaps include booking queue/edit pages, the equipment availability modal,
draft-workspace paths, error/conditional branches, unused UI primitives and server-only
layout/forbidden rendering. A browser assertion can pass for server-rendered HTML while
its server TSX remains unmeasured. These files remain in the denominator.

Reproduce with `npm run test:coverage:combined` from `frontend`. Open
`frontend/coverage-combined/combined/index.html`; `comparison.json` records all three
summaries and `sources.json` records source digests. CI generates and uploads these
artifacts without replacing the normal unit report or its existing 100% shared-logic gate.
Hosted CI, human review, push and merge remain pending.

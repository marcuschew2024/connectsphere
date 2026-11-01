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

## Release 1 behaviour follow-up

The user prioritised complete Release 1 behaviour evidence, with further progress toward
100% where meaningful. This matches the freeze plan's distinction between proving release
behaviour and increasing a dashboard percentage. The earlier combined figures above are
baseline results, not the latest measurements.

Added 50 frontend unit/component cases and three controlled-browser booking scenarios.
They exercise role-switch loading/failure/races, availability and reservation validation,
booking queue fallbacks, booking edits and failed saves, access-denial rendering and
accessible UI controls. Test-only React Testing Library renders real components with
mocked I/O; no application source is excluded from coverage. Direct rendering also measures
server-page functions in the unit lane; it does not measure Next server execution.

Six additional real browser/API/database journeys now cover:

- Cancellation, persisted closure, venue/equipment release and attendee notification links.
- Safety approval through completion, audit notes and released resources.
- Venue blocking, Coordinator notification links and replacement while preserving the event.
- Lead reassignment, denied old-Coordinator access and permitted new-Coordinator access.
- Significant change approval, persisted re-review, preserved resources and implementation.
- Clarification, same-request resubmission and rejection with the reason visible to the Organiser.

All eleven integrated journeys passed together on the disposable local stack. Setup uses
real APIs; the named user actions, reloads and notification links use real browsers and
password sessions. No HTTP responses are mocked in this lane. Existing four integrated
specifications only gain optional local URL environment variables; their default addresses,
names and assertions are unchanged. This supersedes the earlier note that only journey 05
was rerun. The full SQL harness also passed; its missing buffered-exclusion migration is
explicitly retained as an evidence gap below.

The new tests exposed one UI defect: direct booking-edit URLs offered edits the existing
API would reject. The page now shows only an owned Requested booking as editable. D52
records the existing permission rule, regression evidence and human review ownership.

### Release limits that tests cannot declare complete

- **Jessica / Ernest:** the SCRUM-137 buffered-exclusion migration has an incorrect
  `END` for an `IF` and is omitted from the SQL harness. Application overlap tests do
  not prove database protection against concurrent buffered bookings. The separately
  owned migration correction, replay and concurrency evidence remain necessary.
- **Jessica:** persisted automatic hold expiry and its notification workflow remain
  missing (W7-04 / SCRUM-79); an expired value object's overlap behaviour is insufficient.
- **Marcus with story owners:** accept or resolve the clarification source conflict,
  own/view-all Coordinator policy, advisory suitability versus booking capacity, and
  Coordinator-attested re-review versus independently enforced re-approvals.
- **Registration owners / Marcus:** waiting-list creation and promotion remain deferred
  SCRUM-80. Registration-period editing (SCRUM-42) and acceptance of closing registration
  at Preparation need release-scope resolution; reminders (SCRUM-50) need verify-or-defer.
- **Release owner:** final HTTPS/session-expiry/deployment checks, complete notification
  recipient matrix, clean-clone freeze smoke run, hosted CI and human review remain open.

`docs/testing/requirements.json` now maps the new evidence and removes stale claims that
venue replacement and rescheduling are absent. Rescheduling already has backend acceptance
coverage; this does not automatically accept the surrounding re-review policy. The 26
mapping rows validate; a mapped passing test is not acceptance of an entire requirement.

### Reviewer hand-off for this increment

1. **Delegated:** fill the freeze-plan journey and booking-edit evidence gaps; pursue useful
   frontend coverage and fix defects the new tests reveal.
2. **Constraints:** release acceptance criteria, unchanged backend permission rules,
   existing test assertions and complete-source coverage denominators; disposable data only.
3. **Evidence:** eleven real integrated journeys, 50 new component cases, three new browser
   cases, SQL harness, lint/build, coverage instrumentation checks and traceability validation.
   Final measured suite totals are recorded below after the full run.
4. **Human review:** Ernest/Marcus review D52's API/UI alignment; Jerome reviews test intent,
   the optional integration URL changes and the release gaps. Hosted CI remains required.
5. **Accountability:** Jerome owns SCRUM-161. Feature/policy owners above own acceptance
   decisions; agent-generated passing results do not constitute their approval.

### Final local results for this increment — 1 November 2026

| Same-source Istanbul report | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Unit only | 17.42% | 13.40% | 17.56% | 18.24% |
| Browser only | 82.67% | 76.49% | 81.33% | 85.20% |
| **Combined union** | **89.10%** | **82.78%** | **87.37%** | **91.82%** |

Combined totals: 2,495/2,800 statements, 2,328/2,812 branches, 796/911 functions and
2,079/2,264 lines across the same 95 source files. The small denominator increase comes
from the new booking access condition; no source exclusions were added. Compared with the
first combined report, statement coverage rose 7.47 percentage points and branches 6.04.

- **198 unit/component tests** pass, including the existing 100% V8 `src/lib` gate.
- **323 ordinary browser scenarios** pass against the normal production build.
- **324 instrumented browser scenarios** pass (323 application scenarios plus the collector probe).
- **11 real browser/API/database journeys** pass together on the isolated disposable stack.
- Normal/instrumented builds, ESLint, three coverage-merger tests, six traceability-report
  tests, 26 mapping validations and `git diff --check` pass.
- Backend source is unchanged by this increment. Its recorded **2,259 passing tests**, with
  **100% statements (3,907/3,907) and branches (1,434/1,434)**, remain the applicable evidence.

Remaining combined measurement: 305 statements, 484 branch outcomes and 115 functions.
The largest statement gaps are venue-request creation (59), venue details (34), venue
catalogue/search (16), event browsing (12), withdrawal-policy editing (12), event editing
(11) and event status (11). These include error, cancellation/race and alternate-form paths;
they remain visible and are not claimed as tested merely because the main journeys pass.
The existing draft workspace is exercised; it is no longer a leading unmeasured area.

Generated local evidence is under `frontend/coverage-combined/` and
`frontend/test-results/release-checklist/`; the latter joins current unit/browser/integrated
JUnit with the unchanged backend evidence. Every mapped check passed; acceptance is still
explicitly incomplete because the recorded scope, implementation and deployment gaps remain.
CI regenerates the artifacts. Only durable implementation, tests, mappings and this review
record belong in the commit. This work is local; push, merge, hosted CI and human acceptance
remain pending. Disposable test services were removed after verification.

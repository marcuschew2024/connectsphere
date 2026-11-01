# SCRUM-161 — Release testing and complete measured source coverage

[Jira](https://spm-g6t4.atlassian.net/browse/SCRUM-161) · Owner: **Jerome**.
Branch: `feature/SCRUM-161-meaningful-test-coverage`, based on main `3acb2b5`.
The user expanded permission/failure testing to backend coverage, combined frontend
coverage, Release 1 journey evidence, and finally 100% across the combined frontend.
The owner authorised push and merge on 1 November 2026. These are pre-publication
verification results; the PR and Jira record hosted CI and final merge status.

## Current measured results — 1 November 2026

| Scope | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Backend application | **100%** (3,943/3,943) | **100%** (1,452/1,452) | Not reported by coverage.py | **100%** |
| Frontend, combined unit + controlled browser | **100%** (2,868/2,868) | **100%** (2,896/2,896) | **100%** (918/918) | **100%** (2,326/2,326) |
| Frontend, same-counter units only | 91.98% | 87.94% | 87.14% | 93.89% |
| Frontend, same-counter browsers only | 83.05% | 76.41% | 81.91% | 85.64% |

All **95 eligible frontend source files** remain included, with zero skipped counters.
Backend retains its six pre-existing excluded lines; none were added by this task.
The combined result is the union of identical Istanbul counters, not a sum or average
of percentages. Statements, branches, functions and lines must each have `covered === total`;
the new gate rejects even one uncovered counter, including percentages rounded to 100.

- **596 unit/component tests pass** in both ordinary V8 and combined Istanbul runs.
- **327 instrumented browser checks pass:** 326 application scenarios plus the collector
  probe that verifies counters survive full page reloads.
- Ordinary production build and **326 normal browser scenarios pass**.
- ESLint, TypeScript through the production build, four coverage-tool tests, seven
  evidence-tool tests, 26 requirement-map validations and whitespace checks pass.
- After incorporating main’s event end-time (#90) and venue-filter (#91) features, the isolated-database
  run passed **2,281 backend tests** with 100% coverage, no failures and no skips.
- All **11 real browser/API/database journeys** were rerun together against the merged
  schema and frontend and passed. These remain separate from the controlled browser
  suite and are also required in hosted CI.

The independent V8 unit-only report remains available: 95.90% statements/lines,
88.33% branches and 83.03% functions across frontend source. Its `src/lib` gate still
passes at 100% on all four measures. V8 and Istanbul count different source constructs;
use the same-counter rows above to explain the combined result. The earlier 5.78% V8
unit figure and 89.10% combined statement figure are historical baselines.

## Behaviour exercised

The latest increment and main synchronisation add **398 unit/component cases and three
browser scenarios** to the preceding 198-unit / 323-browser baseline. Existing test bodies and assertions
are preserved. Tests render real components with mocked I/O, exercise accessible user
actions and assert payloads, visible outcomes, cancellation and absence of writes.

- Event creation, drafts, editing, clarification/resubmission, approval, confirmation,
  cancellation, safety and completion: missing/invalid inputs, failed saves, duplicate
  actions, pending state and accurate feedback when a save succeeds but history fails.
- Organiser requests, Coordinator review, Lead assignment and long-list pagination:
  role loading, view-only records, missing historical fields, references and recovery.
- Venue catalogue, booking creation/decisions, custom requirements, opening hours,
  maintenance, retirement and calendar navigation: alternate inputs, Singapore date
  boundaries, errors, interrupted loads and stale advisory results.
- Equipment catalogue, requests, reservations and history: version conflicts, full-page
  reload, stock warnings, missing options, paginated options and concurrent refresh/save.
- Attendee registration, rosters and withdrawal: field errors, stalled saves, duplicate
  requests, focus/visibility refresh, empty later pages and historical record fallbacks.
- Development identity switching, login failures, menus, custom-value controls, Select
  and notifications: keyboard interactions, account separation and recovery.

The earlier integrated journeys use real password sessions, Flask, PostgREST and a
separate disposable PostgreSQL database. They cover signup/roster/withdrawal, role-denied
reads and forged status mutations, cancellation/resource release, safety-to-completion,
venue-block notification/replacement, Lead reassignment, significant-change re-review,
and clarification/resubmission/rejection. Real API setup is distinguished from actions
performed through the browser. No manual-test or hosted Supabase data was changed.

## Defects fixed and constrained refactors

1. Earlier backend tests reproduced boolean/fractional reservation quantities being
   coerced to one unit, and malformed timestamps reaching PostgREST before validation.
   Inputs now follow the existing integer/time-window rules before persistence (D50).
2. Earlier booking-edit tests found editable direct URLs for records the API rejects.
   The UI now mirrors the owned Requested-booking rule; backend policy is unchanged (D52).
3. New tests reproduced hidden custom requirements remaining in submissions after
   unchecking Other. Unchecking now clears the associated custom value.
4. Two activations before React committed its busy state sent two lifecycle requests.
   Eight existing actions now acquire an immediate in-flight ref, release it in `finally`,
   and retain their disabled/loading UI. Regression tests assert exactly one API write.
5. An unstructured venue-edit load failure could leave a permanent loading screen.
   It now shows a recovery message while retaining timeout and cancellation handling.

The full-coverage gate is recorded in **D53**, and compatibility with main’s new
end-time contract in **D54**. No new status
transition, permission policy, database migration or API contract is introduced here.

Small refactors retain existing behaviour: venue search reuses the already-tested
Singapore date helper; selecting an event prefills its end time (or clears the previous
value for older events without an end); preset layout canonicalisation relies on the existing
preset-only state invariant, with custom layouts kept separately. A mixed-case preset
plus custom-layout regression checks the serialized result. An unreachable repeated
checkbox condition is removed after the checked branch returns. These remove redundant
branches, not supported scenarios. The earlier backend search/suggestion simplifications
also preserve pagination and matching rules. No coverage ignore annotations or additional
source exclusions were added; the changed denominator reflects these refactors and fixes.

## Reproduce and present the evidence

From `frontend/`:

```sh
npm run test:coverage:combined
```

Set `PLAYWRIGHT_PORT` when the default port is occupied. The command cleans old raw data,
checks the collector/merger, runs all units, builds `.next-coverage`, runs every controlled
browser test, validates source hashes/maps and enforces the four 100% gates. It writes:

- `coverage-combined/combined/index.html`: presentation-friendly overall and per-file report.
- `coverage-combined/comparison.json`: exact totals, separate contributions and source count.
- `coverage-combined/{unit,browser,combined}/`: HTML, JSON summaries and LCOV.
- `coverage/`: separate ordinary V8 evidence from `npm run test:coverage`.
- `api/test-results/coverage-html/index.html`: earlier backend report.

CI regenerates and uploads evidence. Generated reports and temporary logs are not committed.
Normal production bundles contain no coverage instrumentation. The combined report does
not collect Next server execution or the real-database browser lane; server-only source
is included and executed directly by unit tests where applicable. Code coverage shows
which measured paths ran, not every possible input or all combinations of conditions.

For presentation: “Backend measured statement/branch coverage is 100%; combined frontend
unit-and-browser coverage is 100% across all four measures. Behavioural acceptance and
deployment verification are tracked separately.”

## Release acceptance still requires separate work

These previously recorded gaps are not closed by source coverage:

- **Jessica / Ernest:** SCRUM-137 buffered-exclusion migration syntax/harness inclusion
  and database protection against concurrent buffered bookings. The separately owned
  migration correction, replay and competing-write evidence remain necessary.
- **Jessica:** persisted automatic hold expiry and notifications, W7-04 / SCRUM-79.
- **Marcus with story owners:** clarify/accept the clarification source conflict,
  own/view-all Coordinator visibility, advisory suitability versus capacity, and
  Coordinator-attested re-review versus independently enforced re-approvals.
- **Registration owners / Marcus:** registration-period editing (SCRUM-42), deferred
  waitlist/promotion (SCRUM-80), reminders (SCRUM-50), and Preparation closing registration.
- **Event timing owner:** main #90 leaves duration-preserving reschedule as follow-up;
  moving a start through a change request does not currently move the end with it.
- **Release owner:** final HTTPS/session-expiry/deployment checks, full recipient matrix,
  clean-clone freeze smoke run, hosted CI and independent human review.

`docs/testing/requirements.json` retains these gaps. A mapped test pass is execution
evidence; it does not accept an entire requirement. Earlier SQL harness success does
not prove the omitted buffered-exclusion migration. No new release acceptance is claimed.

## Five reviewer questions

1. **Delegated:** preserve existing tests, close permission/failure evidence gaps,
   reach full backend/shared-logic and combined frontend coverage, fix exposed defects,
   and report remaining Release 1 work honestly.
2. **Constraints:** Jira criteria; root/backend/frontend AGENTS; existing API and domain
   rules; disposable database; full-source denominator; intent-based assertions; no
   weakened tests, fabricated business acceptance or unauthorised push/merge.
3. **Evidence:** exact counters and executed suite totals above, regressions that failed
   before the fixes, production build/lint, preserved existing browser suite, collector
   validation and a gate that detects a single missing counter.
4. **Human review:** Jerome reviews test intent, custom-field clearing, in-flight guards,
   unreachable-branch reasoning and gate cost. Ernest/Marcus review booking alignment
   and preset assumptions. D50's input contract still requires domain review. Hosted CI
   must pass; local results do not replace review or the real integrated lane.
5. **Accountable:** Jerome owns SCRUM-161 and the implementation. Named feature/release
   owners retain their policy and acceptance decisions. The user authorised push and merge; mark Jira Done only after verified merge.

## Main synchronisation and test compatibility

Before publication, main advanced to `853c7bd` (#90), introducing required event end
times and separate date/start/end controls. The SQL harness conflict was resolved by
retaining both migration replays and the isolated cleanup grant. Existing UI tests
now target those controls; integrated event fixtures supply the newly required end.
No assertions, scenarios or test names were removed. This is a reviewed contract
adaptation, not a relaxation to make failures pass. New cases cover ordering, missing
and invalid/naive times, field-error recovery, end-time prefill and saved-reservation
precedence. Main’s feature is preserved, including its documented reschedule limitation.

The first ordinary-browser attempt used the integration API origin (5011), while its
controlled fixtures target 5001. That run was stopped; the normal build and suite were
rerun with the correct origin. Its failures are not counted as passing evidence.

Main then advanced to `0f7aa45` (#91 / SCRUM-162). The merge preserves multi-layout
filters, preset/custom separation and canonical suggestions. The existing custom-layout
test now operates the new checkbox group rather than the removed select; its assertions
remain intact. Additional cases check combined/removable layouts and invalid query values.
The unchanged suggestion-normalisation function is lifted to module scope so ordered
inputs can verify preferred spelling in both orders without relying on set iteration.
All measured results above include both main features.

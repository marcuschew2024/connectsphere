# SCRUM-161 — Permission and failure-path verification

[Jira](https://spm-g6t4.atlassian.net/browse/SCRUM-161) · Owner: Jerome.
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
inclusions/exclusions and thresholds are unchanged.

Frontend **whole-source** unit coverage includes pages that are tested with Playwright;
it is not combined browser coverage. Report `src/lib` separately without hiding those
pages from the coverage denominator. `equipment-requests.ts` mostly declares types:
adding artificial tests for type declarations would not establish user behaviour.

Remaining work is explicit: broader venue-blocking database proof, booking-edit browser
journeys, remaining frontend hook/formatting boundaries, and other owners' release scope
are not declared complete here. Waiting-list creation/promotion remains deferred under
SCRUM-80. The final freeze smoke run and shared deployment verification remain separate.

## Reviewer questions

1. **Delegated:** close Jerome's missing permission evidence and meaningful registration/
   equipment failure coverage; fix defects the tests expose.
2. **Constrained:** Jira acceptance criteria, root/backend/frontend AGENTS, existing
   repository/value-object separation, real isolated database, no weakened existing tests.
3. **Evidence:** executed counts and coverage below; red-before-green quantity and real
   database date regressions; full frontend build/lint/browser checks and mapping validation.
4. **Human review:** D50's strict JSON integer contract, unchanged interval semantics,
   all three browser roles, and the distinction between attendee projection and permitted
   staff reads. Hosted CI is still required before merge.
5. **Accountable:** Jerome owns the implementation; relevant story owners review domain
   behaviour. Local verification is not independent human acceptance or release sign-off.

## Executed results — 1 November 2026

- Backend: **2,203 passed**, no failures or skips (baseline: 2,153).
- Frontend units: **131 passed** (baseline: 94).
- Controlled browser suite: **320 passed**, including four new permission/forbidden cases.
- Additional real browser/API/database journey: **1 passed**, exercising all three roles.
- Production build, full ESLint, Ruff, whitespace checks, 26 requirement mappings and
  seven evidence-tool tests passed. No hosted CI or merge is claimed for this branch.

| Scope | Statements: before → after | Branches: before → after |
|---|---:|---:|
| Backend app | 97.34% → 97.75% | 96.31% → 96.74% |
| Equipment routes | 88.37% → 100.00% | 85.29% → 100.00% |
| Equipment availability rules | 100.00% → 100.00% | 100.00% → 100.00% |
| Registration repository | 99.14% → 100.00% | 97.22% → 100.00% |
| Frontend `src/lib` unit coverage | 69.05% → 87.58% | 95.88% → 96.31% |
| Frontend whole-source unit coverage | 3.99% → 5.07% | 86.29% → 87.37% |

The full application is not at 100%, and these figures do not certify every Release 1
acceptance criterion. The two targeted persistence/route modules now have complete
statement and branch coverage; the remaining uncovered paths remain visible.

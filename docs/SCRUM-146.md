# SCRUM-146 Release testing and traceability

[Jira task](https://spm-g6t4.atlassian.net/browse/SCRUM-146). Accountable release
owner: Marcus. Combined branch: `fix/testing-and-coverage`, named at the user's
request. On 31 October 2026 the user explicitly authorised pushing and merging the
combined testing work and notification-fixture fix behind green CI.

The testing improvements are implemented and locally verified against main
`8445c7b`. The [executed checklist](testing/release-verification/requirements.md)
contains all 20 core requirements and six mandatory Week 7 changes. All 26 have
passing mapped checks; 17 retain implementation, deeper-testing or policy gaps.
A passing mapped check does not automatically accept an entire requirement.

## Changes

- Reviewed mappings identify requirement intent, accountable owner, Jira stories,
  exact executable tests, SQL assertion files and open gaps. The report generator
  joins those mappings to actual JUnit cases. Missing, failed and skipped results
  remain explicit; an empty requirement never becomes covered.
- Backend CI measures statements and branches separately and retains coverage
  JSON/XML/HTML plus JUnit. Frontend V8 covers all src TS/TSX, including unimported
  UI; only tests and declaration files are excluded. Existing backend thresholds
  and code exclusions remain unchanged.
- A separate real-browser lane uses production password sessions and disposable
  PostgreSQL/PostgREST. One event traverses draft submission, Lead assignment,
  approval, two venue bookings, equipment reservation, blocked/successful confirmation,
  registration/withdrawal and safety approval to Preparation. Resource setup uses
  actual HTTP requests sharing browser cookies; it does not establish every resource
  form's UI coverage. A second journey verifies conflict and cross-owner refusals.
- Nineteen new backend regressions cover registered-attendee lifecycle denial,
  unchanged private data/history, stored login lock/reset/logout/audit, and assignment
  RPC outages/refusals/missing acknowledgements. The attendee mutation guard follows
  the private-draft access check to preserve the existing 404 contract. Decision D37
  records the authorization proposal; SCRUM-135's complete transition matrix remains open.
- CI assembles the checklist from actual upstream artifacts. Each test job remains
  its own gate; producing a report cannot override a failing upstream job.

## Notification fixture isolation

The original notification-cap test passed once on a fresh disposable database,
then failed on its next invocation because the retained 2099 notifications produced
repeated `Update 54` entries. It now obtains its event from a yielding fixture that
removes only that event in `finally`; the existing foreign key cascades deletion to
its notifications, including when submission or an assertion fails.

This existing-test modification is reviewable: the function name, HTTP status
assertion and exact newest-first/50-item assertion are unchanged. AST comparison
verified assertion equality. No fixture grants or schema changes were needed.
Two fixed invocations and forced assertion/setup-failure probes restored the
pre-run event/notification snapshots and preserved an unrelated sentinel record.
The injected failures are successful teardown checks, not release-suite failures.
See [isolation evidence](testing/notification-isolation-2026-10-31.json).

## Verification on 31 October 2026

The source baseline and verification-source SHA256 are recorded in the saved
checklist. [Execution metadata](testing/release-verification/execution.json) hashes
its raw evidence. This run includes the latest venue, cancellation, login and
change-request changes from main rather than retaining the previous audit's claims
that those workflows were absent.

| Check | Result | Scope |
| --- | --- | --- |
| Backend suite | 1,843 passed; no failures/skips | Disposable DB; includes 19 new regression cases |
| Backend statements | 96.35%, 3,560 / 3,695 | 135 uncovered executable lines; five pre-existing exclusions |
| Backend branches | 93.30%, 1,282 / 1,374 | 92 uncovered branch destinations |
| Frontend unit suite | 67 passed | 2.74% all-src line/statements, 193 / 7,031 |
| Frontend unit branches | 81.87%, 140 / 171 | Does not establish branches in unexecuted UI |
| Controlled browser suite | 254 passed | Production Next.js with prepared HTTP responses |
| Integrated journeys | 2 passed | Actual password sessions, Flask and disposable DB |
| Evidence-tool and adapter tests | 7 passed | Errors/skips/absent evidence and DB URL allowlist |
| SQL harness | Passed | Clean bootstrap, migration replay twice and SQL assertions |
| Static checks | Ruff, ESLint, TypeScript/build, whitespace passed | Original ordering/cap assertions preserved |
| Local production build | Webpack passed | Hosted default production build remains a merge gate |

Local runtime is Python 3.14.6/Node 24.11.0; hosted CI declares Python 3.12/Node 22.
The first hosted run passed its test jobs but exposed Playwright clearing the unit
JUnit file. Browser output now uses `test-results/browser` so unit and browser evidence
survive together; the final hosted run verifies both. Raw JUnit, backend coverage JSON,
frontend coverage summary and SQL output are saved in
[`testing/release-verification/evidence`](testing/release-verification/evidence).
The [reproduction guide](testing/README.md) explains each layer and its limits.

## Remaining acceptance gaps

- A complete approved generic status/role matrix remains SCRUM-135 work. Dedicated
  cancellation now atomically releases resources and notifies attendees; it is tested.
- Venue unavailability is implemented with block periods, affected-booking notices
  and a replacement link. Real-database block/notification/replacement journeys and
  competing-write/rollback evidence remain to be established.
- Hold expiry still needs persisted automatic release/notification evidence; setup
  buffers need consistent search/calendar/database enforcement under concurrency.
- Approved proposed fields now apply atomically and flag affected arrangements.
  Structured re-approval and date/time rescheduling remain SCRUM-47/48 scope.
- Registration roster visibility, waitlist-case reconciliation, signup-window policy,
  complete notification trigger/recipient coverage, untested UI and section-specific
  clarification/suitability decisions remain in the checklist.
- Human acceptance, deployment-specific transport/session evidence and authentic
  Scrum/submission deliverables remain separate release responsibilities.

## Five reviewer questions

- **Delegated:** combined requirement traceability, meaningful missing regressions,
  coverage reports, real integrated journeys and notification-fixture cleanup.
- **Constrained:** Week 4 brief, mandatory Week 7 changes, current main decisions,
  repository rules, disposable DB and unchanged acceptance assertions/thresholds.
- **Evidence:** the saved results, source references, raw reports and reproduction
  guide. Local green checks do not claim a hosted CI result or human acceptance.
- **Human review:** Marcus reviews the access guard, test intent, denominators,
  CI requirements and acceptance gaps. Jerome should review the notification fixture;
  individual story owners accept their mapped business rules. Independent teammate
  review is not claimed by this document.
- **Accountability:** Marcus owns release scope/merge; Jira story owners own their rules.
  Codex authored this proposal and tooling. The user authorised the combined push and
  merge after green CI. Jira changes to Done only after that merge is confirmed.

# SCRUM-171 — safety approval revalidation and CI repair

Scope: PR #110 rechecks current venue/equipment arrangements before safety approval.
An invalid confirmation gate returns the event to Planning with a 409 response and
an attributed history entry; other bookings remain unchanged. Jira SCRUM-171 is the
scope authority. This document does not claim merge or human approval.

## CI diagnosis

- Run `41612844693`: the safety acceptance fixture omitted
  `equipment_request_repository` from its disposable database wiring, producing 503.
- Its new venue booking was never cleaned up. The remaining foreign key caused 21
  later venue fixture errors and an extra catalogue result. Missing coverage was a
  consequence of those tests not running, not a reason to lower the 100% gate.
- Push run `41612840370`: INTEGRATED-09 read the old coordinator's event before the
  reassignment POST completed. `toContainText("Coordinator B")` also matched the
  dropdown option already on screen. The trace shows the GET at 09:42:27.768Z while
  the POST, started at 09:42:27.685Z, took 107 ms.

## Repair and review

The fixture now connects the missing repository and owns teardown of only its created
venues/bookings, in foreign-key order, even when an assertion fails. The browser test
additionally waits for the saved assignment label using the target account's current
display name before checking revoked access. All previous assertions remain. New real-database cases check a venue
cancelled after opening review, both with and without another valid venue.

These existing test setup/synchronization changes require review under AGENTS.md; they
do not weaken authorization, alter application behavior, or change coverage thresholds.
Marcus Chew, the PR author, is the proposed accountable reviewer for this repair and
the underlying safety decision; Jira currently has no assignee. Human acceptance remains
pending. See the SCRUM-171 entry in DECISION_LOG.md.

## Verification

Local verification on 3 November 2026 (Python 3.14.6 / Node 24.11.0; CI uses
Python 3.12 / Node 22):

- Disposable Postgres/PostgREST SQL contract harness: passed. Integrated journeys use
  a separate fresh database, as they do in CI.
- Safety/venue acceptance sequence: **44 passed**, including cleanup before later tests.
- Full API suite with `--cov=app --cov-branch`: **2,474 passed**, 100% statement/branch coverage.
- `ruff check api scripts/qa`, traceability validation (26 mappings), and 8 tooling tests: passed.
- Frontend lint and production build: passed.
- `npm run test:coverage`: **676 passed**, shared-library coverage 100%.
- Standard browser suite: **342 passed**.
- `npm run test:coverage:combined`: **343 browser tests passed**, combined statement,
  branch, function, and line coverage all 100%.
- Real browser/API/database suite: **17 passed**. The repaired INTEGRATED-09 then
  passed **five additional repetitions**, retaining both UI denial and direct API
  authorization assertions.

GitHub CI must run again after the owner authorizes pushing the repair. These local
results do not claim a new green remote run or release acceptance.

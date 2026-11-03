# SCRUM-172 — maintenance conflict reporting and CI coverage

Scope: PR #111 reports maintenance overlaps caused by venue buffer changes and notifies
each affected current coordinator once. Jira SCRUM-172 supplies the acceptance criteria:
setup/turnaround overlap, exact touching boundaries, buffer reduction, and preservation
of bookings. This document does not claim merge or human approval.

## CI diagnosis and repair

Run `41614178328` passed every backend assertion but failed the unchanged 100% coverage
gate at 99.93%. The untested paths were maintenance entries without an event and entries
without a coordinator or whose coordinator was already notified (`venues.py:130,133`).
Frontend shared-library branch coverage was 99.66%: the plural branch of
`maintenanceConflictCountLabel` was not exercised (`venues.ts:69`).

The added route test requires an unchanged conflict report and exactly one notification
per distinct current coordinator. Missing/deleted/unassigned events must not prevent
other notices. The new frontend tests require accurate zero, singular, and plural
booking counts. Existing tests and thresholds are preserved; application code is unchanged.

## Review and accountability

Marcus Chew, the PR author, is the proposed accountable reviewer for the CI repair;
Jessica is the existing venue-behavior owner identified in the Decision Log. Jira has
no assignee. Review the notification cases and the original PR's reporting contract
before merge. See the SCRUM-172 Decision Log entry. Human acceptance remains pending.

## Verification

Local verification on 3 November 2026 (Python 3.14.6 / Node 24.11.0; CI uses
Python 3.12 / Node 22):

- Disposable Postgres/PostgREST SQL contract harness: passed.
- Full API suite with `--cov=app --cov-branch`: **2,474 passed**, 100% statement/branch coverage.
- `ruff check api scripts/qa`, traceability validation (26 mappings), and 8 tooling tests: passed.
- Frontend lint and production build: passed.
- `npm run test:coverage`: **679 passed**, shared-library coverage 100%.
- Standard browser suite: **342 passed**.
- `npm run test:coverage:combined`: **343 browser tests passed**, combined statement,
  branch, function, and line coverage all 100%.
- The original PR's integrated browser/API/database job was already green in run
  `41614178328`; this repair leaves application code and integrated journeys unchanged.

GitHub CI must run again after the owner authorizes pushing the repair. These local
results do not claim a new green remote run or release acceptance.

# SCRUM-45 — View event registrations

[Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-45) · Jerome · Sprint 4 · 3 points.

Implemented on `feature/SCRUM-45-event-registration-roster`. No schema migration is
required. The owner authorised push and merge on 1 November 2026 after manual verification.
Hosted CI must pass on the integrated branch before merge. The application uses the existing registration and readable-reference schema.

After manual verification, the user requested broader event-request UI improvements.
See [Event request usability follow-up](EVENT_REQUEST_UX.md) for that additional scope.

## User journey

1. Sign in as the event's Organiser, open **My requests → event → View registrations**.
   The currently assigned Coordinator can open the same link from the event page.
2. See the event title/reference/date, Registered against capacity, Waitlisted,
   Withdrawn, and remaining places. An unset capacity is shown explicitly.
3. The roster shows attendee name, REG reference, status, signup time and withdrawal
   time, in Singapore time. Registration references distinguish people with equal names.
4. Filter by status or navigate pages of 25. Totals always cover the entire event.
   Refresh manually, return to the tab, or leave it visible for 30 seconds to recheck.
5. Empty pages, errors, access denial and timeouts are distinct. Refresh hides stale
   private data. Cancelled events retain a clearly labelled historical roster.

## Acceptance and scope

| Requirement | Implementation and evidence |
| --- | --- |
| Organiser/Coordinator can see their event's registrations and counts | Event-scoped API and discoverable event-page link; real signup/withdrawal journey checks both roles; 27-row DB test verifies pagination and full-event totals. |
| Only authorised related users can read it | Signed identity, central role/event guards and exact owner/current assignment policy. Tests deny attendees, staff, Lead, foreign owners and former coordinators even when participant membership survives. Private drafts retain 404s. |
| Registered versus Waitlisted against capacity | Exact status counts independent of filters/pages, registered/capacity display and remaining places. Actual current Waitlisted count is zero; non-zero presentation is tested with a controlled browser response. |

**Waitlist dependency:** SCRUM-80 is deferred. The current database permits only
Registered and Withdrawn; full events reject signup. This story does not add waiting-list
signup or promotion, and does not claim a real non-zero waitlist journey was tested.
The UI explicitly says waiting-list signup is unavailable. Jerome/Marcus must accept
this scope reconciliation before treating the complete waitlist scenario as delivered.

The read contract and privacy decisions are recorded in **D49** in
[DECISION_LOG.md](DECISION_LOG.md). Roster data omits email, account IDs, passwords and
supplementary registration answers. No public attendee permissions or database grants
are expanded. Exact counts and rows use separate reads, so concurrent changes can
briefly differ until refresh; transactional signup remains authoritative for capacity.

## Verification — 31 October 2026

- **2,096 backend tests passed**, including 29 new policy/route tests and four new
  real-Postgres roster acceptance tests. Overall backend coverage: **97.62% statements,
  96.44% branches**. All new roster route/repository/policy statements were exercised.
- **283 controlled browser tests passed**, including 12 roster checks: both roles,
  filters/pagination, errors/retry, withdrawal/access loss, empty/unset capacity,
  synthetic waitlisted presentation, narrow-screen rendering, and excluded staff roles.
- **Four real browser/API/database integration journeys passed.** The existing
  seven-role lifecycle gains roster assertions after signup and after withdrawal;
  its existing checks remain. No existing test was removed, renamed or weakened.
- **73 frontend unit tests passed**; production webpack build, ESLint, Ruff, diff
  whitespace check, seven QA adapter/report tests and requirement-mapping validation pass.
- Backend acceptance ran against a separate disposable Postgres/PostgREST stack. The
  SQL harness passed; the only added SQL is local test-account seeding for pagination.
  Integrated tests used the existing local disposable database without clearing user data.
  No hosted Supabase database was modified. Local evidence: `/private/tmp/scrum45-evidence`.

## Manual checks

Open `http://localhost:3107`. Local sample accounts use
`disposable-test-only-password`:

- `organiser.a@connectsphere.test`: open an owned event and **View registrations**.
- `coordinator.a@connectsphere.test`: open an assigned event and the same roster.
- For a new signup, choose a **Confirmed** event with capacity and an open registration
  window. Sign in as `attendee.a@connectsphere.test` or `attendee.b@connectsphere.test`,
  register, then refresh the Organiser's roster. Withdraw and refresh again: Registered
  decreases, Withdrawn increases, and the same REG reference remains.
- An unconfirmed event such as the earlier `scrum 135 test` correctly shows an empty
  roster until it is confirmed and attendees sign up.
- Sign in as the other Organiser or an unassigned Coordinator and paste the roster URL:
  the API must refuse it. Reassign an event and refresh the former Coordinator's roster
  to confirm their access is removed.

## Reviewer questions

1. **Delegated:** implement SCRUM-45's private event roster, totals and browser journey.
2. **Constraints:** Jira acceptance criteria; root/backend/frontend AGENTS; existing
   session, role guards, repository pattern and design tokens; SCRUM-80 deferral.
3. **Evidence:** the executed tests and checks above, with requirement mappings updated.
   Historical release-verification snapshots were preserved rather than rewritten.
4. **Human review needed:** D49 API/access contract, privacy fields, current-assignment
   boundary, actual Organiser/Coordinator usability and explicit waitlist dependency.
5. **Accountable:** Jerome owns SCRUM-45; Marcus reviews product/access policy. No
   independent third-party review is claimed; hosted CI results are recorded on the pull request.

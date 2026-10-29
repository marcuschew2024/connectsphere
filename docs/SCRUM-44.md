# SCRUM-44 — View own registration status

[Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-44) · Jerome · Sprint 4 · 3 points.

Implemented for review on `feature/SCRUM-44-registration-status`, based on
`origin/main` at `8e0a8f0` after the owner's latest push. Work is isolated in
`/private/tmp/connectsphere-scrum44` so the original checkout's work is preserved.

## Walkthrough

1. Sign in as an Attendee. Home → **My registrations**, or sidebar → **Registrations**.
2. Each card shows the event, Singapore date/time, your registration status,
   registration reference and timestamps. Event status is labelled separately, so
   a Cancelled event is not mistaken for a Withdrawn registration.
3. **View event →** opens the existing receipt. **Refresh registration** checks its
   latest saved state; **My registrations** returns to the list.
4. The list refreshes when returning to the tab, every 30 seconds while visible,
   and with **Refresh registrations**. A failed refresh hides old rows and offers
   **Try again**. Empty and paginated states provide clear navigation.

Existing Home confirmation messages remain historical receipts. The new list reads
the registration table, so an old confirmation cannot overwrite a Withdrawn status.

## Acceptance and scope

- **AC1 — own status:** persisted Registered and Withdrawn states, plus event details,
  appear in the current-account list. Waitlisted has explicit presentation in the list
  and receipt, with no claim that the place is confirmed.
- **AC2 — latest state:** each request reads storage. No HTTP/browser fetch caching;
  refresh/focus/visible polling revalidate the list. A later Waitlisted → Registered
  API response replaces the previous display.
- **AC3 — privacy:** only Attendee accounts can call the endpoint. Server-side session
  identity scopes the database query before pagination; account selectors are rejected.
  Registration information, attendee identities and private planning fields are absent.

The current database permits Registered/Withdrawn, and Sprint 4 explicitly defers the
waiting-list feature to SCRUM-80. This story does not enable waiting-list signup or
promotion. That part of the display contract is fixture-tested; database integration
for waiting-list promotion belongs to SCRUM-80. This reconciliation of Jira's literal
three-state wording needs Jerome's acceptance; see D24 in the Decision Log.
Withdrawal commands and organiser-defined conditions remain SCRUM-43.

## API

`GET /events/registrations?page=1` requires the configured frontend Origin and a signed-in
Attendee. It returns `{"registrations": [...], "page": 1, "has_more": false}`.
Pages contain at most 25 rows, ordered by registration time descending then UUID ascending.
The sole optional query parameter is one ASCII page number from 1 to 10,000.

Each registration contains `id`, `event_id`, `status`, `registered_at`, `withdrawn_at`,
and `event` (`id`, `title`, `category`, `event_datetime`, `status`). A nullable event
is displayed without a broken link. Errors are 401 for guests, 403 for wrong roles or
Origin, 400 for invalid query parameters, and a safe 503 on storage failure. All responses
are `Cache-Control: no-store`.

No schema change, migration, shared Supabase write, or new status-transition rule is
needed. Deployment requires the existing SCRUM-40/41 schema. No new packages are added.

## Verification

Final local verification on 29 Oct 2026:

- Fresh disposable PostgreSQL/PostgREST full API suite: **1,236 passed**, no skips,
  **87.95% application coverage**. Includes 21 new HTTP/boundary tests and three new
  database acceptance tests for ownership, current persisted state and pagination.
- Existing SQL checks and migration replay: **passed**. No new migration is required.
- Full Playwright regression against the production build on port 3144:
  **202 passed**, including 11 new status/navigation/freshness/error/mobile scenarios.
  Desktop and mobile screenshots were visually inspected: no clipping or overflow.
- Frontend unit tests: **35 passed**, including two new defensive status-display tests.
- Backend Ruff, frontend ESLint and `git diff --check`: **passed**.
- Production webpack build and TypeScript: **passed** with
  `npm run build -- --webpack`. The initial sandboxed attempt could not resolve Google
  Fonts; rerunning with permitted network access passed. Default build/CI commands are
  unchanged; remote CI has not run because this branch has not been pushed.

The new tests encode identity isolation, fresh persisted state, complete pagination,
truthful failure states, waitlist display, and accessible navigation. Existing tests
are unchanged. Waiting-list database transitions are not counted as verified; SCRUM-80
owns those semantics and the current database cannot store Waitlisted.

## Reviewer questions and ownership

- **Delegated:** implement SCRUM-44's attendee status workflow, tests, and documentation.
- **Constraints:** Jira ACs and Sprint 4 scope; existing account/role/Origin checks,
  repository pattern, registration invariants, design tokens and root/area AGENTS rules.
- **Evidence:** HTTP tests, real disposable-database acceptance tests and Playwright
  flows, plus lint, unit tests, build and regression checks recorded above.
- **Human review:** Jerome must review the API projection/session boundary, freshness
  behaviour, attendee UX and the SCRUM-80 waiting-list scope reconciliation in D24.
- **Accountability:** Jerome owns the design and acceptance decision. Codex authors the
  proposal. Jira remains In Progress until review; Done follows an authorized merge
  behind green CI. On 30 October 2026, after the waiting-list limitation was disclosed, the user
  explicitly authorized pushing and merging behind green CI. No shared database
  deployment is included.

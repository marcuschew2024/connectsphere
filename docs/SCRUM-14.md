# SCRUM-14: create an event request

This implements the backend, frontend and test work for SCRUM-91, SCRUM-92 and
SCRUM-93. An acting Organiser can submit a complete request or save an incomplete
draft. The database stores who created it, its status and timestamps. There is
no admin role.

## Run it

1. Keep the existing development setup from [SCRUM-83](SCRUM-83.md).
2. In the **development Supabase SQL Editor**, run
   [`supabase/seed_users.sql`](../supabase/seed_users.sql) if user setup is not
   already done. Your existing five demo users can stay.
3. Run the whole of [`supabase/create_events.sql`](../supabase/create_events.sql).
   This is a separate event-table script, not another user seed. It creates no
   example events. It is safe to rerun on this schema and preserves stored data.
4. Start the backend and frontend in separate terminals:

```bash
# Terminal 1, from the repository root:
cd api
source .venv/bin/activate
python -m flask --app app run --port 5001
```

```bash
# Terminal 2, from the repository root:
cd frontend
npm run dev
```

5. Open **http://localhost:3000/events/new** (also linked from the home page).
6. Choose **Demo Organiser** using the development switcher.
7. Fill in the six required details: event name, description, purpose, category,
   date/time and expected attendance. The four requirements boxes are optional.
8. Click **Submit request**. A successful response shows the saved reference and
   confirmation. Use **Save as draft** to save with required details still blank.

The Create button is disabled for other roles, no selection, or while the
selection is being confirmed. On the event page, a compact role-specific message
replaces the form. Selecting Organiser reveals the form with a short transition;
reduced-motion preferences are respected. Unsaved input stays on this page while
switching roles, but the hidden form is disabled and excluded from keyboard and
screen-reader access. Flask still checks permissions on every request.

No new environment settings or dependencies are required. The browser uses the
shared API URL (default `http://localhost:5001`). If a teammate uses another API
port, they can set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` and restart
Next.js. `FRONTEND_ORIGIN` in `api/.env` must match their frontend URL.

The form can be built in production, but the current identity helper only
authenticates development demo sessions. Event writes therefore return 401
outside development until the real-login ticket connects authentication to
`require_acting_user()`. Existing development cookies do not bypass this rule.

## How the code works

```text
Event form -> POST /events -> check acting Organiser -> validate details
           -> insert into Supabase -> return saved row -> show confirmation
```

| File | Responsibility |
| --- | --- |
| `frontend/src/app/events/new/page.tsx` | Event page with the existing development switcher. |
| `frontend/src/app/events/new/event-request-form.tsx` | Inputs, save/submit buttons, field errors and confirmation. |
| `frontend/src/lib/api.ts` | Existing cookie-aware API helper, extended to carry field errors. |
| `frontend/src/lib/events.ts` | Shared TypeScript event type for teammates' future screens. |
| `frontend/src/lib/use-acting-role.ts` | Reads the current role and updates it when the switcher confirms a selection. |
| `api/app/events.py` | Checks origin and role, validates the request and supplies ownership/status. |
| `api/app/event_validation.py` | Plain validation and text trimming, reusable for later draft editing. |
| `api/app/event_repository.py` | One Supabase insert query returning the stored row. |
| `supabase/create_events.sql` | Table, constraints, indexes, permissions and updated-time trigger. |

Flask gets `organiser_id` from `require_acting_user()`. The browser cannot choose
another owner, assign a Coordinator, set a record ID or change timestamps/status.
It sends only event details and an action (`draft` or `submit`).

Drafts can have missing details, but values supplied must still be valid. For
example, blank attendance is allowed in a draft; negative attendance is not.
Submitting requires all six core details. Attendance must be a positive integer
within PostgreSQL's integer range. Dates need an explicit time zone and cannot
be in the past. A later time today is accepted. The form converts the device's
local date/time to UTC before sending it; PostgreSQL stores a `timestamptz`.

`created_at` and `updated_at` come from PostgreSQL. Flask sets `submitted_at` on
submission; it stays null for drafts. A trigger keeps `updated_at` current when
future features edit a row. This is a timestamped request record; a separate
append-only audit history belongs to the submission/audit work in SCRUM-16.

The insert follows the existing Supabase client convention and returns the saved
row, including database defaults ([Supabase Python insert documentation](https://supabase.com/docs/reference/python/insert)).
The UI confirms success only after that response. While saving, controls are
disabled. Failed requests keep the entered details. An ambiguous database/network
failure asks the user to check before retrying, because this endpoint does not
provide automatic retry deduplication.

## Contract for teammates

The database table is **`public.events`**, with the shared model's names:
`title`, `description`, `category`, `event_datetime`, `expected_attendance`,
`status`, `organiser_id`, `coordinator_id`, `created_at` and `updated_at`.

Differences/additions to the older draft Confluence model are intentional:

- Event IDs remain UUIDs. User references are **integers referencing
  `public.app_users(id)`**, matching the implemented SCRUM-83 schema.
- `purpose` and the four `*_requirements` text columns cover SCRUM-14's full
  description. Requirements are free text; structured venue/equipment bookings
  can be added by their own features.
- Required fields are nullable for drafts. A database constraint requires them
  when the status is no longer Draft. The agreed submission fields also include
  description, purpose and category.
- `submitted_at` records submission. The optional `coordinator_id` starts null
  for the assignment feature to fill later.
- The schema recognises Draft, Submitted, Planning, Confirmed, Completed,
  Rejected and Cancelled. **This endpoint can create only Draft or Submitted.**

Store **Submitted** in the database for a new submission. The Organiser sees it
under **Planning**. Assignment/review queries should include Submitted and
exclude Draft; do not change the stored status merely to match the display label.

The backend secret uses the Supabase service role. Browser database roles have
no table access. Flask must enforce role and ownership checks on each future
endpoint. Future draft reads/edits must filter by `organiser_id` and check the
record's status. Future assignment must verify that the assigned user is a
Coordinator. A foreign key alone does not check someone's role.

The event routes call the shared identity helper. Real login can replace its
implementation without making every event endpoint understand Supabase Auth.
`GET /session` exposes that same identity to the UI (or null when none is
authenticated). It is read-only, does not enable passwordless login, and does not
cache its response. Real authentication can reuse this endpoint too.

Before another teammate modifies the schema, start from this checked-in SQL.
`CREATE TABLE IF NOT EXISTS` supports reruns; it does not migrate a separately
created table with different columns. That situation needs an explicit migration,
not dropping the existing table. No teammate's unpublished branch was available
to inspect; integration was checked against current main and the shared draft model.

### POST /events

Requires the session cookie, JSON body and `Origin` matching `FRONTEND_ORIGIN`.
Only an acting Organiser is accepted. A complete example:

```json
{
  "action": "submit",
  "title": "Campus workshop",
  "description": "A practical workshop for students.",
  "purpose": "Share useful skills",
  "category": "Workshop",
  "event_datetime": "2099-10-20T14:00:00+08:00",
  "expected_attendance": 50,
  "venue_requirements": "Room for 50 people",
  "accessibility_requirements": "Step-free access",
  "equipment_requirements": "Projector",
  "registration_requirements": "RSVP required"
}
```

For a partial draft: `{"action":"draft","title":"An idea for later"}`.
If action is omitted, it defaults to submit. Unsupported fields are rejected.

Success: **201**, `{"event": { ...stored row... }}`. Text is trimmed and empty
optional fields become null. Errors:

| Status | Meaning |
| --- | --- |
| 400 | Invalid JSON/action/fields; validation errors include a `fields` map. |
| 401 | No authenticated acting user. |
| 403 | Wrong role or origin. |
| 503 | Database unavailable/unconfigured or save not confirmed. |

Validation response example:

```json
{
  "error": "Please check the highlighted fields.",
  "fields": {"title": "This field is required to submit."}
}
```

This ticket provides initial creation, draft saving and submission confirmation.
SCRUM-15 adds listing/reopening/editing private drafts. SCRUM-16 adds submission
of existing drafts, email confirmation, audit history and edit-lock enforcement.
There are no GET/PATCH event endpoints or email sends in this change.

## Verification and manual checks

From `api`, with the virtual environment activated:

```bash
python -m pytest
ruff check .
```

From `frontend`:

```bash
npm run lint
npm run build
npm run test:e2e
```

The Playwright suite expects the production build. Stop any development server
on port 3000 before running it, so it does not reuse a development page for the
production-only checks. Install Chromium once with `npx playwright install chromium`
if needed. Browser API responses are mocked in these repeatable CI tests; backend
tests exercise real Flask endpoints with an isolated fake Supabase client.

The eight [SCRUM-14 acceptance tests](https://spm-g6t4.atlassian.net/wiki/spaces/CS/pages/459024)
map to these checks:

| Test | Check |
| --- | --- |
| TC-US3.1-01 | Complete request saves Submitted with owner/timestamps and shows confirmation. |
| TC-US3.1-02 | Each missing required field prevents submission and has an inline error. |
| TC-US3.1-03 | Incomplete draft saves as Draft without submission. |
| TC-US3.1-04 | Attendance 0 is rejected. |
| TC-US3.1-05 | Attendance 1 is accepted. |
| TC-US3.1-06 | Negative or nonnumeric attendance is rejected. |
| TC-US3.1-07 | A past date/time is rejected. |
| TC-US3.1-08 | A valid later time today is accepted. |

Also try another role or no selection: the form is hidden. Direct
API calls still return 403 for other roles and 401 with no selection. Test a
second Organiser session too (each created row has its own Organiser's ID).
Drafts are persisted now, but the
screen to reopen them will arrive in SCRUM-15.

After saving through the hosted development app, inspect the rows in Supabase:

```sql
select id, title, status, organiser_id, coordinator_id,
       event_datetime, expected_attendance, created_at, updated_at, submitted_at
from public.events
order by created_at desc;
```

If saving returns 503, check that both SQL scripts were run in the same project
as `SUPABASE_URL`, and that Flask uses the backend secret key. Check the events
table before resubmitting an ambiguous failure.

Verified locally on 20 September 2026:

- 123 backend tests passed, including all existing tests; Ruff passed.
- Frontend lint, TypeScript and the Webpack production build passed; all 16
  production Playwright tests passed.
- Development browser checks also covered switching through all five roles,
  clearing the selection, refresh, pending/failed switches and re-enabling the
  controls for an Organiser without losing entered details. These checks used
  mocked API responses and made no event writes.
- Role views use a compact selector and smoothly replace the form with a short
  message. Desktop/mobile checks verified that hidden content takes no space,
  stays out of keyboard access, preserves entered details, and respects reduced
  motion preferences.
- The default Turbopack build was blocked by this execution sandbox's worker-port
  restriction. Verification used `npm run build -- --webpack`; the project's
  normal build command and CI configuration were kept intact.
- The actual SQL ran repeatedly in isolated PostgreSQL (PGlite). It preserved
  events and users, accepted partial drafts and complete submissions, rejected
  invalid data/owners, enforced table grants/RLS, and updated timestamps on edits.
- A separate development browser check used the real Flask routes and Supabase
  Python SDK through a local test adapter into that PostgreSQL database. It
  verified persisted submissions and drafts, validation, cookies/CORS, UTC
  conversion, role denial and a 390px mobile layout without horizontal overflow.
- The hosted Supabase check was read-only: app_users exists; events was not yet
  present. The event SQL still needs to be run there before hosted persistence
  can be tested. No hosted records or Jira/Confluence pages were changed.

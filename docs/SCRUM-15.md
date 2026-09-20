# SCRUM-15: Save, reopen and finish a draft request

An Organiser can save an incomplete request, leave the page, reopen it later,
change the details, and submit it. Drafts belong only to their Organiser.
The event keeps the same ID throughout this flow.

Jira: [SCRUM-15](https://spm-g6t4.atlassian.net/browse/SCRUM-15), with backend
SCRUM-94, frontend SCRUM-95, and tests SCRUM-96.
[Acceptance cases](https://spm-g6t4.atlassian.net/wiki/spaces/CS/pages/459044).

## 1. Setup after pulling this branch

1. Keep your existing `api/.env`. Local events need `APP_ENV=development`,
   `DEV_ROLE_SWITCHER_ENABLED=true`, and the existing Supabase backend key.
2. Run the **whole updated** [`supabase/create_events.sql`](../supabase/create_events.sql)
   in your development Supabase SQL Editor. Run `seed_users.sql` first only if
   users have not been set up. Existing events, users, and history are preserved.
3. Refresh the API dependencies and restart Flask. From the repository root:

   ```bash
   cd api
   source .venv/bin/activate
   python -m pip install -r requirements.txt
   python -m flask --app app run --port 5001
   ```

4. In another terminal, from the repository root:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

5. Open `http://localhost:3000`, select **Demo Organiser**, and choose **My drafts**.

If Flask is already running on port 5001, restart that existing process rather
than starting a second copy. If your API uses another port, set
`NEXT_PUBLIC_API_URL` in `frontend/.env.local` to match, then restart Next.js.

No frontend dependencies or environment variables were added by SCRUM-15.
The bcrypt requirement is from the merged login feature.

## 2. Try the feature

1. Create a request with just a name, then choose **Save as draft**.
2. Open **My drafts**. Your request appears with a Draft label and last saved time.
3. Choose **Continue editing**. Your saved details fill the existing event form.
4. Change the name and choose **Save changes**. The form stays open and confirms
   the save. Reload the page to verify the change persisted.
5. Complete the required fields and choose **Submit request**. The confirmation
   shows the same reference. The request disappears from My drafts.
6. Revisit its old editing URL. It now offers **View event status**, with no form.

Saving is explicit: use **Save changes** before leaving. There is no autosave.
Missing draft fields are allowed; supplied values must still be valid. For
example, attendance cannot be negative, and a date that has passed must be
updated or cleared before saving. Submission requires all six core fields.

## 3. What happens when you click Save changes

1. **React reads the form.** It sends `PATCH /events/<existing-id>` with the
   details and `action: "draft"`. The frontend sends no owner ID or status.
2. **Flask checks permission.** It resolves the current session, checks the
   Organiser owns this record, and verifies the record is still a Draft.
3. **Flask validates the details.** Missing fields are allowed for a draft.
   An omitted PATCH field keeps its old value; `null` or blank text clears it.
4. **Supabase updates that row.** The `save_event_draft` SQL function checks the
   ID, owner, and Draft status again while updating. The existing database trigger
   refreshes `updated_at`. The event ID and `created_at` stay unchanged.
5. **React confirms the save.** The form remains open so the Organiser can continue.

Submitting uses the same route with `action: "submit"`. Flask applies complete
validation. SQL changes the status to Submitted, sets `submitted_at` and the
status-change actor/time, and inserts one Draft → Submitted history record.

The SQL function is one transaction: if history cannot be recorded, the event
update rolls back too. Its `status = 'Draft'` condition prevents a repeated
submission, or a save racing with submission, from modifying a submitted event.
Ordinary draft saves do not add fake status changes to the history.

## 4. Where the code lives

| File | Responsibility |
| --- | --- |
| [`api/app/events.py`](../api/app/events.py) | Routes, ownership checks, PATCH validation, response shape. |
| [`api/app/event_repository.py`](../api/app/event_repository.py) | Supabase queries and the one draft-save function call. |
| [`api/app/event_validation.py`](../api/app/event_validation.py) | Existing validation shared with SCRUM-14; unchanged. |
| [`supabase/create_events.sql`](../supabase/create_events.sql) | Existing tables plus backend UPDATE permission and `save_event_draft`. |
| [`frontend/src/app/events/drafts/page.tsx`](../frontend/src/app/events/drafts/page.tsx) | Private draft list, empty state and retry. |
| [`frontend/src/app/events/drafts/[eventId]/page.tsx`](../frontend/src/app/events/drafts/[eventId]/page.tsx) | Load a draft or show its submitted state. |
| [`frontend/src/app/events/drafts/draft-workspace.tsx`](../frontend/src/app/events/drafts/draft-workspace.tsx) | Shared page layout, role gate and clearing private content when users switch. |
| [`frontend/src/app/events/new/event-request-form.tsx`](../frontend/src/app/events/new/event-request-form.tsx) | One form for creating and editing; `initialEvent` supplies the saved values. |

The layout uses the existing dark colours, rounded surfaces and sky-blue actions.
It supports keyboard navigation, field errors, narrow screens and reduced motion.
Changing users unmounts draft content, cancels its reads and clears loaded values,
including when both users have the Organiser role.
The save confirmation appears beside the actions and clears when details change.

## 5. API contract and privacy

All event endpoints keep the existing session-cookie and frontend Origin checks.

| Request | Result |
| --- | --- |
| `POST /events`, `action: "draft"` | Existing SCRUM-14 creation; returns 201. |
| `GET /events?status=Draft` | Only the current Organiser's drafts, newest saved first. |
| `GET /events/<id>` | Existing read endpoint; drafts require their owning Organiser. |
| `PATCH /events/<id>` | Save existing draft (default action is `draft`) or submit it; returns 200. |
| `GET /events/<id>/history` | Existing history; the same draft privacy rule applies. |
| `PATCH /events/<id>/status` | Existing status workflow; rejects drafts so submission validation cannot be bypassed. |

Example update: `{"title":"Revised workshop name","action":"draft"}`.
Example submission after completing the saved fields: `{"action":"submit"}`.
The form sends all its fields; API callers may send only changed ones.

Responses use the existing `{ "event": ... }` or `{ "events": [...] }` wrapper.
GET responses add `request_status` with the actual stored state. The existing
`status` display field remains compatible with the teammate's Planning mapping:

```json
{ "status": "Planning", "request_status": "Draft" }
```

The draft UI uses `request_status`. Write responses from POST and draft PATCH
retain the actual saved `status`, such as Draft or Submitted.

- Draft reads by other users return 404, including direct history links.
- Draft listings reject other roles. The existing general event list also hides
  other people's drafts, even if they have coordinator or participant links.
- Only the owner may edit; membership alone never grants draft editing.
- Invalid fields return 400 with field messages. A submitted/racing edit returns
  409. A database failure returns a safe 503 message, never a false success.
- Responses are not cached. The backend SQL function is inaccessible to `anon`
  and `authenticated`; the service role calls it after Flask checks permissions.

## 6. Working with teammates' features

- **SCRUM-14:** the initial creation route remains available. Both flows use the
  same validation and form. The draft confirmation now links to the editor.
- **Status/history work:** its tables, status mapping, participant access for
  submitted events, and status page are reused. Draft privacy overrides membership.
  The status page now displays Draft and links to editing when appropriate.
  The SQL also explicitly grants backend UPDATE permission on participants,
  which the existing participant upsert requires even when inserting a new row.
- **SCRUM-16:** submission of an existing draft is already required by SCRUM-15
  and is implemented here. Build the remaining confirmation/email workflow on
  this transition; do not insert a second event or duplicate its history entry.
- **SCRUM-20/21:** the login documentation explicitly leaves identity integration
  to SCRUM-21. This feature continues to use `require_acting_user()`, so it works
  through the development switcher. Real login alone does not yet authorise event
  routes. No changes were made to login, password handling or production access.
- **Future review queue:** a queue UI does not exist in current main. Its query
  must include submitted requests and exclude stored Draft status. The current
  coordinator list and direct access paths already exclude private drafts.

There is no new drafts table, admin role, dependency or port convention.
Compatibility is checked against the pulled main branch; unpublished teammate
branches cannot be verified here.

## 7. Verification

Backend and existing regression tests:

```bash
cd api
source .venv/bin/activate
python -m pytest
python -m ruff check .
```

Frontend (stop your development frontend before testing on port 3000):

```bash
cd frontend
npm run lint
npm run build
npx playwright test --reporter=line
```

The browser tests mock API responses. Backend tests exercise real Flask sessions
with a fake Supabase client. [`supabase/tests/drafts.sql`](../supabase/tests/drafts.sql)
separately checks the actual PostgreSQL function, ownership conditions, edit lock,
repeat submission and rollback on a simulated history failure. Run it only in an
isolated test database with the user/event schema and Supabase roles installed.
Its test transaction rolls back all its fixtures.

| Acceptance case | Verification |
| --- | --- |
| TC-US3.2-01: partial draft | Existing creation tests allow missing required fields. |
| TC-US3.2-02: Organiser B privacy | List, direct read, history and edit checks with two Organisers. |
| TC-US3.2-03: no coordinator review access | Coordinator lists exclude drafts; direct reads fail even with assignment/membership. |
| TC-US3.2-04: reopen/edit/save | Browser preload/save/reload and backend repeated-save tests preserve one ID. |
| TC-US3.2-05: complete and submit | Validation, same reference, one history transition, removal from draft list, edit lock. |

To manually test Organiser A/B in development, optionally create a second demo
Organiser. This query uses the table's generated ID and avoids another copy on rerun:

```sql
insert into public.app_users (display_name, role, is_demo)
select 'Demo Organiser B', 'Organiser', true
where not exists (
    select 1 from public.app_users
    where display_name = 'Demo Organiser B' and role = 'Organiser' and is_demo = true
);
```

Reload the switcher, create a draft as Demo Organiser, copy its editing URL, then
switch to Demo Organiser B. A's draft must be absent from the list, and its direct
URL must show no private details. Switch back to A to continue it.

### Local verification record

- Backend: 171 tests passed, including the existing login and event-status tests.
- Frontend: 32 Playwright tests passed, covering existing creation and the new draft flow.
- Ruff, ESLint and TypeScript checks passed. The production Webpack build passed.
- The normal Turbopack build hit this execution environment's worker port-binding
  restriction (`Operation not permitted`). CI still uses the normal build and
  must confirm that check after the branch is pushed; its script was not changed.
- Actual SQL ran in isolated PostgreSQL (PGlite), including repeated schema runs,
  backend-role writes, atomic history rollback, permissions and duplicate guards.
- A separate browser walkthrough used real Flask sessions and the Supabase Python
  SDK against that disposable local PostgreSQL adapter. Creation, repeated saving,
  reloading, A/B privacy, coordinator gating, validation, submission, history and
  the edit lock passed. Desktop/mobile screenshots were inspected; no horizontal
  overflow or JavaScript errors were observed.

The SQL has **not** been applied to shared Supabase by this implementation. No
shared records, Jira issues or Confluence pages were changed. No commit or push
was performed. Local docs contain the evidence for the team to review.

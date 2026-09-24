# SCRUM-16 and SCRUM-17: submit a request and assign its Coordinator

## How to explain it

“A draft is private and can be edited. When the Organiser clicks Submit, the API
checks the required fields. The database changes that same draft to Submitted,
assigns one Coordinator, and records who submitted it and when. The confirmation
screen shows the reference and Planning status. The Coordinator sees the request
in their review queue. The Organiser cannot directly edit or submit it again.”

We use the first Coordinator by ID because the story does not require workload
balancing. No manual reassignment button or endpoint is added.

Scope updated on 2026-09-24: confirmation is shown in the app. Confirmation email,
SMTP settings and the local email inbox have been removed at the user's request.
TC-US3.3-05 now checks the on-screen confirmation and reference.

## Try it on localhost

Normal use needs the frontend, Flask and the configured Supabase project.
Docker is not needed for this walkthrough. The commands below use port 3001.

Keep the Supabase keys and session secret in `api/.env`, and set:

```dotenv
APP_ENV=development
DEV_ROLE_SWITCHER_ENABLED=true
FRONTEND_ORIGIN=http://localhost:3001
FLASK_RUN_PORT=5001
```

From the repository root, start Flask in one terminal:

```bash
cd api
source .venv/bin/activate
python -m flask --app app run --port 5001
```

From the repository root, start the frontend in a second terminal:

```bash
cd frontend
npm run dev -- --port 3001
```

Leave both terminals running and open **http://localhost:3001**.
Use the demo role switcher; event actions still use the Sprint 1 demo sessions.

| Step | What to do | What it means |
| --- | --- | --- |
| 1 | Select Demo Organiser, then Create an event request. | You are testing as the person requesting an event. |
| 2 | Enter an event name and choose Save as draft. | SCRUM-15: saves private unfinished work. Nothing goes to the Coordinator yet. |
| 3 | Choose Continue editing, change the name, Save changes, and refresh. | Your edits remain on the same draft. |
| 4 | Try Submit request with the other required fields empty. | Submission is blocked and missing fields are highlighted. |
| 5 | Complete description, purpose, category, a future date/time, and attendance greater than zero. Submit. | SCRUM-16: the same reference is confirmed on screen, status is Planning, and direct editing is locked. |
| 6 | Return home, switch to Demo Coordinator, and open Review event requests. | SCRUM-17: the request has been assigned automatically and appears in this Coordinator's queue. |

The database and Coordinator queue use Submitted during review. Organisers see
Planning. These describe the same request from different roles.
If another Coordinator has a lower user ID than Demo Coordinator, use that user's
queue: the current rule always chooses the Coordinator with the lowest ID.

## What was fixed

- **SCRUM-15 CI failure:** Ruff found unsorted imports in `api/app/events.py`.
  The backend tests were skipped; this was not a failed behavioural test.
  [Original failed run](https://github.com/marcuschew2024/connectsphere/actions/runs/35522639959).
- **Merge integration:** one PATCH route handles draft editing and Coordinator
  Planning edits. Draft privacy and clarification queue filtering are retained.
- **SCRUM-16:** submission confirms the reference on screen and explains the edit lock.
- **SCRUM-17:** assignment runs both when submitting an existing draft and when
  creating a submitted request. The Coordinator is also recorded as a participant.

## Where to look

| File | What it does |
| --- | --- |
| `api/app/events.py` | Checks permission and input, saves/submits, returns the event confirmation. |
| `api/app/event_repository.py` | Reads private drafts and calls the database save function. |
| `supabase/create_events.sql` | Saves the existing draft and its submission history together. |
| `supabase/auto_assign_coordinator.sql` | Chooses exactly one Coordinator during submission. |
| `frontend/src/app/events/new/event-request-form.tsx` | Shows the reference, Planning status and edit lock. |
| `api/tests/test_request_acceptance.py` | Runs acceptance cases using a real disposable database. |

## Database setup

On an existing development Supabase project, rerun the updated `create_events.sql`
and then `auto_assign_coordinator.sql`. Keep the other Sprint 1 migrations applied,
including `login_auth.sql`, `event_decision_notifications.sql` and
`request_clarification.sql`. Existing events and users are preserved.
A missing clarification migration causes both the draft list and Coordinator queue
to report “Could not load clarification requests.”

## Reproduce the automated acceptance checks

Docker is used only to provide an isolated database for these automated checks.
The following cleanup removes only this stack's disposable test database:

```bash
docker compose -p connectsphere-acceptance -f compose.acceptance.yml down -v
docker compose -p connectsphere-acceptance -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-acceptance -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh
cd api
source .venv/bin/activate
POSTGREST_TEST_URL=http://127.0.0.1:55433 TEST_EVIDENCE_DIR=test-results python -m pytest -v --junitxml=test-results/pytest.xml
ruff check .
```

The SQL script applies all migrations twice, checks draft rollback and assignment,
and seeds demo users without email addresses. API acceptance tests use real database
queries; ordinary unit tests use a fake database.

From `frontend`, run `npm run lint`, `npm run build`, and
`PLAYWRIGHT_PORT=3107 npm run test:e2e`. Browser tests check rendering and interactions
with controlled API responses; Python acceptance tests separately verify persistence.
CI uploads the JUnit report, submission confirmation JSON and browser report.

## Acceptance case mapping

| Case | What proves it |
| --- | --- |
| TC-US3.3-01 | Invalid draft stays Draft with no submission timestamp. |
| TC-US3.3-02 | Same reference becomes Submitted and enters its Coordinator's queue. |
| TC-US3.3-03 | Exactly one submission history row records Organiser and timestamp. |
| TC-US3.3-04 | Direct edit and repeat submit fail without changing the record. |
| TC-US3.3-05 | On-screen confirmation shows the reference, Planning status, saved time and edit lock. Draft and direct submission work without an Organiser email address. |
| TC-US4.1-01 | Exactly one Coordinator and assignment time, with one membership row. |
| TC-US4.1-02 | Assigned Coordinator sees the request; another Coordinator does not. |
| TC-US4.1-03 | Organiser sees Planning in submit, read and list responses. |
| TC-US4.1-04 | No reassignment route/control; client-supplied Coordinator is rejected. |
| TC-US4.1-05 | Several submissions each have exactly one Coordinator. |

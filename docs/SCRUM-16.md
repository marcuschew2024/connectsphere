# SCRUM-16 and SCRUM-17: submit a request and assign its Coordinator

## How to explain it

“A draft is private and can be edited. When the Organiser clicks Submit, the API
checks the required fields. The database changes that same draft to Submitted,
assigns one Coordinator, and records who submitted it and when. The Organiser sees
Planning and gets an email with the same reference. The Coordinator sees the request
in their review queue. The Organiser cannot directly edit or submit it again.”

We use the first Coordinator by ID because the story does not require workload
balancing. No manual reassignment button or endpoint is added.

## What was fixed

- **SCRUM-15 CI failure:** Ruff found unsorted imports in `api/app/events.py`.
  The backend tests were skipped; this was not a failed behavioural test.
  [Original failed run](https://github.com/marcuschew2024/connectsphere/actions/runs/35522639959).
- **Merge integration:** both draft editing and Coordinator editing registered the
  same PATCH URL. One route now directs draft actions to the draft helper and keeps
  the Coordinator's Planning edit flow working. Draft privacy and clarification
  queue filtering are both retained.
- **SCRUM-16:** submission now sends a plain-text email with the reference and
  timestamp. The confirmation screen explains that editing is locked.
- **SCRUM-17:** assignment now runs for an existing draft's status change as well
  as a newly created submitted request. The assigned Coordinator is also recorded
  as an event participant.
- **Customer status:** Organisers see Planning in create, submit, read and list
  responses. The database and Coordinator queue retain Submitted for review.

## Where to look

| File | What it does |
| --- | --- |
| `api/app/events.py` | Checks permission and input, saves/submits, returns confirmation. |
| `api/app/event_repository.py` | Reads private drafts and calls the database save function. |
| `supabase/create_events.sql` | Saves the existing draft and its submission history together. |
| `supabase/auto_assign_coordinator.sql` | Chooses exactly one Coordinator during submission. |
| `api/app/submission_email.py` | Sends the plain-text confirmation using SMTP. |
| `frontend/src/app/events/new/event-request-form.tsx` | Shows the reference, edit lock and email result. |
| `api/tests/test_request_acceptance.py` | Runs the documented cases using real local database and email services. |

## Local email inbox

The agreed demo uses **Mailpit**, which captures emails locally without delivering
them to real mailboxes. Start only the mail service from the repository root:

```bash
docker compose -p connectsphere-acceptance -f compose.acceptance.yml up -d mail
```

Set these in your existing `api/.env`, then restart Flask:

```dotenv
SMTP_HOST=127.0.0.1
SMTP_PORT=51025
SMTP_FROM=ConnectSphere <no-reply@connectsphere.test>
SMTP_STARTTLS=false
```

The Organiser needs an `email` in `app_users` (the column comes from `login_auth.sql`).
For a development demo, use an address such as `organiser@connectsphere.test`.
Open **http://localhost:58025** to see the captured confirmation.
SMTP settings stay on the backend. No frontend key or email service account is needed.

If SMTP is unavailable or the Organiser has no email, the request still succeeds.
The screen says the email could not be sent and keeps the reference. It does not
ask the Organiser to submit again. Automatic email retry is not implemented.

## Database setup after review/merge

On an existing development Supabase project, rerun the updated `create_events.sql`
and then `auto_assign_coordinator.sql`. Keep the other Sprint 1 migrations applied,
including `login_auth.sql`, `event_decision_notifications.sql` and
`request_clarification.sql`. Existing events and users are preserved.
This task's verification uses a disposable local database, not the shared project.

The event flow continues to use the agreed Sprint 1 demo role switcher. Connecting
real login sessions to event actions remains the documented separate auth task.

## Reproduce the complete acceptance checks

Use a fresh disposable stack. The following cleanup removes **only this stack's
test database and captured test emails**:

```bash
docker compose -p connectsphere-acceptance -f compose.acceptance.yml down -v
docker compose -p connectsphere-acceptance -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-acceptance -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh
cd api
POSTGREST_TEST_URL=http://127.0.0.1:55433 python -m pytest -v
ruff check .
```

Use the project's virtual environment for Python and Ruff. The SQL script applies
all migrations twice, checks draft rollback and assignment, and seeds only test
email addresses. The API acceptance tests use real database queries and SMTP;
ordinary unit tests keep their existing fake database.

From `frontend`, run `npm run lint`, `npm run build`, and `npm run test:e2e`.
Set `PLAYWRIGHT_PORT=3107` if your development server is already using port 3000.
Browser tests check rendering and interactions with controlled API responses;
the Python acceptance tests separately exercise real persistence and SMTP.

CI runs both sets and uploads API/browser test reports. Each Confluence acceptance
row links to its test and the matching CI run; these are automated results, not a
claim that a person manually tested the hosted deployment.

## Acceptance case mapping

| Case | What proves it |
| --- | --- |
| TC-US3.3-01 | Invalid draft stays Draft; no submission email. |
| TC-US3.3-02 | Same reference becomes Submitted and enters its Coordinator's queue. |
| TC-US3.3-03 | Exactly one submission history row records Organiser and timestamp. |
| TC-US3.3-04 | Direct edit and repeat submit fail without changing the record. |
| TC-US3.3-05 | Mailpit captures the correct recipient and reference for draft and direct submissions. |
| TC-US4.1-01 | Exactly one Coordinator and assignment time, with one membership row. |
| TC-US4.1-02 | Assigned Coordinator sees the request; another Coordinator does not. |
| TC-US4.1-03 | Organiser sees Planning in submit, read and list responses. |
| TC-US4.1-04 | No reassignment route/control; client-supplied Coordinator is rejected. |
| TC-US4.1-05 | Several submissions each have exactly one Coordinator. |

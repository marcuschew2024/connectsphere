# SCRUM-35 — Record an equipment request

An assigned Coordinator records multiple catalogue items, quantities and technical
notes for a Planning event. Tech Support sees the saved request in its queue with
status **Requested**, the event reference, requester and submission time.

## Explain it in one minute

“The Coordinator chooses an event and lists the equipment it needs. Our API checks
who is signed in and whether the quantities are valid. The database then checks
that the Coordinator owns that Planning event and saves the whole request. Tech
Support sees it in its request queue, including who submitted it and when.”

For example, one request can contain **2 microphones with spare batteries** and
**1 projector with HDMI**. The database stores one request header for the event,
then two item rows linked to that header. This avoids repeating the event, person
and submission time for every item.

```text
Coordinator form
    → Flask: check sign-in, role and input
    → Database: check event assignment/status; save header + all items together
    → Tech Support queue: read and display the saved request
```

This uses the existing equipment workspace, login checks and database connection.
Each part has one job; no new framework or class hierarchy is needed for this story.

## Setup and demo

1. Apply `supabase/create_equipment_requests.sql` after the existing event/user
   setup and `supabase/create_equipment.sql`. The migration is transactional and
   safe to rerun. Automated checks apply it only to disposable local PostgreSQL;
   shared Supabase deployment still needs the team's normal migration step.
2. Run the API on 5001 and the frontend with matching `FRONTEND_ORIGIN`. Sign in
   as a Coordinator, or use the development-only demo switcher.
3. Approve an assigned event into Planning and have Tech Support add catalogue stock.
4. From Home, open **Request equipment**. Choose the event, add two different
   items, enter quantities and optional technical notes, then submit.
5. Check the success reference and open **View requests**. Switch to Tech Support
   and open **Review equipment requests** from Home. Reload: both lines, notes,
   event, actor and timestamp remain visible. Dates display in Singapore time.
6. Try 0, -1 or 1.5 as a quantity. Submission must fail, preserve entries and
   focus an error summary with the invalid quantity identified.
7. Try another Coordinator's event through the API: denied. Other roles cannot
   submit. A cancelled event cannot receive new equipment requests.

### Shared demo handoff

Marcus applies the migration in the team's Supabase SQL Editor, following the
existing working agreement. Use the complete
[`create_equipment_requests.sql`](../supabase/create_equipment_requests.sql) file;
the `supabase/tests/` scripts are only for disposable test databases.

After running it, this read-only query should return three non-null names:

```sql
select
    to_regclass('public.equipment_requests') as request_table,
    to_regclass('public.equipment_request_items') as item_table,
    to_regprocedure('public.record_equipment_request(uuid,jsonb,integer)') as save_function;
```

That confirms the objects exist. Complete steps 2–7 above to check the actual
shared application; the existence check alone is not a passing demo. If the API
still reports a missing table/function, check that it points to the same Supabase
project and that the full migration completed successfully.

Record the commit, date, demonstrator, reviewer, actual outcome and evidence link
for TC-35-01/02/03 in the
[Sprint 3 execution record](https://spm-g6t4.atlassian.net/wiki/spaces/CS/pages/11141162).
Only check these off after the team performs them:

- [ ] A human reviewer can explain the request flow and has approved the PR.
- [ ] Shared migration completed and the two-item request survives a reload.
- [ ] Tech Support sees the correct event, notes, Requested status and actor/time.
- [ ] Invalid quantities and unauthorised requests fail without creating a request.
- [ ] Required CI is green and the approved PR is merged before Jira moves to Done.

## Simple code walkthrough

| File | Responsibility |
| --- | --- |
| `frontend/src/app/equipment/requests/new/page.tsx` | Load options, manage item rows, submit and preserve errors |
| `frontend/src/app/equipment/requests/page.tsx` | Paginated Coordinator/Tech Support queue |
| `api/app/equipment_requests.py` | Session/origin checks, allowed fields and quantity validation |
| `api/app/equipment_request_repository.py` | Scoped reads and one database write call |
| `supabase/create_equipment_requests.sql` | Request tables and atomic `record_equipment_request` function |

The form posts content only. Flask resolves identity from the signed real session
(or the explicitly enabled development session). The database verifies the actor's
role, current event assignment and Planning status, then inserts the header and
all item rows in one transaction. If any line fails, no partial request remains.
The event row is locked for shared access during this transaction so an assignment
or status update cannot slip between validation and persistence.

`requested_by` and `requested_at` are the immutable creation audit. Browser roles
have no direct table/RPC access. The backend can read these tables and call the
creation function, but cannot directly insert, update or delete their rows.
Test-only cleanup grants exist exclusively in the disposable test bootstrap.

### Read the code in this order

1. **Form `submit()`** builds `{ event_id, items }` from the user's entries. A failed
   submission keeps those entries so the user can correct them.
2. **Route `submit_request()`** gets the signed-in Coordinator, validates the input,
   and passes the cleaned content and trusted user ID to the repository.
3. **Repository `record_request()`** calls the database function and converts its
   errors into useful messages. The `rpc` call means “run this database function.”
4. **SQL `record_equipment_request()`** checks event ownership and Planning status,
   inserts the header, then loops through the items. An error rolls back the entire
   call, including any earlier item: there is no half-saved request.
5. **Queue `list_requests()`** reads saved requests. It filters a Coordinator's
   events before choosing a page; Tech Support can read the whole team queue.

### Questions Jerome should be able to answer

| Question | Plain-language answer |
| --- | --- |
| Why check permissions in the API when the page already hides the form? | Someone can call the API directly. The server must check access independently of the screen. |
| Why validate in both Python and SQL? | Python provides helpful field errors. SQL protects the stored data and saves the whole request together. |
| Why use `type(quantity) is int`? | Python otherwise treats `True` as an integer. A yes/no value is not a valid equipment quantity. |
| Why does SQL lock the event with `FOR SHARE`? | Its assignment and status must stay stable while the request is being saved. Reads and other shared locks can still proceed. |
| Where do the person and time come from? | The API gets the person from the signed session; the database generates the time. Neither is accepted from the form. |
| Does Requested mean equipment is reserved? | It records what the event needs. SCRUM-36 checks availability and SCRUM-37 makes reservations. |
| Does routing send a message? | The saved request appears in the shared Tech Support queue. This story does not send email. |
| What do the tests prove? | API tests check rules; real database tests check persistence and rollback; browser tests check the form and queue using controlled responses. The team still performs the shared demo. |

## API and data contract

All routes require the configured Origin and a signed session; responses use
`Cache-Control: no-store`. Real login takes precedence over a demo cookie.

| Route | Access / response |
| --- | --- |
| `GET /equipment/requests/events?page=1` | Coordinator's assigned Planning events; `{events, page, has_more}` |
| `POST /equipment/requests` | Assigned Coordinator; `201 {request}` with header/audit fields |
| `GET /equipment/requests?page=1` | Tech Support: all requests. Coordinator: current assigned events only. `{requests, page, has_more}` |

Lists return six rows per page, with authorization filtering before pagination.
The form loads all option pages so equipment beyond the first six remains selectable.
Queue rows embed `event`, `requester` and ordered `items`. The submission response
contains only the header; item details are read from the queue.

```json
{
  "event_id": "<event UUID>",
  "items": [
    {"equipment_id": "<catalogue UUID>", "quantity": 2, "technical_notes": "HDMI input"}
  ]
}
```

- One to 50 distinct catalogue entries per request; combine repeat entries in one row.
- Quantities: positive integers through PostgreSQL's integer maximum, 2147483647.
  Zero, negative, fractional, boolean, string, missing and overflowing values are rejected.
- Notes: trimmed text, optional content, maximum 2000 characters; use `""` for none.
- Event and equipment IDs must identify existing records. Unknown content fields,
  client-supplied routing/status/identity/timestamps and invalid query fields fail.
- Each line stores a snapshot of the catalogue type/location as submitted, plus
  the original `equipment_id`. Later catalogue edits do not rewrite request evidence.
- Every request starts with `status = Requested`, `routed_to = Tech Support`.
  The shared Tech Support queue is the routing destination; no email is sent.

Planning-only submission follows the existing venue-request workflow. Quantities
may exceed current stock and non-operational catalogue entries remain requestable:
the form captures demand for Tech Support to assess. It neither promises availability
nor changes stock. SCRUM-36 checks time-based availability; SCRUM-37 handles actual
reservations. They should use the existing equipment IDs and positive quantities.
SCRUM-38 will need a separate migration and audited API to extend the current
Requested-only status constraint; this story does not implement status changes.

A failed or uncertain submission retains the form and links to the queue so the
Coordinator can check for an existing request before retrying. The endpoint does
not deduplicate separately submitted requests for the same event.

## Acceptance evidence — 14 October 2026

Automated by Codex for Jerome; human code review and a shared-environment demo
remain pending. This record is not evidence of a human review or deployed migration.

| Confluence case | Actual coverage |
| --- | --- |
| TC-35-01 / AC1,3,4 | Real Flask/PostgREST/PostgreSQL saves two items with quantities 1 and 12, notes, event link, Requested/Tech Support routing, trusted actor/time; both permitted roles can read after save. Stock remains unchanged. Browser flow submits two lines and renders the queue after reload. |
| TC-35-02 / AC2 | API accepts 1 and integer maximum; rejects 0, -1, 1.5, boolean, string, null and overflow. Direct database calls also reject invalid second lines and roll back the whole request. |
| TC-35-03 / RBAC | Non-Coordinators and unrelated Coordinators cannot create requests. Coordinator reads exclude another Coordinator's events; signed-out/wrong-origin calls fail; real-login identity takes priority. SQL checks deny direct browser writes and bypassing the creation audit. |

Extra regression checks cover catalogue pagination in the form, request pagination
after access filtering, duplicate/missing items, non-Planning events, immutable
item snapshots, removal of one form row without losing another row's edits,
cancellation without a write, retrying option loads and retaining notes on failure.

Local results: **747 API tests** (including 52 SCRUM-35 tests: 41 isolated API/unit
and 11 real database tests), **129 browser tests** (12 SCRUM-35), **16 frontend unit
tests** passed. Ruff, ESLint, both migration passes and all SQL checks passed.
The production build passed with `npm run build -- --webpack`; the default local
Turbopack worker failed to bind its internal port (`Operation not permitted`).
CI uses the unchanged default build on Node 22/Python 3.12; local checks used
Node 24/Python 3.14. See the linked PR's CI result for that separate environment.

```sh
# Repository root, using only a new disposable test project:
docker compose -p connectsphere-scrum35 -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-scrum35 -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh
# api/:
POSTGREST_TEST_URL=http://127.0.0.1:55433 .venv/bin/pytest -q --cov=app
.venv/bin/ruff check app tests
# frontend/:
npm run build
npm run lint
npm run test:unit
PLAYWRIGHT_PORT=3035 npm run test:e2e
```

The browser suite uses controlled API responses; persistence is independently
verified by the real database tests. Its HTML report includes form and queue
screenshots at 1440px and 390px. CI publishes `browser-test-results` and
`api-test-results` artifacts. Do not mark the story Done until human review,
required CI and the team demonstration satisfy the Definition of Done.

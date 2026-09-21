# SCRUM-18: Approve or reject an event request

A Coordinator can approve or reject a submitted event request with a recorded decision
and reason so that the outcome is traceable.

## Acceptance criteria

- Rejecting without a reason is blocked.
- Approving changes the request to `Planning` and records the decision actor and timestamp.
- Rejecting with a reason changes the request to `Rejected`, stores the reason, and creates an organiser notification.
- An already-decided request cannot be silently decided again.
- The workflow has only Approve and Reject decisions; there is no pending decision state.

## 1. Apply the database migration

Supabase -> **SQL Editor** -> run
[`supabase/event_decision_notifications.sql`](../supabase/event_decision_notifications.sql)
after `create_events.sql` has been run.

The migration adds these decision fields to `public.events`:

| Column | Purpose |
| --- | --- |
| `decision_reason` | The Coordinator's rejection reason; NULL for approval. |
| `decision_by` | Application user ID of the Coordinator who decided. |
| `decision_at` | Time the decision was recorded. |

It also creates `public.notifications`:

| Column | Purpose |
| --- | --- |
| `recipient_id` | User who should receive the notification. |
| `event_id` | Related event request. |
| `notification_type` | Notification category, currently `event_rejected`. |
| `message` | Notification text. |
| `read_at` | Reserved for a future notification-reading UI. |
| `created_at` | Time the notification was created. |

The table is backend-only and grants access to `service_role` only. The migration is
safe to rerun because it uses `if not exists` clauses.

## 2. Backend — decision rules and endpoint

### Decision object — `api/app/event_decision.py`

`EventDecision` owns the business rules for a decision:

- only `approve` and `reject` are accepted;
- rejection requires a non-empty reason;
- approval maps to `Planning`;
- rejection maps to `Rejected`;
- rejection reasons are trimmed before storage.

Keeping these rules in a small class makes them independent from Flask and Supabase.

### Repository — `api/app/event_repository.py`

`record_event_decision()` updates the event with:

- the new status;
- decision reason;
- decision actor;
- decision timestamp;
- latest status actor and timestamp.

The update includes a `status = 'Submitted'` condition so an event cannot be decided
again through this workflow after its first decision.

`create_notification()` inserts a rejection notification for the organiser.

### API endpoint — `api/app/events.py`

```text
POST /events/<event_id>/decision
```

Headers:

```text
Origin: http://localhost:3000
Content-Type: application/json
```

Approve:

```json
{
  "decision": "approve"
}
```

Reject:

```json
{
  "decision": "reject",
  "reason": "The requested venue is unavailable."
}
```

The endpoint checks, in order:

1. The request origin.
2. The acting user is a Coordinator.
3. The Coordinator is related to the event.
4. The event is still `Submitted`.
5. The decision payload is valid.
6. The event decision, history row, and rejection notification are written.

Approval intentionally stores `Planning`, not `Approved`. `Approved` is the action,
while `Planning` is the next lifecycle state. The transition is:

```text
Submitted -> Planning
```

A rejection transition is:

```text
Submitted -> Rejected
```

## 3. Frontend — review and decision UI

The Coordinator home page includes a **Review event requests** button.

The review page is:

```text
http://localhost:3000/events/review
```

It calls `GET /events`, displays related requests that are still `Submitted`, and links
to the event detail page.

The decision form is:

```text
frontend/src/app/events/[eventId]/event-decision-form.tsx
```

It provides:

- an Approve button;
- a rejection reason field;
- a Reject button;
- client-side required-reason validation;
- success and error messages.

After approval, the event enters `Planning`. The existing Scrum 23 planning edit form
therefore becomes visible to the Coordinator. Its Cancel link returns to the review page
without sending a save request. Cancel does not cancel the event or undo the decision.

## 4. Tests — `api/tests/test_events.py`

| Test | Coverage |
| --- | --- |
| `test_coordinator_can_approve_submitted_request` | Approval moves the event to Planning and records actor/time. |
| `test_reject_without_reason_is_blocked` | Empty rejection reasons return 400. |
| `test_rejection_stores_reason_and_notifies_organiser` | Rejection stores the reason and creates a notification. |
| `test_decided_request_cannot_be_decided_again` | Already-decided requests return 409. |
| `test_non_coordinator_cannot_decide_request` | Non-coordinators receive 403. |

The existing pre-Scrum 18 API tests also continue to pass.

## 5. Verification

Run the API tests and lint:

```powershell
cd api
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
```

Run the frontend checks:

```powershell
cd frontend
npm run lint
npm run build
```

Run the existing E2E tests after stopping any development server on port 3000:

```powershell
$env:CI="1"
npm run test:e2e
```

The current verification result is:

- API tests: 161 passed.
- Ruff: passed.
- Frontend lint: passed.
- Frontend build: passed.
- Playwright: 14 passed and 2 failed when an existing development server was reused.

The two E2E failures are production-mode checks for hiding the development role
switcher. They require a clean production-server run with `CI=1`; they are not Scrum 18
business-logic failures.

To verify an approval in Supabase:

```sql
select id, title, status, decision_by, decision_at, decision_reason
from public.events
where id = 'YOUR_EVENT_ID';
```

Expected status: `Planning`.

To verify a rejection notification:

```sql
select recipient_id, event_id, notification_type, message, created_at
from public.notifications
where event_id = 'YOUR_EVENT_ID';
```

Expected notification type: `event_rejected` and recipient ID equal to the event's
`organiser_id`.

## Known limitations

- Notifications are stored in Supabase, but no notification inbox or read/unread UI exists yet.
- Identity currently uses the development role switcher for the Sprint 1 demo rather than the real login session.
- The older generic `PATCH /events/<event_id>/status` route still exists and should eventually be narrowed so decision statuses cannot bypass the dedicated decision endpoint.
- The Coordinator review list currently shows only submitted requests; approved and rejected requests remain available through their event detail URLs and Supabase.

# SCRUM-19: view event status

A user related to an event can view its current status and status history. The API
stores internal workflow states but exposes only the five canonical visible values:
`Planning`, `Confirmed`, `Completed`, `Rejected` and `Cancelled`.

## Acceptance criteria

- The API returns exactly one canonical visible status.
- `Submitted`, `Assigned`, `Under review` and `Approved` are exposed as `Planning`.
- Related users can view the event and its status history.
- The latest status change records the acting user and timestamp.
- Every status change creates a new immutable history record.
- `Completed`, `Rejected` and `Cancelled` use distinct terminal-state badge styles.

## 1. Apply the database migration

Run the whole contents of [`supabase/create_events.sql`](../supabase/create_events.sql)
in the development Supabase SQL Editor after `seed_users.sql` has been run.

The event schema includes these latest-change fields:

| Column | Purpose |
| --- | --- |
| `last_status_changed_by` | Application user ID that made the latest status change. |
| `last_status_changed_at` | Time of the latest status change. |

The migration also creates two linked tables:

### `event_participants`

Stores durable event membership:

| Column | Purpose |
| --- | --- |
| `event_id` | References `public.events(id)`. |
| `user_id` | References `public.app_users(id)`. |
| `role` | The user's role for this event. |
| `joined_at` | When the membership was created. |

### `event_status_history`

Stores an append-only status timeline:

| Column | Purpose |
| --- | --- |
| `id` | Generated history-record ID. |
| `event_id` | References `public.events(id)`. |
| `old_status` | The previous internal status, or NULL for initial creation. |
| `new_status` | The new internal status. |
| `changed_by` | Application user ID responsible for the change. |
| `changed_at` | When the change occurred. |

The migration backfills organiser/coordinator memberships and creates an initial
history record for existing events. It is designed to be rerun without deleting
event data.

## 2. Start the development services

From the repository root, start Flask and Next.js in separate terminals:

```bash
# Terminal 1
cd api
source .venv/bin/activate
python -m flask --app app run --port 5001
```

```bash
# Terminal 2
cd frontend
npm run dev
```

On Windows PowerShell, use:

```powershell
cd api
.\.venv\Scripts\Activate.ps1
flask --app app run --port 5001
```

The frontend uses `http://localhost:5001` by default. Use `localhost` consistently
for both frontend and API so the browser sends the session cookie correctly.

## 3. API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/events/<event_id>` | Return one related event with its canonical visible status. |
| `PATCH` | `/events/<event_id>/status` | Change status and append a history record. |
| `GET` | `/events/<event_id>/history` | Return the event's status history for a related user. |

All event requests require:

- a valid development session cookie;
- `Origin: http://localhost:3000`;
- a user who is an organiser, coordinator, or stored participant.

The browser must never supply the acting user ID for authorization. Flask reads it
from the signed session and checks the database membership.

### Visible status mapping

| Stored status | API/UI status |
| --- | --- |
| `Draft` | `Planning` |
| `Submitted` | `Planning` |
| `Assigned` | `Planning` |
| `Under review` | `Planning` |
| `Approved` | `Planning` |
| `Planning` | `Planning` |
| `Confirmed` | `Confirmed` |
| `Completed` | `Completed` |
| `Rejected` | `Rejected` |
| `Cancelled` | `Cancelled` |

### Status update behavior

`PATCH /events/<event_id>/status` performs two operations:

1. Updates the current status and latest-change fields on `public.events`.
2. Inserts a new row into `event_status_history`.

Existing history rows are not edited. For example:

```text
NULL -> Submitted
Submitted -> Confirmed
Confirmed -> Completed
```

The event row stores only the current status; the history table stores the full
timeline.

## 4. Postman walkthrough

### Select a demo organiser

```http
POST http://localhost:5001/dev/session
```

Headers:

```text
Origin: http://localhost:3000
Content-Type: application/json
```

Body:

```json
{
  "user_id": 1
}
```

Keep the `connectsphere_session` cookie returned by this request in the same
Postman collection or request session.

### View one event

```http
GET http://localhost:5001/events/YOUR_EVENT_ID
```

Header:

```text
Origin: http://localhost:3000
```

A successful response contains the event and a visible status such as `Planning`.

### View history

```http
GET http://localhost:5001/events/YOUR_EVENT_ID/history
```

Expected shape:

```json
{
  "history": [
    {
      "id": 1,
      "event_id": "YOUR_EVENT_ID",
      "old_status": null,
      "new_status": "Submitted",
      "changed_by": 1,
      "changed_at": "2026-09-20T07:00:00+00:00"
    }
  ]
}
```

### Change status

```http
PATCH http://localhost:5001/events/YOUR_EVENT_ID/status
```

Headers:

```text
Origin: http://localhost:3000
Content-Type: application/json
```

Body:

```json
{
  "status": "Confirmed"
}
```

Call the history endpoint again. A new `Submitted -> Confirmed` record should be
present; the original record should remain unchanged.

### Check access control

Select another demo user with `POST /dev/session`, then request the same event:

- `200` means the user is related or a participant.
- `403` means the user is not involved in the event.
- `401` means no valid development session is present.
- `404` means the event ID does not exist.
- `503` usually means the database migration or configuration is incomplete.

## 5. Frontend

The individual event page is:

```text
http://localhost:3000/events/YOUR_EVENT_ID
```

It calls both event endpoints, displays the current status, latest actor/timestamp,
and renders the append-only status timeline. The status badge styles distinguish
Planning, Confirmed, Completed, Rejected and Cancelled.

The page displays one selected event and its status history.

## 6. How the code works

```text
GET event -> require signed acting user -> load event -> check membership
           -> map internal status -> return current event

PATCH status -> check membership -> update current event
             -> append status-history row -> return updated event

GET history -> check membership -> return append-only history ordered by time
```

| File | Responsibility |
| --- | --- |
| `api/app/events.py` | Routes, origin checks, authentication, membership authorization and status mapping. |
| `api/app/event_repository.py` | Supabase queries for events, participants and status history. |
| `api/tests/test_events.py` | Route, status mapping, access-control, update and history tests. |
| `supabase/create_events.sql` | Event columns, participant table, history table, indexes and grants. |
| `frontend/src/app/events/[eventId]/page.tsx` | Single-event status and history screen. |
| `frontend/src/lib/events.ts` | Shared event and history types plus status badge styling. |
| `frontend/src/lib/api.ts` | Cookie-aware API requests. |

## 7. Verification

From `api`:

```bash
python -m pytest
ruff check .
```

From `frontend`:

```bash
npm run lint
npm run build
```

The backend tests use an isolated fake Supabase client and do not modify the real
project. At the time of writing, the backend suite passes 135 tests and the
frontend lint and production build pass.

## Known limitations and future work

- The development role switcher is temporary; real authentication must eventually
  replace `require_acting_user()`.
- Participant memberships can be stored and checked, but there is not yet a
  dedicated API for coordinators to add or remove participants.
- The current UI shows application user IDs in the history timeline. A future
  response shape can include participant display names.

# SCRUM-130: Unassigned queue + Event Coordinator Lead assigns/reassigns

Week 7 Customer Change #5. It supersedes SCRUM-17's auto-assignment; SCRUM-17 stays
Done. It depends on SCRUM-131 (Event Coordinator Lead role), which is Done. Design
and trade-offs: Decision Log **D26**. Owner: Ernest Wong.

## Acceptance criteria → evidence

| AC | Behaviour | Tests |
| --- | --- | --- |
| 1 | A new submission enters the unassigned queue; it is not auto-assigned. | `coordinator_assignment.sql`, TC-130-01, `test_events.py` submission tests |
| 2 | The Lead sees the queue with basic event info: title, category, date, expected attendance, submitted time. | TC-130-01 (API + e2e) |
| 3 | The Lead assigns, and reassigns in any active state. Closed events can't be moved. | TC-130-02/03 (API + e2e), refusal tests |
| 4 | Coordinators manage only events assigned to them. A reassigned Coordinator loses access. | TC-130-04 (API), mutation-checked |
| 5 | The new Coordinator is notified "assigned"; on reassignment the previous one is notified "moved away". | TC-130-02/03 (API), e2e Coordinator notifications |

## What changed

| Area | Change |
| --- | --- |
| `supabase/migrations/20261030120000_scrum_130_unassigned_queue.sql` | Drops the auto-assign trigger and replaces the "every submission has a Coordinator" constraint. Keeps the assignment timestamping. Adds `assign_coordinator_by_lead()`, an atomic, row-locked, backend-only function. |
| `api/app/coordinator_assignment.py` | Value object for the payload and the assign/reassign rule. |
| `api/app/events.py` | `GET /events/coordinators` and `POST /events/<id>/coordinator`, both Lead-only. |
| `api/app/event_repository.py` | `list_coordinators()` and `assign_event_coordinator()`, with database refusals mapped to 400/403/404/409. |
| `api/app/notifications.py` | Coordinators may read their own notifications. |
| `frontend/src/app/events/supervised/page.tsx` | Unassigned queue with Assign; assigned events with Reassign. |
| `frontend/src/app/organiser-notifications.tsx`, `page.tsx` | The notifications panel on Coordinator Home. |
| `frontend/src/lib/assignment.ts` | Queue split, reassign rule and API calls. |

### API

`POST /events/<id>/coordinator` with body `{"coordinator_id": 7}`, Event Coordinator Lead only:

- **200:** `{"event": {...}, "outcome": "assigned" | "reassigned", "previous_coordinator_id": 2 | null}`
- **400:** bad payload, or the ID is not a Coordinator
- **401:** not signed in
- **403:** not the Lead, or an untrusted Origin
- **404:** unknown event or a draft
- **409:** the event is closed, or that Coordinator is already assigned

`GET /events/coordinators`, Lead only: `{"coordinators": [{"id": 2, "display_name": "..."}]}`

## Applying the migration (shared Supabase)

In the Supabase SQL Editor, run
`supabase/migrations/20261030120000_scrum_130_unassigned_queue.sql` once. It is safe to
rerun. It changes no existing event, so already auto-assigned events keep their
Coordinator. From then on, new submissions are unassigned until the Lead routes them.

## Manual test script

Use the SCRUM-139 password accounts on `/login`, all with the same seed password.
Run a production build (`npm run build && npm run start`) with the API on port 5001.

1. **AC1 (queue).** Sign in as `organiser.a@connectsphere.test` and submit a new
   event request. Sign in as `coordinator.a@…` and `coordinator.b@…`: neither sees
   it in Review requests.
2. **AC2 (Lead view).** Sign in as `coordinator-lead@connectsphere.test`, then open
   Supervised events. The request is under **Unassigned queue**, showing its title,
   category, date, expected attendance and submitted time, and the header counts
   "1 unassigned".
3. **AC3 (assign).** Choose *Coordinator Account A* and click **Assign**. The
   message "Assigned … to Coordinator Account A." appears, and the event moves to
   **Assigned events**.
4. **AC5 (notify, assign).** Sign in as `coordinator.a@…`. Home shows
   "Event assigned to you", and the request is in Review requests.
5. **AC3 (reassign).** As the Lead, choose *Coordinator Account B* under that event
   and click **Reassign**. The current Coordinator is not offered as a choice.
6. **AC4 + AC5 (scope, notify).** As `coordinator.a@…`, Home shows "Event
   reassigned" with no link, the event is gone from Review requests, and opening its
   URL directly is refused. As `coordinator.b@…`, it appears with "Event assigned to
   you", and B can approve it.
7. **Closed events.** Reject or complete an event as its Coordinator. On the Lead's
   page it shows no Reassign control.
8. **Organiser view.** As `organiser.a@…`, there is no assignment notification, and
   the request still shows *Planning*.

## Run the tests

```bash
docker compose -p connectsphere-acceptance -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-acceptance -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh
cd api && POSTGREST_TEST_URL=http://127.0.0.1:55433 pytest
cd ../frontend && npm run test:unit && npm run build && npm run test:e2e
```

## Known limitations

- **Lead detail page:** opening another Coordinator's event can fail on its
  clarification lookup. That is SCRUM-140 (Marcus); the Lead's assignment work happens
  on the Supervised events page, which doesn't need it.
- **Unpaginated list:** the Lead's list is the existing `GET /events`, which has no
  pagination.

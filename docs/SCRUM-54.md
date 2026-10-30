# SCRUM-54: Coordinator views all events

Week 7 change. A Coordinator can view **every** event, with their own assigned events
surfaced first, so they have full operational visibility (Customer S1 Q34: "mainly views
their own assigned events, but can view all"). Design and trade-offs: Decision Log **D28**.
Owner: Marcus. Floor story, 2 pts.

This is **list visibility only**. Record-level access is unchanged, so read does not grant
edit. It is deliberately separate from **SCRUM-140 / R11** (the Lead cannot open another
Coordinator's event via the clarification endpoint), which is a later bug.

## Acceptance criteria → evidence

| AC | Behaviour | Tests |
| --- | --- | --- |
| 1 | A Coordinator can view all events, with their own assigned events surfaced first. | TC-54-01 — `test_events.py::test_coordinator_lists_all_events_with_own_surfaced_first` (unit, own-first + `is_mine` + drafts excluded); `test_coordinator_view_all_acceptance.py::test_coordinator_sees_all_non_draft_events_own_surfaced_first` (real DB); e2e `coordinator-events.spec.ts` "own events are actionable and surfaced first; others are view-only" |
| 2 | Read access does not grant edit rights on events they don't own. | TC-54-02 — `test_events.py::test_coordinator_cannot_edit_an_event_they_do_not_own` (unit, PATCH → 403); `test_coordinator_view_all_acceptance.py::test_coordinator_cannot_edit_or_open_a_non_owned_event` (real DB, PATCH + GET detail → 403) |

## What changed

| Area | Change |
| --- | --- |
| `api/app/event_repository.py` | `list_all_events_for_coordinator(user_id)`: the "own" group reuses `get_events_for_user` (keeps draft privacy + pending-clarification hide), then every other non-Draft event is appended. |
| `api/app/events.py` | `GET /events` routes the Coordinator role to the new query and tags each returned event with an additive `is_mine` boolean (Coordinator responses only), computed server-side. |
| `frontend/src/lib/events.ts` | `CoordinatorEventRecord = EventRecord & { is_mine?: boolean }` — kept off `EventRecord` so forms that index it by key are unaffected. |
| `frontend/src/app/events/managed/page.tsx` | Repurposed from "My events" to **All events**: "Your assigned events" (actionable links) and "All other events" (view-only cards). |
| `frontend/src/app/events/review/page.tsx` | Now shows all submitted requests, split into "Awaiting your review" (actionable) and "Other submitted requests" (view-only) — the queue-visibility fix. |

### What a Coordinator sees now

| Event | In the list? | Opens / edits? |
| --- | --- | --- |
| Own (organiser or assigned), not pending clarification | Yes — **Your assigned events**, `is_mine: true` | Yes (existing record-level access) |
| Own, currently back with organiser for clarification | Hidden (unchanged from the assigned-work list) | — |
| Assigned to another Coordinator | Yes — **All other events**, `is_mine: false`, view-only | No — detail/edit still 403 |
| Unassigned Submitted (Lead's queue) | Yes — view-only | No until the Lead assigns it |
| Any Draft (another organiser's) | No — drafts stay private to their organiser | No |

## Tests updated for the new behaviour (list visibility only)

These encoded the pre-SCRUM-54 "a Coordinator sees only its own" rule; the list assertion
was flipped and **every actionability / 403 assertion retained**:

- `test_coordinator_assignment_acceptance.py` — TC-130-01, TC-130-04
- `test_request_acceptance.py` — TC-us41-02 (renamed `…both_coordinators_see_request_only_assigned_one_is_flagged`)
- `test_event_coordinator_lead_acceptance.py` — the Lead/Coordinator list test
- `tests/test_events.py` — the fake Supabase client now models `.neq(...)`

## Run the tests

```bash
# Unit / route
cd api && source .venv/bin/activate && python -m pytest tests/test_events.py -q

# Acceptance (real DB)
docker compose -p connectsphere-acceptance -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-acceptance -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh
POSTGREST_TEST_URL=http://127.0.0.1:55433 python -m pytest tests/test_coordinator_view_all_acceptance.py -q

# Frontend
cd ../frontend && npm run lint && npm run build && npx playwright test coordinator-events.spec.ts
```

## Manual test script

Use the SCRUM-139 password accounts on `/login` (API on port 5001).

1. **AC1 (view all, own first).** Sign in as `coordinator.a@connectsphere.test`, open
   **All events**. Events assigned to you appear under **Your assigned events** (openable);
   everyone else's non-draft events appear under **All other events** marked "view only".
2. **AC2 (read ≠ edit).** In **All other events**, confirm those cards are not links. Open
   another coordinator's event URL directly — it is refused (403). Your own events still open
   and edit normally.
3. **Queue visibility.** Submit a new request as an Organiser (it is unassigned). As
   `coordinator.a@…`, open **Review event requests**: the request shows under **Other
   submitted requests** (view only) until the Lead assigns it; once assigned to you it moves
   to **Awaiting your review** and becomes actionable.

## Known limitations

- **List-only scope.** A Coordinator sees other/unassigned events but cannot open their
  detail; this is intentional (SCRUM-140 / R11 covers the Lead's clarification-endpoint gate).
- **Unpaginated list**, like the Lead's oversight list (SCRUM-130).

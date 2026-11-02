# SCRUM-166 — Rescheduled or partially covered events can no longer pass confirmation on stale resources (audit R4)

Release 1 audit finding R4. Decision Log **D64**. Owner: Ernest Wong (event-timing design: Marcus, D54).

## What changed

| Rule | Before | Now |
| --- | --- | --- |
| Reschedule of a Confirmed / Preparation event | Kept its status, with bookings and a safety approval for the old time | Returns to **Planning**; history entry "Rescheduled — Returned to Planning"; Organiser and Coordinator are told; nothing is un-booked |
| Venue coverage at confirmation | A booking had to contain the event's start instant | Approved bookings **together** must cover the event from start to end; an approved booking that misses the event still blocks |
| Equipment at confirmation | Request status `Reserved` was enough | The reservation window must also cover the event's whole time |
| Events without an end time | — | Unchanged: the start-instant rule |

Pax, venue and facility changes stay flag-only (D36 / D43).

Found in the manual test and fixed here:

- **Status history order:** the approval and its "Returned to Planning" entry share one timestamp. Ties now keep their recorded order. A re-review approval also no longer shows a duplicate "Change Request Approved" line (a pre-existing legacy-restore quirk).
- **Notifications** now show their full message instead of cutting it after two lines.

## Files

- `api/app/event_confirmation.py`: span coverage, orphan and equipment-window rules (pure value object).
- `api/app/events.py`: the confirm route passes `event_end_datetime`.
- `api/app/equipment_request_repository.py`: passes each recorded reservation window to the gate.
- `supabase/migrations/20261103090000_scrum_166_reschedule_returns_to_planning.sql`: `approve_change_request()` returns rescheduled Confirmed / Preparation events to Planning.
- `frontend/src/lib/history.ts`: history label; `event-change-requests.tsx`: significant-change wording includes date/time.

## Tests

- **Unit:** `api/tests/test_event_confirmation_coverage.py` (29 boundary cases).
- **Integration:** `api/tests/test_reschedule_returns_to_planning_acceptance.py` (real database).
- **E2E:** `frontend/e2e/reschedule-returns-to-planning.spec.ts`; the history label in `frontend/src/lib/history.test.ts`.
- **Gates:** backend coverage 100%, frontend combined coverage 100%, all integrated journeys pass.

## Deploying

Apply `supabase/migrations/20261103090000_scrum_166_reschedule_returns_to_planning.sql` to the shared Supabase project after merge, in the SQL Editor. It's safe to rerun. Existing events are not changed; the rule applies to reschedules approved from then on.

## Manual check

1. As `organiser.a`, on a **Confirmed** event, request a new date. As its Coordinator, approve it: the event shows **Planning**, the history says "Rescheduled — Returned to Planning", and Confirm event names the booking that no longer matches.
2. Book the venue for the new date (as long as the event) and confirm: it succeeds and goes to the Safety Officer again.
3. On a 14:00–16:00 Planning event, approve a 14:00–15:00 booking only: Confirm event is refused with "do not cover the event's full time".

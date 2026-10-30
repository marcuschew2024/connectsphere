# SCRUM-140 (R11): Event Coordinator Lead cannot open another coordinator's event

**Codex-Audit R11 (High).** The Lead can list and read any non-draft event, but opening
another coordinator's event failed because the detail screen also fetches the clarification,
whose endpoint still required an event relationship. Design: Decision Log **D29**. Owner:
Marcus. Relates to SCRUM-131, SCRUM-54. (SCRUM-131 stays Done, per D25.)

## Root cause

The Lead's detail screen (`frontend/src/app/events/[eventId]/page.tsx`) fetches **event +
history + clarification** in one `Promise.all`:

- `GET /events/<id>` and `/history` use `require_event_access`, which **exempts the Lead**.
- `GET /events/<id>/clarification` called `require_related_user` directly. The Lead is not
  related to another coordinator's event → **403** → the whole `Promise.all` rejects → the
  page shows "You do not have access to this event."

Change-requests is already gated client-side (not fetched for the Lead), so **clarification
was the only broken fetch.**

## Fix

`get_clarification` (`api/app/events.py`) grants the **Lead** read access to any non-draft
event's clarification — the same oversight exemption the event-read rule applies — and keeps
`require_related_user` for everyone else:

```python
lead_oversight = user.get("role") == "Event Coordinator Lead" and event["status"] != "Draft"
if not lead_oversight:
    require_related_user(user, event, action="view_clarification")
```

**Why not just call `require_event_access`?** That would also grant the Safety Officer's
Confirmed/Preparation review window access to the clarification endpoint — an unnecessary
surface (the detail screen never fetches clarification for a Safety Officer, and
`test_safety_officer_acceptance.py` asserts they are denied it). The explicit Lead-only check
keeps that boundary.

## Scope

- **Lead-only.** Coordinators stay record-scoped — a non-owning Coordinator still 403s on both
  the event and its clarification (SCRUM-54 is list-only; D28). SCRUM-140 does not change that.
- No schema or migration change.

## Acceptance criteria → evidence

| Behaviour | Test |
| --- | --- |
| The Lead opens the full detail screen (event + history + clarification, incl. a real note) on another coordinator's event. | `test_event_coordinator_lead_acceptance.py::test_lead_opens_the_full_detail_screen_of_an_unrelated_event` |
| A non-owning Coordinator still cannot read the clarification (SCRUM-54 preserved). | same acceptance test + `test_events.py::test_unrelated_coordinator_cannot_read_a_clarification` |
| The Safety Officer is still denied the clarification endpoint. | `test_safety_officer_acceptance.py` (unchanged, still green) |
| The Lead's detail page renders end-to-end. | e2e `coordinator-assignment.spec.ts` "R11 (SCRUM-140): the Lead opens an unrelated coordinator's event detail" |

## Run the tests

```bash
cd api && source .venv/bin/activate && ruff check . && python -m pytest tests/test_events.py -q
docker compose -p connectsphere-acceptance -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-acceptance -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh
POSTGREST_TEST_URL=http://127.0.0.1:55433 python -m pytest tests/test_event_coordinator_lead_acceptance.py tests/test_safety_officer_acceptance.py -q
cd ../frontend && npm run lint && npm run build && npx playwright test coordinator-assignment.spec.ts
```

## Manual check

As `coordinator-lead@connectsphere.test`, open **Supervised events**, click an event
assigned to a *different* coordinator. The detail screen opens (status, history, details) with
no "You do not have access" error. If that event has a pending clarification, its note is
visible.

# SCRUM-145 (R16): Safety Officer review needs venue + technical detail

**Codex-Audit R16 (High).** The operational safety check (SCRUM-128) let the Safety Officer
approve/reject/request-changes, but the review screen lacked the venue and technical detail
SCRUM-128 requires — so the decision wasn't informed. Design: Decision Log **D30**. Owner:
Marcus (with Jerome). Relates to SCRUM-128 (which stays Done).

## Requirement

SCRUM-128 AC: *"The review presents expected attendance, venue capacity and layout, emergency
access, accessibility requirements, equipment placement, crowd movement and known venue
restrictions for the Safety Officer to assess."* The attendance + judgement prompts (emergency
access, crowd movement, restrictions) already render in the review form's considerations list;
R16 adds the **stored** venue + technical data: venue capacity/layout/accessibility/facilities
and equipment placement.

## Fix

A single **event-scoped, read-only** endpoint feeds a new review panel.

### Backend — `GET /events/<id>/safety-review-details`
- Guarded by `require_event_access`, which already gates the Safety Officer to the
  **Confirmed/Preparation** window (and admits the event's related users / the Lead).
- Returns `{ bookings, venues, equipment: { reservations } }` for that event, reusing existing
  repository reads.
- Each venue is projected through `safety_venue_view` — a whitelist of `{id, name, location,
  capacity, supported_layouts, accessibility, facilities}` — so operating hours, buffers,
  timezone and audit columns never reach the screen (least privilege).

**Why not loosen the existing endpoints?** `GET /venues/<id>` is catalogue-wide; widening it to
the Safety Officer would let them browse every venue, breaking the event-scoping requirement.
The aggregated endpoint is event-scoped by construction.

### Frontend — `event-safety-review-detail.tsx`
Read-only "Venue & technical detail" panel on the Safety Officer's review screen (Confirmed or
Preparation), above the approve/reject form: venues (capacity, layouts, accessibility,
facilities), venue bookings (slot + status), and equipment reservations (type, location,
quantity, status). No management controls.

## Scope (least privilege)

- Event-scoped: only the event under review; a non-related, non-Safety-Officer user is denied.
- Read-only: no venue/equipment management, no generic status changes.
- No schema or migration change.

## Acceptance criteria → evidence

| Behaviour | Test |
| --- | --- |
| Venue panel shows safety fields only (no operating hours / buffers / audit columns). | `test_events.py::test_safety_venue_view_exposes_only_safety_fields` (unit) |
| Safety Officer reads the detail on a Confirmed and a Preparation event. | `test_safety_officer_acceptance.py::test_safety_officer_reads_event_scoped_review_detail` |
| Denied outside the window (Planning) and when unrelated / not the Safety Officer. | same acceptance test |
| Existing decision journey (approve→Preparation; request-changes/reject→Planning) still passes. | `test_safety_officer_acceptance.py` (unchanged tests) |
| The panel renders capacity/layout/accessibility/facilities + booking + equipment, read-only. | e2e `event-safety-check.spec.ts` "safety officer sees read-only venue and technical detail panels" |

## Run the tests

```bash
cd api && source .venv/bin/activate && ruff check . && python -m pytest tests/test_events.py -q
docker compose -p connectsphere-acceptance -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-acceptance -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh
POSTGREST_TEST_URL=http://127.0.0.1:55433 python -m pytest tests/test_safety_officer_acceptance.py -q
cd ../frontend && npm run lint && npm run build && npx playwright test event-safety-check.spec.ts
```

## Manual check

As `safety-officer@connectsphere.test`, open a **Confirmed** event from the safety-review queue.
Above the approve/reject controls, a **Venue & technical detail** panel shows each booked venue's
capacity, layouts, accessibility and facilities, the venue bookings, and the equipment
reservations — all read-only. Approve → the event moves to Preparation.

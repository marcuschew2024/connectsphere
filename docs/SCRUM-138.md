# SCRUM-138: Approved change requests apply their changes (R06)

Bug from Codex review R06. Approving a SCRUM-46 change request now applies the
requested values to the event atomically and flags significant changes for re-review.
The contract was decided by the PO and is recorded in
[Decision Log D36](DECISION_LOG.md).

## Acceptance criteria

| PO acceptance criterion | How it is met |
| --- | --- |
| Approving applies the requested values atomically, recording actor + timestamp | `approve_change_request()` applies the values, sets `reviewed_by`/`reviewed_at`, stores `applied_changes` (from → to) and writes `change_request_approved` history in one transaction |
| A significant change (pax / venue / duration) flags re-review and notifies the coordinator | `expected_attendance` or `venue_requirements` changes set `significant` and send `event_re_review_required` to the Coordinator; the event page shows "Re-review needed" until the request is marked Implemented. Events have no duration field (see below) |
| No venue/equipment is auto-cancelled; affected resources are surfaced | Active venue bookings and equipment reservations are only counted, returned and named in the notice |
| Ordinary changes apply without a re-review flag | Any other field sets `significant = false` and sends no re-review notice |
| On failure, rollback leaves the event unchanged | Any database error aborts the whole transaction: event, request, history and notifications are untouched |

## Workflow

1. The Organiser raises a change request with a description and, optionally,
   proposed values (`POST /events/{id}/change-requests` with
   `{"description": "...", "changes": {"expected_attendance": 150}}`).
   - Changeable: title, description, purpose, category, expected attendance, and
     venue, accessibility, equipment and registration requirements.
   - Not changeable here: date and time (rescheduling is SCRUM-48), status,
     ownership and audit fields.
   - Required details cannot be blanked, values must be valid, and a value equal to
     the current one is refused, each with a field-specific message.
2. The assigned Coordinator chooses **Approve and apply**. The response contains the
   updated request (`applied_changes`, `significant`), the updated event and the
   `affected` counts.
3. For a significant change the Coordinator re-checks the bookings and equipment, then
   chooses **Mark as implemented**, which clears the notice and keeps the record.

Start review, Reject and a request that only describes a change behave as before.

**Duration.** Events store a single date and time, with no duration. A duration
change is therefore described in the request text and handled through the bookings
or rescheduling (SCRUM-48); it cannot be applied as a value.

## Database setup

Apply
[`20261031120000_scrum_138_apply_change_request.sql`](../supabase/migrations/20261031120000_scrum_138_apply_change_request.sql)
after the SCRUM-46 change-request migration. It adds three nullable columns, two check
constraints and the function, and is safe to rerun. Existing requests are unaffected.
The disposable CI database applies it automatically.

## Out of scope

- The Coordinator's direct Planning edits (`PATCH /events/{id}`). The PO limited this
  bug to the SCRUM-46 decision path.
- A structured re-review queue and venue/tech re-approval: SCRUM-47.
- Rescheduling: SCRUM-48.

## Tests

- `api/tests/test_change_request_proposal.py`: what may be proposed and what is significant.
- `api/tests/test_change_request_apply_route.py`: endpoint wiring, which decisions
  apply values, refusals and the repository's error mapping.
- `api/tests/test_change_request_apply_acceptance.py`: real database, covering the
  applied values and audit, significant changes with every arrangement unchanged,
  rollback, values already in place, database re-checks, stored-proposal constraints,
  marking implemented and two simultaneous approvals.
- `frontend/src/lib/change-requests.test.ts` and `frontend/e2e/change-request-apply.spec.ts`:
  proposing, field errors, approving and applying, the re-review notice, marking
  implemented and a failed approval.

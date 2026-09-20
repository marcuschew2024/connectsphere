# SCRUM-23: Edit event info during Planning (US-4.6)

While an event is in **Planning**, its **assigned coordinator** can update its details. Every
edit is recorded (who + when + which fields), and each change is classified **important**
(affects confirmed arrangements) or **ordinary**. Once the event is **Confirmed**, direct
editing is disabled — changes must go through a change request (US-10.1, later sprint).

## 1. Apply the database migration

Supabase → **SQL Editor** → run `supabase/edit_planning.sql`. It creates `event_edit_log`:

| Column | Purpose |
| --- | --- |
| event_id | the edited event (FK) |
| editor_id | the coordinator who edited (FK) |
| changed_fields | text[] of the fields that changed |
| importance | `important` or `ordinary` |
| occurred_at | timestamp |

Backend-only (RLS on, `service_role` only) — same posture as the other audit tables.

## 2. Backend — `PATCH /events/<id>` (`api/app/events.py`)

Order of checks:
1. **Origin** must be the configured frontend.
2. **Authorised coordinator only** — `require_role(Coordinator)` **and** `require_related_user`
   (must be *this event's* coordinator). Anyone else → 403 + logged (TC-US4.6-04, reuses US-1.2 RBAC).
3. **Planning-only** — if the (canonical) status isn't `Planning`, → **409** "must go through a
   change request" (TC-US4.6-03). The status map treats Draft/Submitted/Assigned/Under review/
   Approved/Planning as Planning; Confirmed and later are locked.
4. Validate with the existing `validate_event` (submit rules).
5. Persist only the fields that actually **changed** (`update_event_fields`, bumps `updated_at`).
6. **Classify + audit**: `important` if any changed field is in `IMPORTANT_FIELDS`
   (event_datetime, expected_attendance, category, venue/equipment/accessibility requirements),
   else `ordinary`; write a row to `event_edit_log` (TC-US4.6-02, -05). The audit write is
   best-effort — a lost audit row never fails the edit itself.

Response: `{ event, changed_fields, importance }`.

## 3. Frontend — `events/[eventId]/event-edit-form.tsx`

- Shown on the event detail page **only to a Coordinator**.
- **In Planning:** a pre-filled edit form; on save → PATCH; shows whether the change was
  recorded as important or ordinary; refreshes the page's event.
- **Not in Planning (e.g. Confirmed):** the form is replaced by a notice that direct editing
  is disabled and changes must go through a change request (disabled-when-confirmed).

## 4. Tests — `api/tests/test_events.py`

| TC | Test |
| --- | --- |
| TC-US4.6-01 edit while Planning saves | `test_coordinator_edits_event_while_planning` |
| TC-US4.6-02 audit actor + timestamp | `test_edit_records_actor_and_timestamp` |
| TC-US4.6-03 blocked once Confirmed | `test_edit_blocked_once_confirmed` |
| TC-US4.6-04 unauthorised editor denied | `test_non_coordinator_cannot_edit` |
| TC-US4.6-05 important vs ordinary | `test_important_change_is_flagged`, `test_ordinary_change_is_flagged` |

156 total passing, ruff clean; frontend lint + build + e2e (16) clean.

## Known limitation
Same auth seam as SCRUM-20/21: identity is resolved via the dev role switcher, not the real
login session. Fine for the Sprint 1 demo.

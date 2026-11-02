# SCRUM-169 — maintenance includes setup and turnaround (R5)

Parent: SCRUM-60. Related: SCRUM-129, SCRUM-120, Week 7 changes 1 and 2.
Owner: Jessica Ang; database/concurrency review: Ernest Wong.

## Problem and resulting behavior

A 10:00–12:00 booking with 30 minutes of setup and 45 minutes of turnaround occupies
09:30–12:45. Maintenance at 09:45–10:00 or 12:00–12:30 previously escaped search,
booking enforcement and affected-booking notification. All three now use physical
occupation. Maintenance has its own recorded interval; it receives no additional buffer.
Exact occupied endpoints may touch without conflict.

New/changed bookings cannot overlap an existing active block. Venue Staff can still add
an operational block affecting an existing booking: the event and booking survive and
the current coordinator receives a notice directing them to replacement arrangements.
One notice per coordinator lists every affected event, preserving the existing notification
count contract. Its event link opens the first affected event; the message names the others.
Cancelled/rejected/expired bookings and expired Held records are not reported as affected.

## Implementation

- `venue_unavailability.occupied_window` reuses the existing pure BookingInterval model.
- Search queries maintenance over that proposed occupied window.
- Existing-booking queries use persisted R1 occupied columns, with expired-hold filtering.
- The new migration derives a proposed booking interval inside the maintenance guard.
  It cannot trust `NEW.occupied_*`: the R1 population trigger runs later alphabetically.
- A statement trigger on maintenance writes locks the booking table in SHARE ROW
  EXCLUSIVE mode until commit. A committed booking is visible to the subsequent block
  report, or a committed block is visible to the booking guard. Two real transaction
  orderings are tested. The lock briefly pauses booking writes across venues; see D64.
- No new role, automatic cancellation, status-transition rule, or replacement policy.

## Acceptance criteria and executable evidence

| Required behavior | Evidence |
| --- | --- |
| Setup-only and turnaround-only maintenance blocks availability and booking | `test_search_and_new_booking_agree_on_maintenance_window`; `test_database_itself_refuses_buffer_only_maintenance` |
| Half-open boundaries and zero buffers | Same search test boundary cases; `test_zero_buffers_do_not_expand_maintenance` |
| Changed booking cannot enter a blocked buffer and failed edit is atomic | `test_edit_into_buffer_only_maintenance_is_atomic` |
| New block identifies existing arrangements, notifies coordinator, preserves records | `test_new_block_flags_existing_booking_notifies_and_preserves_event` |
| Current coordinator, every affected event, no inactive/expired false positives | Live-hold/reassignment, multi-event summary, and inactive-status acceptance tests |
| Unblocking restores availability with audit; role restrictions hold | Unblocking and nonstaff acceptance tests |
| Concurrent block and booking do not silently miss each other | `supabase/tests/maintenance_concurrency.sh`, both orderings; SQL harness runs it |
| Calendar, notice navigation, replacement request/approval, unaffected sibling preservation | Two `INTEGRATED-R5` journeys in `frontend/integration/release-exits.spec.ts` |
| Equivalent timezone representations | `api/tests/test_maintenance_window.py` |

All new backend acceptance tests are in `api/tests/test_maintenance_buffers_acceptance.py`.
Existing assertions were retained. Before production changes, the first 18 new cases gave
14 failures and 4 passes, demonstrating the missing behavior rather than only confirming
the implementation. Final execution results are recorded below after verification.

## Deployment and limits

R1's occupied columns and triggers must already be installed. Apply the new migration
`supabase/migrations/20261102165722_scrum_169_maintenance_occupied_windows.sql` through
the reviewed release process. The disposable SQL harness applies it twice.

This change does not silently notify historical conflicts during migration. Before rollout,
review existing active maintenance against active booking occupied intervals, excluding
expired holds. Any previously missed affected events need coordinator follow-up. Existing
events/bookings must not be deleted to make the rollout pass.

R1/R6 buffer-increase reporting and R4 event readiness remain separate work. Browser
evidence is Chromium; no cross-browser or production load result is claimed.

## Review accountability

- Delegated: close R5 against SCRUM-60/129 and test normal, boundary, failure and concurrency paths.
- Constraints: existing half-open intervals, role guards, preservation/replacement ACs, test protection.
- Evidence: regression failures before the fix, disposable DB/API, SQL concurrency and browser tests.
- Human review: migration and lock trade-off, venue acceptance and coordinator summary behavior.
- Accountable owners: Jessica for venue behavior, Ernest for database review, release owner for deployment.

No push, merge or hosted migration deployment is claimed by this local implementation record.

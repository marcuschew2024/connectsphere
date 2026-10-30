# Release requirement verification

Complete release coverage is not established. Passing mapped checks support the listed intent; they do not approve an entire feature or close a recorded gap.

Generated 2026-10-30T19:24:44.625375+00:00. Source baseline `8445c7bd34537dc48800a64f6e196268b0e8f073`; verification source SHA256 `e3c38c450e88885678544ced03c5404e70ac793df824aeb552ded9b7e7d53f6c`.

## Executed suites

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| backend | 1843 | 0 | 0 |
| frontend | 67 | 0 | 0 |
| browser | 254 | 0 | 0 |
| integrated | 2 | 0 | 0 |

An empty suite means execution evidence was not supplied; it is not a pass.

## Code coverage

| Scope | Statements | Branches |
| --- | ---: | ---: |
| Backend app | 96.35% | 93.30% |
| Frontend src unit suite | 2.74% | 81.87% |

All src TS/TSX included. Browser execution is not instrumented here. V8 branch/function denominators do not prove unexecuted UI branches.


## Requirement checklist

SQL paths identify additional assertions; SQL execution is recorded separately by the disposable harness exit result and log.

### CORE-01 Authentication and authorisation

Owner: Ernest; Marcus for access policy. Stories: SCRUM-20, SCRUM-21, SCRUM-139.

Password login resolves the stored role; record ownership and role restrict actions. Registered attendee membership cannot grant lifecycle mutation or internal fields.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_role_accounts_acceptance.py::test_each_seeded_account_signs_in_with_its_role_in_production` | passed (10 cases) |
| backend | `api/tests/test_release_login_acceptance.py::test_five_real_failures_lock_across_clients_and_record_attributed_timestamps` | passed (1 cases) |
| backend | `api/tests/test_release_login_acceptance.py::test_correct_fifth_attempt_resets_stored_failures_and_logout_invalidates_session` | passed (1 cases) |
| backend | `api/tests/test_release_security_acceptance.py::test_registered_attendee_cannot_mutate_lifecycle_or_receive_private_fields` | passed (4 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |
| backend | `api/tests/test_role_accounts_acceptance.py::test_account_locks_after_real_consecutive_failures_then_recovers` | passed (1 cases) |

Acceptance: gap recorded.

- Production HTTPS/cookie deployment and browser inactivity expiry need release-environment evidence. SCRUM-141 now uses an atomic failed-login RPC and adds persisted recovery tests; simultaneous login-failure evidence remains a separate concurrency check.

### CORE-02 Event request creation

Owner: Jerome. Stories: SCRUM-14.

Required request details are validated; valid submission persists with actor attribution, invalid submission leaves the draft unchanged.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_request_acceptance.py::test_tc_us33_01_invalid_draft_cannot_submit` | passed (1 cases) |
| backend | `api/tests/test_request_acceptance.py::test_tc_us33_03_submission_has_actor_and_timestamp` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |

Acceptance: human acceptance pending.


SQL assertions: `supabase/tests/drafts.sql`.

### CORE-03 Draft event requests

Owner: Jerome. Stories: SCRUM-15, SCRUM-16.

An incomplete private draft can be saved, reopened and submitted once using the same event reference.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_request_acceptance.py::test_tc_us32_01_to_05_private_draft_can_be_saved_reopened_and_submitted` | passed (1 cases) |
| backend | `api/tests/test_events.py::test_concurrent_submission_returns_conflict` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |

Acceptance: human acceptance pending.


SQL assertions: `supabase/tests/drafts.sql`.

### CORE-04 Event review and approval

Owner: Jerome; Marcus for clarification scope. Stories: SCRUM-18, SCRUM-22.

Only the assigned Coordinator approves/rejects a submitted request; rejection requires a reason and the Organiser receives the outcome. Clarification supports revision/resubmission.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_event_decisions.py::test_rejection_stores_reason_and_notifies_organiser` | passed (1 cases) |
| backend | `api/tests/test_events.py::test_organiser_can_view_and_resubmit_clarified_request` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |

Acceptance: gap recorded.

- Clarification source conflict J2 and section-specific acceptance still require owner confirmation. Real-browser clarification/rejection branches are not in the integrated lane.

### CORE-05 Coordinator assignment and reassignment

Owner: Ernest. Stories: SCRUM-130, SCRUM-131.

Submission enters an unassigned queue. The Lead assigns/reassigns; prior Coordinator loses action access; recipients and stored membership follow the assignment.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_coordinator_assignment_acceptance.py::test_tc_130_01_submission_enters_the_unassigned_queue_the_lead_can_see` | passed (1 cases) |
| backend | `api/tests/test_coordinator_assignment_acceptance.py::test_tc_130_03_lead_reassigns_and_both_coordinators_are_notified` | passed (1 cases) |
| backend | `api/tests/test_coordinator_assignment_acceptance.py::test_tc_130_04_coordinators_only_manage_events_assigned_to_them` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |
| backend | `api/tests/test_release_assignment_failures.py::test_assignment_rpc_refusals_preserve_safe_http_meaning` | passed (5 cases) |

Acceptance: human acceptance pending.


SQL assertions: `supabase/tests/coordinator_assignment.sql`.

### CORE-06 Event status management

Owner: Marcus; Ernest for cancellation. Stories: SCRUM-19, SCRUM-69, SCRUM-132, SCRUM-135.

Status presentation follows the actor; confirmation, safety and completion have dedicated gates; attendees cannot mutate lifecycle.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_event_status.py::test_status_endpoint_cannot_set_confirmed_directly` | passed (1 cases) |
| backend | `api/tests/test_event_completion_acceptance.py::test_completion_closes_the_event_audits_it_and_releases_holds` | passed (1 cases) |
| backend | `api/tests/test_release_security_acceptance.py::test_registered_attendee_cannot_mutate_lifecycle_or_receive_private_fields` | passed (4 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |
| backend | `api/tests/test_event_cancellation_acceptance.py::test_cancelling_releases_resources_and_notifies_registered_attendees` | passed (1 cases) |
| backend | `api/tests/test_event_cancellation_acceptance.py::test_concurrent_cancellations_cancel_once_and_notify_once` | passed (1 cases) |
| backend | `api/tests/test_event_cancellation_acceptance.py::test_a_cancelled_event_is_read_only_but_still_visible` | passed (1 cases) |

Acceptance: gap recorded.

- SCRUM-135 remains partial: the generic route still needs a complete human-designed forward-only role/state matrix for Submitted, Planning and Rejected states. SCRUM-69 now provides dedicated atomic cancellation and a read-only Cancelled state; those previous gaps are closed by the mapped database tests.

### CORE-07 Event information management

Owner: Marcus; Ernest for significant changes. Stories: SCRUM-23, SCRUM-46, SCRUM-47, SCRUM-48, SCRUM-138.

Planning edits preserve attribution and become read-only after confirmation. Important changes need reconsideration of existing resource arrangements.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_events.py::test_coordinator_edits_event_while_planning` | passed (1 cases) |
| backend | `api/tests/test_events.py::test_edit_blocked_once_confirmed` | passed (1 cases) |
| backend | `api/tests/test_change_request_acceptance.py::test_change_request_is_recorded_without_changing_the_event` | passed (1 cases) |
| backend | `api/tests/test_change_request_apply_acceptance.py::test_approving_applies_the_values_and_records_the_decision` | passed (1 cases) |
| backend | `api/tests/test_change_request_apply_acceptance.py::test_a_significant_change_flags_re_review_and_keeps_every_arrangement` | passed (2 cases) |
| backend | `api/tests/test_change_request_apply_acceptance.py::test_a_failed_apply_leaves_the_event_and_request_unchanged` | passed (1 cases) |

Acceptance: gap recorded.

- SCRUM-138 now applies approved proposed fields atomically and flags affected arrangements for re-review without cancelling them. A structured re-approval workflow (SCRUM-47) and date/time rescheduling (SCRUM-48) remain outside that implemented slice.

### CORE-08 Venue catalogue

Owner: Jessica. Stories: SCRUM-24, SCRUM-25, SCRUM-60.

Venue details persist, duplicates and invalid capacities are rejected, and updates preserve booking records and audit.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_venue_acceptance.py::test_created_venue_is_persisted_and_immediately_in_coordinator_catalogue` | passed (1 cases) |
| backend | `api/tests/test_venue_acceptance.py::test_duplicate_name_and_location_are_blocked_case_and_whitespace_insensitively` | passed (1 cases) |
| backend | `api/tests/test_venue_acceptance.py::test_update_is_audited_searches_change_and_confirmed_booking_is_unchanged` | passed (1 cases) |

Acceptance: gap recorded.

- SCRUM-60 now implements temporary venue unavailability. The real-browser/API/database replacement journey remains an evidence gap under W7-02.

SQL assertions: `supabase/tests/venues.sql`, `supabase/tests/venue_updates.sql`.

### CORE-09 Venue availability calendar

Owner: Jessica. Stories: SCRUM-30, SCRUM-129.

Internal users can retrieve range bookings; calendar cells distinguish booked/blocked/free and closed hours with half-open raw-time boundaries.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_venue_calendar_routes.py::test_venue_bookings_returns_range` | passed (1 cases) |
| backend | `api/tests/test_venue_calendar_routes.py::test_venue_bookings_requires_from_and_to` | passed (1 cases) |
| browser | `frontend/e2e/venue-calendar.spec.ts::coordinator sees the availability calendar with a confirmed slot` | passed (1 cases) |

Acceptance: gap recorded.

- The calendar classifier uses published booking times; buffer-expanded calendar parity is not established. See W7-01.

### CORE-10 Venue search and filtering

Owner: Jessica. Stories: SCRUM-28.

Combined filters run before pagination, reject malformed slots, and never claim availability when database reads fail.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_venue_search.py::test_combined_filters_match_case_whitespace_and_inclusive_capacity` | passed (1 cases) |
| backend | `api/tests/test_venue_search.py::test_database_failure_never_claims_available` | passed (1 cases) |
| backend | `api/tests/test_venue_acceptance.py::test_search_availability_with_real_bookings` | passed (7 cases) |

Acceptance: gap recorded.

- Search uses raw overlap lookup; complete buffer-aware search/calendar/booking consistency is not established.

SQL assertions: `supabase/tests/venues.sql`.

### CORE-11 Venue suitability checking

Owner: Jessica. Stories: SCRUM-29.

Capacity, layout, facilities and accessibility contribute independent suitability flags, including exact capacity and missing-data boundaries.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_venue_suitability.py::test_capacity_rule_passes_on_exact_capacity_match` | passed (1 cases) |
| backend | `api/tests/test_venue_suitability.py::test_suitability_engine_returns_multiple_flags` | passed (1 cases) |
| backend | `api/tests/test_venue_suitability.py::test_api_suitability_endpoint_returns_unsuitable_advisory_flags` | passed (1 cases) |

Acceptance: gap recorded.

- TC-29-04 advisory suitability versus booking hard capacity gate needs section-specific acceptance reconciliation.

### CORE-12 Venue booking request

Owner: Ernest. Stories: SCRUM-31, SCRUM-126.

An assigned Coordinator submits independent bookings for one event. Editing/cancelling one booking must preserve its sibling and parent; persistence failures must not report success.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_booking_persistence_acceptance.py::test_one_booking_changes_without_touching_its_sibling_or_parent` | passed (2 cases) |
| backend | `api/tests/test_booking_persistence_acceptance.py::test_failed_database_write_is_not_reported_as_success` | passed (2 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |

Acceptance: gap recorded.

- Venue/equipment bookings can have timing independent of the event; cross-feature alignment policy is not fully enforced.

SQL assertions: `supabase/tests/venue_overlap.sql`.

### CORE-13 Venue booking approval

Owner: Ernest. Stories: SCRUM-32.

Venue Staff approve/reject with reasons, confirmation affects availability, and a competing confirmed booking blocks approval.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_booking_decision_route.py::test_approve_confirms_and_notifies` | passed (1 cases) |
| backend | `api/tests/test_booking_decision_route.py::test_reject_requires_reason` | passed (1 cases) |
| backend | `api/tests/test_booking_decision_route.py::test_overlapping_approve_conflicts` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-02` | passed (1 cases) |

Acceptance: human acceptance pending.


SQL assertions: `supabase/tests/venue_overlap.sql`.

### CORE-14 Booking conflict detection

Owner: Jessica. Stories: SCRUM-33, SCRUM-79, SCRUM-120, SCRUM-129.

Half-open boundaries, confirmed/blocked precedence and tentative holds prevent incompatible booking requests.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_venue_overlap.py::test_confirmed_overlap_is_hard_blocked` | passed (1 cases) |
| backend | `api/tests/test_venue_overlap.py::test_tc_129_02_touching_occupied_boundaries_do_not_conflict` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-02` | passed (1 cases) |

Acceptance: gap recorded.

- Concurrent approval of published-adjacent bookings with overlapping buffers needs independent SQL enforcement evidence.

SQL assertions: `supabase/tests/venue_overlap.sql`, `supabase/tests/venue_holds.sql`.

### CORE-15 Equipment request management

Owner: Jerome. Stories: SCRUM-34, SCRUM-35, SCRUM-38.

Coordinator requests route to Tech Support with quantities and notes; invalid multi-item writes roll back; reservation-derived status agrees with actual allocations.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_equipment_request_acceptance.py::test_record_two_items_routing_audit_reload_and_no_stock_change` | passed (1 cases) |
| backend | `api/tests/test_equipment_request_acceptance.py::test_api_and_database_reject_invalid_second_item_atomically` | passed (7 cases) |
| backend | `api/tests/test_equipment_request_reservations_acceptance.py::test_derived_status_cannot_be_set_manually` | passed (2 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |

Acceptance: human acceptance pending.


SQL assertions: `supabase/tests/equipment_requests.sql`, `supabase/tests/equipment_request_status.sql`.

### CORE-16 Equipment availability checking

Owner: Jessica. Stories: SCRUM-36.

Overlapping stock reservations reduce availability; touching windows do not; damaged/maintenance stock is unavailable.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_equipment_availability.py::test_availability_insufficient_quantity` | passed (1 cases) |
| backend | `api/tests/test_equipment_availability.py::test_touching_boundary_slots_do_not_overlap` | passed (1 cases) |
| backend | `api/tests/test_equipment_availability.py::test_damaged_equipment_shows_zero_availability` | passed (1 cases) |
| backend | `api/tests/test_equipment_request_reservations_acceptance.py::test_request_and_catalogue_compete_for_same_stock` | passed (1 cases) |

Acceptance: human acceptance pending.


SQL assertions: `supabase/tests/equipment.sql`.

### CORE-17 Equipment reservation

Owner: Jessica. Stories: SCRUM-37.

Allocations reduce shared stock, remain event-associated, reject stale revisions/over-reservation and roll back every item on a failed allocation.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_equipment_request_reservations_acceptance.py::test_capacity_failure_rolls_back_every_item_and_stale_retry_cannot_double_book` | passed (1 cases) |
| backend | `api/tests/test_equipment_request_reservations_acceptance.py::test_cannot_adopt_another_events_booking` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |

Acceptance: human acceptance pending.


SQL assertions: `supabase/tests/equipment_request_reservations.sql`.

### CORE-18 Attendee registration

Owner: Jerome. Stories: SCRUM-40, SCRUM-41, SCRUM-43, SCRUM-44, SCRUM-45.

Attendees register once within capacity, retain their own receipt, and withdraw under the saved policy; competing final-place/withdrawal requests cannot duplicate capacity.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_registration_capacity_acceptance.py::test_two_simultaneous_requests_cannot_take_the_same_final_place` | passed (1 cases) |
| backend | `api/tests/test_registration_withdrawal_acceptance.py::test_two_simultaneous_withdrawals_release_exactly_one_place_and_receipt` | passed (1 cases) |
| backend | `api/tests/test_registration_withdrawal_acceptance.py::test_conditions_are_enforced_on_rpc_and_direct_update_without_partial_state` | passed (5 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |

Acceptance: gap recorded.

- SCRUM-45 organiser/coordinator registration roster remains unimplemented; aggregate counts do not establish appropriate individual registration visibility.
- TC-43-02 waiting-list promotion remains deferred SCRUM-80; do not mark it passed. Owner must reconcile that documented case with the agreed release slice.
- Registration closes when safety approval moves to Preparation; owner must verify the customer accepts that signup window.

SQL assertions: `supabase/tests/registration_capacity.sql`, `supabase/tests/attendee_registration.sql`, `supabase/tests/registration_withdrawal.sql`.

### CORE-19 Event change requests

Owner: Ernest. Stories: SCRUM-46, SCRUM-47, SCRUM-48, SCRUM-138.

The Organiser raises a request without silently editing the event; assigned Coordinator reviews it with audit and notifications; outsiders cannot act.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_change_request_acceptance.py::test_change_request_is_recorded_without_changing_the_event` | passed (1 cases) |
| backend | `api/tests/test_change_request_acceptance.py::test_review_lifecycle_is_audited_and_notifies_each_party` | passed (1 cases) |
| backend | `api/tests/test_change_request_acceptance.py::test_both_parties_see_status_and_outsiders_are_denied` | passed (1 cases) |
| backend | `api/tests/test_change_request_apply_acceptance.py::test_approving_applies_the_values_and_records_the_decision` | passed (1 cases) |
| backend | `api/tests/test_change_request_apply_acceptance.py::test_a_significant_change_flags_re_review_and_keeps_every_arrangement` | passed (2 cases) |
| backend | `api/tests/test_change_request_apply_acceptance.py::test_a_failed_apply_leaves_the_event_and_request_unchanged` | passed (1 cases) |

Acceptance: gap recorded.

- SCRUM-138 now applies approved proposed fields atomically and flags affected arrangements for re-review without cancelling them. A structured re-approval workflow (SCRUM-47) and date/time rescheduling (SCRUM-48) remain outside that implemented slice.

### CORE-20 Notifications

Owner: Marcus. Stories: SCRUM-49, SCRUM-51.

Private and role-pool notifications reach only their intended readers; key request/assignment/booking/registration outcomes are emitted.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_notifications_feed_acceptance.py::test_reader_returns_own_and_pool_rows_with_isolation` | passed (1 cases) |
| backend | `api/tests/test_notifications_feed_acceptance.py::test_recipient_target_and_role_constraints_are_enforced_by_database` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |
| backend | `api/tests/test_request_acceptance.py::test_notifications_are_newest_first_and_limited_to_50` | passed (1 cases) |
| backend | `api/tests/test_event_cancellation_acceptance.py::test_cancelling_releases_resources_and_notifies_registered_attendees` | passed (1 cases) |
| backend | `api/tests/test_venue_unavailability.py::test_venue_staff_can_create_block_and_notify_each_coordinator_once` | passed (1 cases) |

Acceptance: gap recorded.

- Cancellation and applied-change recipients now have database acceptance evidence; venue-unavailability notification wiring has route tests. A complete trigger-by-recipient matrix, persisted hold-expiry notices and full-stack replacement-venue notifications remain unproven.

### W7-01 Venue setup and turnaround buffers

Owner: Jessica. Stories: SCRUM-129.

Venue setup/turnaround expand occupied windows; touching expanded boundaries remain non-conflicting; newly conflicting existing bookings are flagged.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_venue_overlap.py::test_tc_129_01_booking_reserves_start_minus_setup_to_end_plus_turnaround` | passed (1 cases) |
| backend | `api/tests/test_venue_overlap.py::test_identify_problematic_existing_bookings_when_buffers_introduced` | passed (1 cases) |

Acceptance: gap recorded.

- Pure overlap maths is covered. Search/calendar raw-time behaviour and database exclusion ranges do not prove consistent buffer enforcement across create/edit/approval or competing writes.

SQL assertions: `supabase/tests/venue_buffers.sql`.

### W7-02 Venue becomes unavailable after booking

Owner: Jessica. Stories: SCRUM-60.

Venue Staff mark temporary unavailability with reason, retain affected events, notify Coordinators, and support replacement venue arrangements.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_venue_unavailability.py::test_venue_staff_can_create_block_and_notify_each_coordinator_once` | passed (1 cases) |
| backend | `api/tests/test_venue_unavailability.py::test_block_rejects_overlapping_active_block` | passed (1 cases) |
| browser | `frontend/e2e/venue-calendar.spec.ts::Venue Staff can create and unblock a venue period` | passed (1 cases) |

Acceptance: gap recorded.

- SCRUM-60 is now implemented with blocks, affected-booking notices, search/calendar integration and a replacement link. The mapped API tests use controlled persistence and the browser test mocks HTTP; a real DB block-to-notification-to-replacement journey and competing-write/rollback evidence are still needed.

### W7-03 Multiple venues per event

Owner: Ernest. Stories: SCRUM-126, SCRUM-39.

One event owns independent venue bookings; sibling edits/cancellations are isolated and confirmation requires all active venues approved.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_booking_persistence_acceptance.py::test_one_booking_changes_without_touching_its_sibling_or_parent` | passed (2 cases) |
| backend | `api/tests/test_event_confirmation_route.py::test_confirm_blocked_when_a_booking_is_pending` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |

Acceptance: human acceptance pending.


SQL assertions: `supabase/tests/venue_overlap.sql`.

### W7-04 Expiring tentative venue holds

Owner: Jessica. Stories: SCRUM-79, SCRUM-120.

A hold has a future expiry before event start; exact-deadline expiry releases availability and must notify the Coordinator.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_venue_overlap.py::test_tc_79_03_expired_hold_releases_slot_at_exact_expiry_boundary` | passed (1 cases) |
| backend | `api/tests/test_booking_decision_route.py::test_tc_79_07_hold_with_past_or_late_expiry_is_rejected` | passed (1 cases) |

Acceptance: gap recorded.

- Expiry exists in the value object and expires_at storage, but no automatic release/notification worker or equivalent persisted expiry workflow is established. SQL raw status constraints still need expiry/concurrency parity review.

SQL assertions: `supabase/tests/venue_holds.sql`.

### W7-05 Event Coordinator Lead

Owner: Ernest; Marcus for role policy. Stories: SCRUM-130, SCRUM-131, SCRUM-54.

Lead assigns/reassigns from the unassigned queue. Coordinator list visibility is broader than permission to open/edit another Coordinator event, per D28.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_coordinator_assignment_acceptance.py::test_tc_130_04_coordinators_only_manage_events_assigned_to_them` | passed (1 cases) |
| backend | `api/tests/test_coordinator_assignment_acceptance.py::test_refusals_leave_the_assignment_unchanged` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |

Acceptance: gap recorded.

- Week 7 original own-events wording and later SCRUM-54 view-all decision require final owner acceptance of D28; list visibility must not be presented as edit permission.

SQL assertions: `supabase/tests/coordinator_assignment.sql`.

### W7-06 Operational safety check

Owner: Marcus; Jerome for Safety Officer access. Stories: SCRUM-127, SCRUM-128, SCRUM-145.

Safety Officer sees scoped resource details and approves Confirmed to Preparation or sends back with a reason. Other roles cannot bypass the gate.

| Layer | Executable check | Actual result |
| --- | --- | --- |
| backend | `api/tests/test_safety_officer_acceptance.py::test_safety_officer_reads_event_scoped_review_detail` | passed (1 cases) |
| backend | `api/tests/test_safety_check_route.py::test_request_changes_returns_event_to_planning_with_reason` | passed (1 cases) |
| backend | `api/tests/test_safety_check_route.py::test_non_safety_officer_cannot_submit_safety_check` | passed (1 cases) |
| integrated | `frontend/integration/event-lifecycle.spec.ts::INTEGRATED-01` | passed (1 cases) |

Acceptance: human acceptance pending.


SQL assertions: `supabase/tests/safety_officer.sql`.

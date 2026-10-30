# SCRUM 135 status transition enforcement

[SCRUM-135](https://spm-g6t4.atlassian.net/browse/SCRUM-135) closes the generic status route's approval bypass and terminal-state revival. The assigned Coordinator can still approve or reject an intake request, and the existing confirmation, safety, cancellation and completion actions retain their separate checks.

Owner: Jerome (current Jira assignee); Marcus for product/access-policy acceptance. Implementation is on feature/SCRUM-135-status-transitions, based on main 3f5131e. The user requested full implementation on 31 October 2026. Human review and merge are still separate gates.

## Workflow contract

Only a user whose stored role is Coordinator and whose ID equals the event's current coordinator_id may advance intake. Organiser ownership, attendee registration, staff participation and Lead oversight do not grant this authority.

| Current stored state | Generic status PATCH targets | Decision action |
| --- | --- | --- |
| Submitted | Assigned, Under review, Planning | Approve to Planning; reject with reason |
| Assigned | Under review, Planning | Approve to Planning; reject with reason |
| Under review | Planning | Approve to Planning; reject with reason |
| Approved legacy state | Planning | Approve to Planning; reject with reason |
| Draft | None | Submit through the Organiser draft form |
| Planning, Confirmed, Preparation | None | Use the applicable dedicated lifecycle action |
| Rejected, Cancelled, Completed | None | Terminal; no reopening |

The legacy display alias Under Review is understood by the Python value object; the database's existing status constraint stores Under review. Approved remains a supported legacy source, not a new target: current approval writes Planning directly. No-op updates and unknown stored states fail closed. A pending clarification must be resubmitted before intake can advance.

PATCH to Planning is an approval by the current assigned Coordinator and now records the same decision metadata, history and Organiser notification as POST /decision. Rejected must go through POST /decision with a reason; the status-only PATCH cannot bypass that requirement. Confirmation, Preparation, completion and cancellation cannot be set directly.

All non-Coordinator mutations are refused. Error responses contain no event data. Successful replies use the common event_response projection; existing Attendee reads remain restricted to public_event_view and map intake states to Planning. Coordinators retain their operational queue status.

## Persistence and concurrency

The backend-only transition_event_intake RPC locks the event and rechecks the stored actor role, current assignment, expected source state, allowed edge and pending clarification. It writes state, actor/time, approval/rejection metadata, history and notification in one transaction. It uses security invoker with an empty search path; PUBLIC, anon and authenticated have no EXECUTE permission.

A database trigger also refuses every status change out of Rejected, Cancelled or Completed. This protects against a stale dedicated action racing with closure. A terminal conflict is reported as HTTP 409. Illegal state or actor attempts through the transition handler are recorded in access_denied_log; audit logging retains the existing best-effort availability policy.

Apply supabase/migrations/20261030195932_scrum_135_status_transitions.sql before deploying the new backend. It is additive and replay-safe. No hosted database was changed during implementation.

## Acceptance criteria and evidence

| Jira acceptance criterion | Verification |
| --- | --- |
| Illegal role/from/to combinations denied and logged | Pure transition tests plus real password-session tests across all seven roles, related-but-unassigned Coordinator, unchanged event/history/notification snapshots and denial records |
| Rejected, Cancelled and Completed cannot revive | HTTP matrix tests, direct SQL terminal-write rejection and cancellation between HTTP check and database write |
| Attendee, Venue Staff and Tech Support cannot mutate | Real sessions with deliberate event membership; attendee-safe read continues after refusal; existing registered-attendee regression retained |
| No internal data exposed to non-privileged callers | Mutation responses contain no event; real Attendee GET asserts public-field whitelist and Planning display mapping |
| Dedicated gates remain enforced | Direct status requests to Confirmed/Preparation/Completed/Cancelled denied; existing real-browser lifecycle journeys exercise successful dedicated actions |
| Valid review still works | Assigned Coordinator forward steps, decision actor/time, one history record per step and exactly one Organiser notification; reasoned rejection from review |
| Failure and race handling | Two concurrent approvals commit once; reassignment or cancellation after precheck is refused; pending clarification blocks; injected notification failure rolls back state/history; safe RPC failure mapping |

Runnable checks: api/tests/test_event_transition.py, test_status_transition_acceptance.py, test_status_transition_failures.py, existing test_event_status.py/test_event_decisions.py and release-security tests; supabase/tests/status_transitions.sql; frontend/integration/event-lifecycle.spec.ts. Final execution results are recorded in docs/testing/scrum-135-verification.json.

## Reviewable existing test changes

Two existing tests in test_event_status.py formerly approved as Organiser 1. That behaviour is the bug SCRUM-135 removes. They retain their names and all actor/time/history assertions, but now use assigned Coordinator 2; the new real-database suite explicitly denies the former Organiser action.

The event persistence double gained the new RPC and its audit/notification outputs. The equipment-request acceptance fixture now deletes its own denial-log rows before deleting fixture events, because newly required denial logging otherwise leaves a foreign-key reference and contaminates later registration tests. No assertion was removed. The disposable SQL harness grants audit-log deletion for cleanup only; production privileges remain unchanged.

## Scope and review ownership

Delegated work is the SCRUM-135 contract above, constrained by Jira acceptance criteria, existing dedicated actions and repository architecture. A pure value object owns the rule; repository and SQL own I/O and concurrency. Human review must assess the allowed matrix, rejection routing, legacy-state compatibility, database privileges, test changes and acceptance evidence before merge. Jerome owns implementation acceptance; Marcus owns access-policy/release decisions.

This does not implement booking reassignment permissions, venue outage recovery, capacity/date readiness revalidation or missing navigation from the separate flow audit. Those defects need their own fixes and must not be marked resolved by SCRUM-135.

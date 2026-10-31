# E2E Traceability Matrix (Sprint 4 closeout)

Maps each Release-1 core feature + its key conflict/failure scenarios to the Playwright
e2e spec that exercises it. E2e "coverage" is **traceability completeness**, not a percentage:
every row should reach ✅ before code freeze. This file is our test-evidence artifact
(submission folder 3) — **it is not a new Definition of Done**, it records the e2e proof
for work that is already built/being fixed.

**How to use:** when you add or extend a spec for your row, update its **Status** (and spec
file) in the *same PR as the fix*. Owner does a final sweep at freeze — any row not ✅ is a gap.

**Status legend:** ✅ spec exists & asserts the behaviour · 🔶 spec exists, needs the scenario added / depth check · ❌ no spec yet
**Freeze target:** Sat 31 Oct 23:59 · **Matrix owner:** Marcus

| # | Feature | Key scenario (incl. conflict/failure) | e2e spec | Status | Owner |
|---|---------|----------------------------------------|----------|--------|-------|
| 1 | Auth / RBAC | Login + role switch | `login-entry.spec.ts` | ✅ | — |
| 1 | Auth / RBAC | **Attendee/Venue/Tech CANNOT change status or see internal fields** (SCRUM-135) | `event-status.spec.ts` (extend) | ❌ | Jerome |
| 2 | Event request creation | Organiser creates + submits | `events.spec.ts` | ✅ | — |
| 3 | Draft requests | Save + resume + submit draft | `drafts.spec.ts` | ✅ | — |
| 4 | Review & approval | Coordinator approve / reject (+ reason required on reject) | `event-decision.spec.ts` | ✅ | Marcus |
| 4 | Review & approval | Request clarification / amendment | `events.spec.ts` (return for clarification) | ✅ | Marcus |
| 5 | Coordinator assignment | Submission enters the Lead's unassigned queue (SCRUM-130 replaced auto-assign) | `coordinator-assignment.spec.ts` (TC-130-01/02) | ✅ | Ernest |
| 5 | Coordinator assignment | Lead reassign from queue; closed events cannot be moved | `coordinator-assignment.spec.ts` (TC-130-03) | ✅ | Ernest |
| 6 | Event status mgmt | Lifecycle Planning→Confirmed→Completed view | `event-status.spec.ts` | ✅ | — |
| 7 | Event info mgmt | Edit during Planning | `event-decision.spec.ts` (coordinator Planning edit) | ✅ | Marcus |
| 7 | Event info mgmt | **Impactful change flagged vs ordinary edit** (SCRUM-58) | `change-request-apply.spec.ts` (significant vs ordinary) | ✅ | Marcus |
| 8 | Venue catalogue | Add / update / retire + full record + layouts | `venues.spec.ts`, `venue-edit.spec.ts` | 🔶 | Jessica |
| 9 | Venue availability calendar | Availability + blocked periods | `venue-calendar.spec.ts` | ✅ | — |
| 10 | Venue search & filter | Filter by date/capacity/facility/etc | `venues.spec.ts` *(verify)* | 🔶 | Jessica |
| 11 | **Venue suitability** | **Unsuitable on facility/accessibility/layout, not just capacity** (SCRUM-116/117) | NEW `venue-suitability.spec.ts` | ❌ | Jessica |
| 12 | Venue booking request | Coordinator requests venue from Planning event | `bookings.spec.ts` | ✅ | — |
| 13 | Venue booking approval | **Approve blocks the slot + notifies coordinator** (SCRUM-118/119) | `bookings.spec.ts` (extend) | 🔶 | Jessica / Marcus |
| 14 | Booking conflict detection | **Overlapping / buffered double-book hard-blocked** (SCRUM-137) | `bookings.spec.ts` (extend) | 🔶 | Jessica |
| 15 | Equipment request mgmt | Record + review/update request | `equipment-requests.spec.ts`, `equipment-request-status.spec.ts` | ✅ | — |
| 16 | Equipment availability | **Unavailable/damaged excluded from available** (SCRUM-63) | `equipment.spec.ts` (extend) | 🔶 | Ernest |
| 17 | Equipment reservation | Reserve reduces availability; **confirm blocked while equipment pending** (SCRUM-136) | `event-confirm.spec.ts`, `event-confirm-equipment.spec.ts` | ✅ | Ernest |
| 18 | Attendee registration | Register / withdraw / view own status | `attendee-registration.spec.ts` + 3 | ✅ | — |
| 18 | Attendee registration | **Organiser/Coordinator view event registrations** (SCRUM-45) | NEW / extend | ❌ | Jerome |
| 19 | Event change requests | Raise change post-submit/confirm | `change-requests.spec.ts` | ✅ | — |
| 19 | Event change requests | **Significant change re-opens venue/equipment review + notifies** (SCRUM-47/62) | `change-requests.spec.ts` (extend) | 🔶 | Ernest |
| 20 | Notifications | **Fires on submit/decision/assignment/booking/registration/change/cancel** (SCRUM-51) | `notifications.spec.ts` (decision + pool feeds), `change-request-apply.spec.ts` (change re-review), `event-cancel.spec.ts` (attendees notified) | ✅ | Marcus |
| — | Safety check | Gates preparation until passed | `event-safety-check.spec.ts`, `safety-officer.spec.ts` | ✅ | — |
| — | Confirm / complete | Confirm + complete/close event | `event-confirm.spec.ts`, `event-complete.spec.ts` | ✅ | — |

> 🔶 rows: open the named spec and confirm it actually asserts the scenario (not just the happy path) before ticking ✅. ❌ rows: no spec yet — write it as part of the fix.

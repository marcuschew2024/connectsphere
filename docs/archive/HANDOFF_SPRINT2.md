# HANDOFF — Sprint 2 (Marcus's stories)

_Last updated: 2026-09-27. Read this first when continuing Sprint 2._

## Where things stand
- `main` is up to date; the **UI revamp is merged** (PR #13, SCRUM-125 Done). Git tree clean.
- We follow the **Jira board as source of truth** (un-split stories), not the earlier Confluence split.

## Marcus's committed Sprint 2 work (11 pts)
| Jira | Story | Pts | Status |
| --- | --- | --- | --- |
| SCRUM-32 | Booking approval: decision + reason + audit | 3 | In Progress |
| SCRUM-30 | Venue availability calendar | 8 | To Do (blocked) |

**SCRUM-32 sub-tasks:** SCRUM-121 BE · SCRUM-122 FE · SCRUM-123 Test (In Progress) · SCRUM-124 Review.

## Done so far
- **`BookingDecision`** domain class + **11 unit tests** committed on branch **`feature/SCRUM-32-booking-approval`** (commit `987f7d2`, local — not pushed).
  Files: `api/app/booking_decision.py`, `api/tests/test_booking_decision.py`. All green.
- Confluence **"Test Cases — US-6.6 Booking approval (SCRUM-32)"** (page id 7602177) with 9 cases (TC-32-01..09).
- Jira sub-tasks created; blocker links set (SCRUM-31 blocks SCRUM-121 and SCRUM-30).

## The blocker
Everything downstream needs the shared **`venue_bookings` table**, owned by **Ernest's SCRUM-31** (submit booking request) + **SCRUM-33** (overlap engine). SCRUM-121 (BE), SCRUM-124 (review), and SCRUM-30 (calendar) are blocked until it lands. **Raise at daily scrum.**

## Unblocked next steps (do these without the table)
1. **Acceptance-test skeleton** for TC-32-05..09 (audit, notify, conflict block, boundaries) as `@pytest.mark.skip`-guarded stubs mirroring `api/tests/test_request_acceptance.py`. Documents the spec now; flips on once the table exists.
2. **Draft `venue_bookings` schema + a short ADR** to take to Ernest (this unblocks everyone). Proposed contract:
   - `POST /venues/bookings/{id}/decision` body `{ decision: "approve"|"reject", reason?, alternative? }`
   - approve → status `Confirmed`, slot blocked to conflicts (reuse SCRUM-33 overlap); reject → `Rejected`, reason required
   - record `decided_by` + `decision_at` (audit); notify Coordinator; **409** if already decided; **403** if not Venue Staff
   - table needs: `status`, `decided_by`, `decision_at`, `decision_reason`, `suggested_alternative` (+ slot fields from SCRUM-31)
   - enforce no-double-book at the DB with `EXCLUDE USING gist` on a `tstzrange` (shared with SCRUM-33)
3. **FE decision UI (SCRUM-122)** against a mocked API contract (in the new shadcn design system — see `docs/UI_DESIGN_SYSTEM.md`).

Mirror the existing event flow: `api/app/event_decision.py`, `api/app/notifications.py`, `api/tests/test_request_acceptance.py` are the closest templates.

## Environment / coordinates
- API on **5001** (`cd api && source .venv/bin/activate && flask --app app run`); frontend `cd frontend && npm run dev` → 3000. **Do not use port 5000** (macOS AirPlay).
- Branch for this work: `feature/SCRUM-32-booking-approval`.
- Jira: site `spm-g6t4`, project `SCRUM`, cloudId `0a7de199-d390-4b60-b2af-b8b5be155e3f`. Confluence space key `CS`.
- Supabase project `pqdkfrvqjeqlsdwvddcd` (read-only MCP for verification).

## Working agreements (IS212)
- **TDD / test-cases-before-code**; small per-file increments; **explain every piece** (Week-13 Q&A accountability).
- Keep **Jira updated** (start → In Progress, merge → Done) without being asked.
- **Never merge/push without instruction**; merge only behind green CI (lint + build + e2e).
- Sub-task assignee follows the parent story's owner.

# SCRUM-120: Double-booking â€” Tentative Hold + FCFS (Confirmed Beats Hold)

## Story Overview
- **ID:** SCRUM-120
- **Title:** Double-booking: tentative hold + FCFS (confirmed beats hold)
- **Actor:** Venue Staff / System
- **Sprint:** Sprint 4 (Split from SCRUM-33; chain: `129 -> 79 -> 120 -> 60`)
- **Branch:** `feature/scrum-120-double-booking-tentative-hold-fcfs`

## Customer Acceptance Criteria
1. Only one tentative hold per venue/slot (S1 Q3, Q17, Q31).
2. A confirmed booking (FCFS) beats a hold â€” the confirmed booking wins regardless of which arrived first in wall-clock time.
3. Blocked/maintenance periods count as unavailable for both new requests and confirmations.

## Design & Architecture

### Domain Engine (`api/app/venue_overlap.py`)

**`BookingInterval` dataclass** â€” added `requested_at: datetime | None = None` field.
- Populated by `from_record()` which reads `record.get("requested_at")` and converts it to UTC.
- Used as the FCFS tie-breaker: when two bookings share the same status tier, the one with the earlier `requested_at` takes precedence.

**`_highest_priority()` â€” rewritten FCFS sort key:**
- Status rank: `HARD_STATUSES` (Confirmed, Blocked, Cancelled) â†’ 0, `Held` â†’ 1, `Requested/Pending` â†’ 2.
- Within the same rank, sorts by `requested_at` (earliest first), then `start_at` (earliest first) as a secondary tie-breaker.
- Effect: a `Confirmed` booking always sorts before any `Held`, which sorts before any `Requested`; the FCFS rule is the natural outcome of the status ranking (not a special case).

**`can_confirm` logic (unchanged):**
- Returns `True` when the only conflicting booking is tentative (`status in ("Requested", "Pending", "Held")`).
- This already satisfies AC2 â€” a confirmed booking is allowed to proceed over a hold.

### Repository (`api/app/booking_repository.py`)

- `find_overlapping_bookings()` select string extended from `"id,venue_id,start_at,end_at,status,expires_at"` to `"id,venue_id,start_at,end_at,status,expires_at,requested_at"`.
- Without this change `requested_at` was `None` for all bookings, making FCFS tie-breaking impossible.

### Frontend (`frontend/src/lib/availability.ts`)

- `classifyCell()` tentative branch updated: `b.status === "Requested" || b.status === "Pending" || b.status === "Held"`.
- Previously `Held` bookings were invisible in the availability calendar; now they display as amber "Tentative hold".

### Database layer (no new migration)

All three ACs are enforced at the DB level by existing constraints (created in SCRUM-33 and SCRUM-79):

| Constraint | Enforces |
|---|---|
| `venue_bookings_no_overlap_hard` | Hard bookings (Confirmed/Blocked) cannot overlap â€” AC3 |
| `venue_bookings_one_tentative_hold` | Only one Requested/Pending/Held per slot â€” AC1 |

The application layer implements AC2 (FCFS): it approves the confirmation over the hold, then the hold must be manually superseded/cancelled (see trade-off below).

## Test Case Register & Traceability

### Unit tests (`api/tests/test_venue_overlap.py`)

| ID | Description | AC |
|---|---|---|
| TC-120-01 | Only one tentative hold per venue/slot â€” second `Held` blocked by engine | AC1 |
| TC-120-02 | Confirmed booking (FCFS) beats tentative hold â€” `can_confirm` is `True` | AC2 |
| TC-120-03 | Blocked/maintenance period counts as unavailable for both request and confirmation | AC3 |
| TC-120-04 | FCFS tie-breaker â€” earliest `requested_at` wins when both bookings have the same status rank | AC2 |
| TC-120-05 | `Held` status takes priority over un-held `Requested` status in `_highest_priority` | AC1 |
| TC-120-06 | Confirmed beats both `Held` and `Requested` in priority sort | AC2 |

### Integration tests (`api/tests/test_booking_decision_route.py`)

| ID | Description | AC |
|---|---|---|
| TC-120-route-01 | `POST /bookings/<id>/decide approve` with an existing `Held` conflict succeeds (FCFS) | AC2 |
| TC-120-route-02 | `POST /bookings/<id>/decide approve` with an existing `Blocked` conflict returns 409 | AC3 |

### Database constraint tests (`supabase/tests/venue_fcfs.sql`)

| # | Description | AC |
|---|---|---|
| DB-120-01 | Confirmed + Held coexist on same slot (FCFS coexistence allowed by constraint tier split) | AC2 |
| DB-120-02 | Second Held/Requested on same slot blocked by `venue_bookings_one_tentative_hold` | AC1 |
| DB-120-03 | Blocked row prevents Confirmed booking on same slot (`venue_bookings_no_overlap_hard` fires) | AC3 |

## No Schema Migration

No new columns or constraints are required. `requested_at` already exists on `venue_bookings` (populated when a booking is first created). All required DB constraints were created in `create_venue_bookings.sql` (SCRUM-33) and `20261029170000_scrum_79_tentative_venue_holds.sql` (SCRUM-79).

## Reviewer Checklist (AGENTS.md five questions)

1. **What was delegated?** SCRUM-120 â€” FCFS precedence rule in the overlap engine, `requested_at` flowing into the domain, `Held` display in the calendar. Acceptance criteria: one hold per slot, confirmed beats hold, blocked is unavailable.
2. **What constrained the agent?** Existing DB constraint structure (SCRUM-33/79), `api/AGENTS.md` value-object rules (no DB/Flask in domain), Q&A S1 Q3/Q17/Q31/Q44.
3. **What evidence supports it?** 6 new unit tests (TC-120-01–06), 2 new integration tests (TC-120-route-01–02), 3 DB constraint tests (DB-120-01–03), and full branch/statement boundary tests achieving **100% statement and 100% branch coverage** on `api/app/venue_overlap.py` (106 stmts, 38 branches, 0 missed). All pass alongside the existing suite. Ruff and ESLint: 0 errors.
4. **Where is human review needed?** The FCFS resolution policy (confirmed beats hold) is a domain rule. The decision not to auto-cancel superseded holds (S1 Q44) means a held booking that loses FCFS must be manually cancelled â€” this trade-off should be validated by the product owner.
5. **Who is accountable?** Jerome (SCRUM-120 owner).

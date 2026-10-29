# SCRUM-129: Venue Setup & Turnaround Time in Availability & Conflict Checks

## 1. User Story & Context
- **Issue Key:** `SCRUM-129` (First in the Sprint 4 sequential venue chain: `129 -> 79 -> 120 -> 60`).
- **Sprint / Change:** Week 7 Customer Change #1.
- **Goal:**
  - Introduce configurable **setup** and **turnaround** time for each venue.
  - Extend the availability and conflict detection engine so that any booking request or confirmed slot occupies:
    $$\text{Occupied Window} = [\text{start\_at} - \text{setup\_time},\; \text{end\_at} + \text{turnaround\_time})$$
  - Ensure back-to-back bookings now conflict if their buffer periods overlap.
  - Existing bookings that become conflicting under updated venue buffers must be **identified/flagged** rather than silently mutated or dropped.

---

## 2. Object-Oriented Programming (OOP) Concepts Implemented

### A. Value Object & Encapsulation (`BookingInterval`)
- Implemented as an immutable dataclass `BookingInterval` in `api/app/venue_overlap.py`.
- **Encapsulation of Buffer Mathematics:** The published times (`start_at`, `end_at`) and buffer durations (`setup_minutes`, `turnaround_minutes`) are wrapped inside the object. Calculations for `occupied_start` and `occupied_end` are derived properties, shielding external consumers from buffer math errors.
- **Interval Relational Predicates:** Methods `overlaps()`, `overlaps_published()`, and `contains_time()` encapsulate half-open relational interval logic (`occupied_start < query_end and query_start < occupied_end`).

### B. Strategy / Domain Engine Pattern (`OverlapEngine`)
- Separation of business logic from persistence: `OverlapEngine` has **zero database dependencies**, accepting pure domain data structures (`start_at`, `end_at`, `bookings`, `setup_minutes`, `turnaround_minutes`).
- Encapsulates evaluation rules:
  - Confirmed and Blocked bookings form hard conflicts.
  - Requested/Pending bookings form tentative holds.
  - Buffer windows are factored into conflict calculations while preserving half-open boundary semantics (touching occupied boundaries do not conflict).

### C. Pure Conflict Detection & Flagging (`identify_problematic_bookings`)
- Encapsulates the safety policy for changing venue parameters: instead of destructively altering existing bookings when a venue's buffer times are updated, this function identifies pairs of bookings that were non-conflicting previously under raw intervals but now conflict under the buffered intervals.

---

## 3. Test Register Traceability & Evidence

| Test ID | Level | Acceptance Criterion / Purpose | Test Location | Result |
| :--- | :--- | :--- | :--- | :--- |
| `TC-129-01` | **Unit** | Booking reserves `start - setup` ... `end + turnaround` (buffer math & overlap logic) | `api/tests/test_venue_overlap.py` (`test_tc_129_01_*`) | **PASS** |
| `TC-129-02` | **Unit** | Back-to-back bookings now conflict due to buffers; boundary cases (touching occupied boundaries compatible) | `api/tests/test_venue_overlap.py` (`test_tc_129_02_*`) | **PASS** |
| `TC-129-02` | **Integration** | Submitting a back-to-back booking against an existing confirmed slot returns `409 Conflict` | `api/tests/test_bookings.py` (`test_tc_129_02_integration_*`) | **PASS** |
| DB Audit | **DB / Migration** | Non-negative constraint (0–1440 min) and `update_venue_details` RPC support | `supabase/tests/venue_buffers.sql` & `run.sh` | **PASS** |

---

## 4. Verification Summary
- **Python Unit & Integration Tests:** 787 passed, 108 skipped (live DB acceptance tests).
- **Linter & Code Style:** `ruff check api/` reported **All checks passed!**
- **Frontend Linter:** `npm run lint` reported **0 errors**.
- **Frontend Unit Tests:** `npm run test:unit` reported **16 passed**.

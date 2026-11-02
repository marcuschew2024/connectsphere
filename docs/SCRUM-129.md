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

> **Correction (2 Nov 2026).** As originally delivered this function had **no production
> caller** — it was exercised only by unit tests — and `problematic_venue_bookings` had no
> reader, so AC3 ("existing bookings that become conflicting are IDENTIFIED/flagged") had
> no runtime surface. The audit recorded this as R6. It is now wired up: see the section
> below and Decision Log D60.

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

---

## 5. AC3 closure (2 Nov 2026) — Decision Log D60

AC3 is now implemented end to end, computed on demand:

| Layer | What |
| --- | --- |
| Detector (pure) | `OverlapEngine.identify_problematic_bookings` — unchanged, now also skipping expired holds |
| Composition | `api/app/venue_buffer_conflicts.py` — repository read, shaping, and `buffers_changed` |
| API | `PUT /venues/<id>` returns `buffer_conflicts` when a buffer actually changed; `GET /venues/<id>/buffer-conflicts` (Venue Staff) reads it any time |
| UI | The venue save confirmation lists both sides of each clash and states that nothing was changed or cancelled |

Pairs that already overlapped on their published times are excluded — they are not a
consequence of the buffer change. Nothing writes to a booking, which is asserted directly
by `test_the_report_never_writes_to_a_booking`.

**Why not the `problematic_venue_bookings` table:** it is created by SCRUM-137's migration,
which the audit reports has not successfully applied to the connected database and whose
insert is rolled back by the `raise exception` in the same transaction. That defect belongs
to SCRUM-137. Computing on demand makes AC3 true regardless of how that lands; the table
remains the durable home for the same facts once it works.

### Added tests

`api/tests/test_venue_buffer_conflicts.py` — 22 tests: the AC's own 10:00–12:00 / 12:00–14:00
example, buffer-only versus pre-existing overlap, distant slots, held bookings, the report
shape, the save that triggers it and a save that does not, the read endpoint, an unknown
venue, role refusal, and the no-mutation guarantee. 100% statement and branch coverage on
`api/app/venue_buffer_conflicts.py`.

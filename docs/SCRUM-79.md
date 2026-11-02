# SCRUM-79: Tentatively Hold a Venue

## Story Overview
- **ID:** SCRUM-79
- **Title:** Tentatively hold a venue
- **Actor:** Venue Staff
- **Sprint:** Sprint 4 (Chain: `129 -> 79 -> 120 -> 60`)

## Customer Acceptance Criteria (including Week 7 Change #4)
1. Venue Staff can place a tentative hold on a venue/slot while an event is finalised.
2. Only one hold per venue/slot; a confirmed booking (FCFS) overrides a hold (S1 Q3, Q17, Q31).
3. Each hold has an expiry date/time.
4. If the required action is not completed before the deadline, the hold expires and the venue becomes available for other requests.
5. The Event Coordinator is informed before or when the hold expires.
6. An expired hold is not treated as a confirmed booking.

## Design & Architecture (Value Object & Strategy Pattern)
- **Domain Engine (`api/app/venue_overlap.py`):**
  - Extended `BookingInterval` with `expires_at: datetime | None` and `is_expired(as_of) -> bool`.
  - In `OverlapEngine`, active holds (`status in ('Requested', 'Pending', 'Held')`) block new requests unless expired.
  - Precedence rule: confirmed bookings override tentative holds (`can_confirm` is `True` when only a tentative hold conflicts).
- **Decision Value Object (`api/app/booking_decision.py`):**
  - Added action `"hold"` which transitions booking to `"Held"` with an `expires_at` timestamp.
  - Added `is_hold` property.
- **Database (`supabase/`):**
  - Migration `20261029170000_scrum_79_tentative_venue_holds.sql` adds `expires_at timestamptz` column and updates constraints.
- **Notifications (`api/app/bookings.py`):**
  - Informs Coordinator when a booking is tentatively held with its expiry deadline.
- **Frontend (`frontend/`):**
  - Updated `BookingStatus` type in `src/lib/bookings.ts` with `"Held"` and `"Expired"`.
  - Added "Tentatively hold" decision button and customizable hold duration input in `booking-decision-form.tsx`.

## Test Case Register & Traceability
- **TC-79-01:** Confirmed booking overrides tentative hold (unit) — `api/tests/test_venue_overlap.py`
- **TC-79-02:** Only one hold per venue/slot; second hold blocked (unit) — `api/tests/test_venue_overlap.py`
- **TC-79-03:** Expired hold releases slot and does not block new requests (unit) — `api/tests/test_venue_overlap.py`
- **TC-79-04:** Venue Staff can place a tentative hold with expiry (integration) — `api/tests/test_booking_decision_route.py`
- **TC-79-05:** Coordinator cannot place a hold (RBAC 403) — `api/tests/test_booking_decision_route.py`
- **TC-79-06:** Hold with valid custom expiry timestamp — `api/tests/test_booking_decision_route.py`
- **TC-79-07:** Hold with past or post-start expiry is rejected (400) — `api/tests/test_booking_decision_route.py`

## Release-1 gap closure (2 Nov 2026) — Decision Log D56

The audit (R2) found the hold lifecycle incomplete. Four defects, now fixed:

| # | Defect | Fix |
| --- | --- | --- |
| 1 | `OverlapEngine` applied `is_expired()` **before** classifying status, so a booking approved while `Held` stopped occupying its slot once its old deadline passed — a confirmed venue could be given away. | Expiry applies to `TENTATIVE_STATUSES` only. |
| 2 | Approving a hold left `expires_at` set. | The decision clears it (`clear_expiry`), and the database trigger nulls it on any confirmation. |
| 3 | Nothing ever wrote `Expired`: the status existed only in the CHECK constraint and the frontend badge. | `venue_hold_expiry.release_expired_holds` sweeps lapsed holds and notifies the Coordinator; a `before insert or update` trigger is the database backstop. |
| 4 | A `Held` booking was a dead end in the UI — absent from the Venue Staff queue and from the availability calendar, and its decision form was hidden. | The queue and calendar include `Held`; the decision form stays available while held and shows the deadline. |

> **Found in manual verification.** The decision *form* and the booking *page* each had
> their own status gate. Fixing only the form left the page still hiding it, and the
> component-level unit test passed throughout because it renders the form directly. The
> page gate (`canReview`) is now fixed and covered by a page-level test that fails against
> the original gate. The API already accepted a decision on a held booking — the dead end
> was presentation, not authorisation.

Why both an application sweep and a database trigger: an exclusion-constraint predicate
must be IMMUTABLE and `now()` is not, so expiry cannot live in the `EXCLUDE` predicate.
Moving the row to `Expired` — a status in no exclusion predicate — frees the slot instead.
The row is always kept (S1 Q23).

### Added tests

| ID | Level | Criterion | Location |
| --- | --- | --- | --- |
| TC-79-08 | Unit | A confirmed booking with a stale deadline still blocks | `api/tests/test_venue_overlap.py` |
| TC-79-09 | Unit | A blocked period with a stale deadline still blocks | `api/tests/test_venue_overlap.py` |
| TC-79-10 | Unit | An expired hold is not reported as a buffer conflict | `api/tests/test_venue_overlap.py` |
| TC-79-11 | Unit | Expiry rules, notice text and recipient; the sweep and its failure paths (27 tests) | `api/tests/test_venue_hold_expiry.py` |
| TC-79-12 | Integration | A held booking can still be approved or rejected | `api/tests/test_booking_decision_route.py` |
| TC-79-13 | Integration | Approving a hold clears its deadline; rejecting keeps it | `api/tests/test_booking_decision_route.py` |
| TC-79-14 | Database | The slot becomes requestable, the row survives as `Expired`, a live hold still blocks | `supabase/tests/venue_hold_release.sql` |
| TC-79-15 | Frontend | A held booking offers approve/reject and names its deadline | `frontend/src/app/venues/bookings/[bookingId]/decision-boundaries.test.tsx` |

TC-79-08/09/10 fail against the previous engine (verified). AC 5 is satisfied at the moment
of expiry; the customer's wording ("before **or when**") permits this and no scheduler
exists for "before".

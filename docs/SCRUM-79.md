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

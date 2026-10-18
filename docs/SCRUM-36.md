# SCRUM-36: Check Equipment Availability

## Overview
SCRUM-36 delivers the reusable domain engine, backend endpoints, and frontend verification interface for checking equipment availability for given time windows and requested quantities.

It fulfills the team's Sprint 3 design note:
> *"Equipment availability (36) and reservation (37) reuse the same rules/overlap engine built for venues in Sprint 2 (SuitabilityEngine + double-booking overlap). Jessica builds; Marcus reviews the design."*

---

## Acceptance Criteria Traceability

| Acceptance Criteria | Implementation Detail | Automated Test Coverage |
| :--- | :--- | :--- |
| **AC1:** For a given date/time and quantity, the system shows how many units of an item are available (total minus reserved for overlapping events minus unavailable). | `EquipmentAvailabilityEngine.check_availability()` calculates: `usable_stock - overlapping_reserved`. | `test_availability_calculation_formula_no_reservations`, `test_availability_calculation_with_overlapping_reservations` in `api/tests/test_equipment_availability.py`. |
| **AC2:** Equipment committed to an overlapping incompatible event is not counted as available. | Reuses `[start, end)` half-open interval overlap policy matching `OverlapEngine`. Adjacent slots do not conflict; committed statuses (`Reserved`, `Pending`) deduct stock. | `test_overlapping_incompatible_event_not_counted_as_available`, `test_touching_boundary_slots_do_not_overlap` in `api/tests/test_equipment_availability.py`. |
| **AC3:** Given 5 projectors all reserved for an overlapping event, availability shows 0. | Exact scenario verification: When 5 out of 5 total units are reserved in the slot, available quantity calculates to 0 and `is_sufficient` is `False`. | `test_ac3_given_5_projectors_all_reserved_availability_shows_zero` in `api/tests/test_equipment_availability.py`. |

---

## OOP Architecture & Design Patterns

### 1. Strategy Pattern (`AvailabilityCalculator`)
- **Abstract Base Class (`AvailabilityCalculator`):** Defines the contract `check_availability()` using Python's `abc.ABC`.
- **Concrete Implementation (`EquipmentAvailabilityEngine`):** Encapsulates the specific stock-deduction algorithm. This matches the extensible architecture used by `SuitabilityRule` in [`api/app/venue_suitability.py`](api/app/venue_suitability.py).

### 2. Domain Value Objects
- **`EquipmentReservationInterval` (frozen dataclass):** Encapsulates a reservation's time interval and status. Contains the pure domain method `overlaps(start, end)` using half-open intervals (`[start, end)`).
- **`EquipmentAvailabilityResult` (frozen dataclass):** Encapsulates the immutable calculation outcome (`total_quantity`, `usable_quantity`, `reserved_quantity`, `available_quantity`, `is_sufficient`, `overlapping_reservations_count`).

### 3. Separation of Concerns & Clean Architecture
- **Pure Domain (`equipment_availability.py`):** 0% database dependencies. Can be tested completely in memory with zero I/O.
- **Repository Layer (`equipment_repository.py`):** Handles database queries (`get_reservations_for_window`) with proper error translation.
- **Presentation Layer (`equipment.py`):** REST API endpoint `GET /equipment/<id>/availability` validating user role and input parameters before calling the domain engine.

---

## API Specification

### `GET /equipment/<uuid:equipment_id>/availability`
- **Access:** Tech Support, Event Coordinator
- **Query Parameters:**
  - `start_at` (ISO 8601 string, required)
  - `end_at` (ISO 8601 string, required)
  - `quantity` (positive integer, default: 1)
- **Response `200 OK`:**
  ```json
  {
    "availability": {
      "equipment_id": "11111111-1111-4111-8111-111111111111",
      "equipment_type": "Wireless microphone",
      "total_quantity": 8,
      "operational_status": "Operational",
      "usable_quantity": 8,
      "reserved_quantity": 2,
      "available_quantity": 6,
      "requested_quantity": 3,
      "is_sufficient": true,
      "overlapping_reservations_count": 1,
      "start_at": "2099-10-20T10:00:00Z",
      "end_at": "2099-10-20T12:00:00Z"
    }
  }
  ```

# SCRUM-37: Reserve Equipment

## Overview
SCRUM-37 implements equipment reservation functionality, building directly on the Sprint 3 design note:
> *"Equipment availability (36) and reservation (37) reuse the same rules/overlap engine built for venues in Sprint 2 (SuitabilityEngine + double-booking overlap). Jessica builds; Marcus reviews the design."*

It allows Technical Support to reserve units of available equipment for an event, automatically preventing over-reservation beyond stock or conflicting overlaps, and automatically releasing reserved units if an event is cancelled.

---

## Acceptance Criteria Traceability

| Acceptance Criteria | Implementation Detail | Automated Test Coverage |
| :--- | :--- | :--- |
| **AC1:** Only available equipment (not Damaged/Maintenance, not reserved for an overlapping slot) can be reserved. | `EquipmentReservationEngine.evaluate_reservation()` verifies condition is Operational and invokes `EquipmentAvailabilityEngine.check_availability()` to ensure zero conflict. | `test_scrum37_damaged_or_maintenance_cannot_be_reserved` in `api/tests/test_equipment_availability.py`. |
| **AC2:** Reserving reduces available quantity; over-reservation beyond stock is blocked. | When requested quantity exceeds available quantity, `ReservationDecision.deny()` is returned and the API responds with `409 Conflict`. | `test_scrum37_over_reservation_blocked` in `api/tests/test_equipment_availability.py`; `test_reserve_equipment_over_reservation_returns_409` in `api/tests/test_equipment.py`. |
| **AC3:** Reservation linked to the event and released automatically if the event is cancelled. | `event_id` is linked on the reservation. An automated trigger `trg_release_equipment_on_event_cancel` in PostgreSQL and backend lifecycle logic in `api/app/events.py` sets status to `'Released'` on event cancellation. | Covered by database trigger in `supabase/create_equipment_reservations.sql` and `release_equipment_reservations_for_event()` in `equipment_repository.py`. |
| **AC4:** Recorded with actor + timestamp. | Authenticated `created_by` (Tech Support actor ID) and `created_at` (current UTC timestamp) are recorded in `equipment_reservations`. | Verified in API route `POST /equipment/<id>/reservations` and `test_reserve_equipment_endpoint_success`. |

---

## OOP Architecture & Patterns (SCRUM-37)

### 1. Strategy Pattern (`ReservationPolicy`)
- **Abstract Base Class (`ReservationPolicy`):** Defines the contract for validating and making reservations:
  ```python
  class ReservationPolicy(ABC):
      @abstractmethod
      def evaluate_reservation(...) -> ReservationDecision:
          pass
  ```
- **Concrete Engine (`EquipmentReservationEngine`):** Implements `ReservationPolicy` and composes `AvailabilityCalculator` via **Dependency Injection**.

### 2. Value Object (`ReservationDecision`)
- Decorated with `@dataclass(frozen=True)` to enforce immutability.
- Provides factory constructors `ReservationDecision.permit(...)` and `ReservationDecision.deny(...)` to encapsulate outcome state and clear error messages.

### 3. Open/Closed Principle & Code Reuse
- Rather than reimplementing overlap interval checks, `EquipmentReservationEngine` directly reuses `EquipmentAvailabilityEngine` (SCRUM-36) and `EquipmentReservationInterval`.

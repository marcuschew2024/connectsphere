# SCRUM-32 — Booking Approval: C4 Code-level design

_C4 "Code" level (Week 5) for the booking-approval feature. Diagrams are kept as Mermaid
text so they diff in PRs and evolve with the code. Structure = class diagram; behaviour =
sequence diagram._

- **Story:** SCRUM-32 (Venue Staff approve/reject a submitted booking) · Epic SCRUM-6
- **Owner:** Marcus · **Consumes:** SCRUM-33 overlap engine (not implemented here)
- **Scope boundary:** the double-booking check is **SCRUM-33's OOP-reuse story**. This design
  *delegates* to it (an external call) and does **not** implement overlap logic here.

---

## 1. Class diagram (structure)

```mermaid
classDiagram
    class BookingDecision {
        +str action
        +str reason
        +str alternative
        -dict _STATUSES
        +__init__(action, reason, alternative)
        +from_payload(data) BookingDecision$
        +status() str
        +is_rejection() bool
    }
    note for BookingDecision "Value object (SCRUM-123).\nEncapsulation: all validation in __init__.\nAbstraction: models only one decision.\nstatus() / is_rejection() are read-only @property."

    class EventDecision {
        +str action
        +str reason
        +__init__(action, reason)
        +from_payload(data) EventDecision$
        +status() str
        +is_rejection() bool
    }
    note for EventDecision "Sibling from SCRUM-18.\nSame shape → candidate shared abstract\nDecision base (see 'OO decisions' below)."

    class Booking {
        +UUID id
        +UUID event_id
        +UUID venue_id
        +datetime start_at
        +datetime end_at
        +str status
        +str decision_reason
        +str suggested_alternative
        +int decided_by
        +datetime decision_at
        +int requested_by
    }

    class Venue {
        +UUID id
        +str name
        +str location
    }
    class Event {
        +UUID id
        +str title
    }
    class AppUser {
        +int id
        +str display_name
        +str role
    }
    class OverlapEngine {
        <<SCRUM-33 · OOP reuse>>
        +is_slot_free(venue_id, start, end) bool
    }

    BookingDecision ..> Booking : applies status + audit to
    Booking "1" --> "1" Venue : for
    Booking "1" --> "1" Event : for
    Booking "*" --> "1" AppUser : requested_by
    Booking "0..1" --> "1" AppUser : decided_by
    OverlapEngine ..> Booking : checks confirmed bookings
```

## 2. Sequence diagram (behaviour)

The failure branches are drawn as explicit `alt` fragments — Week 5's point that a sequence
diagram is the better spec when a story has ordering + failure paths. Note the ordering:
role → fetch → state guard → validate → (approve) overlap check → record → notify.

```mermaid
sequenceDiagram
    actor VS as Venue Staff
    participant FE as BookingDecisionForm (FE)
    participant EP as bookings.decide_booking
    participant RBAC as rbac.require_role
    participant BD as BookingDecision
    participant REPO as booking_repository
    participant OVL as OverlapEngine (SCRUM-33)
    participant NT as create_notification
    actor CO as Coordinator

    VS->>FE: click Approve / Reject (+reason, +alternative)
    FE->>EP: POST /venues/bookings/{id}/decision
    EP->>RBAC: require_role(Venue Staff)
    alt not Venue Staff / bad origin
        RBAC-->>FE: 403 Forbidden
    end
    EP->>REPO: get_booking_by_id(id)
    alt not found
        REPO-->>FE: 404 Not Found
    end
    alt status != "Pending"
        EP-->>FE: 409 Conflict (already decided)
    end
    EP->>BD: from_payload(body)
    alt invalid (e.g. reject without reason)
        BD-->>FE: 400 Bad Request
    end
    alt decision = approve
        EP->>OVL: is_slot_free(venue_id, start_at, end_at)?
        alt slot overlaps a confirmed booking
            OVL-->>EP: conflict
            EP-->>FE: 409 Conflict (slot taken)
        else slot free
            OVL-->>EP: free
            EP->>REPO: record_booking_decision(Confirmed, decided_by, at)
            EP->>NT: booking_approved → requested_by
            NT-->>CO: notification
            EP-->>FE: 200 { booking: Confirmed }
        end
    else decision = reject
        EP->>REPO: record_booking_decision(Rejected, reason, alternative, decided_by, at)
        EP->>NT: booking_rejected(reason, alternative) → requested_by
        NT-->>CO: notification
        EP-->>FE: 200 { booking: Rejected }
    end
```

---

## 3. OO decisions (Week-13 accountability)

- **Encapsulation** — `BookingDecision` bundles the decision data with the rules that guard it:
  the constructor rejects an unknown action, requires a reason on reject, and trims/collapses
  blanks. Outside code can't build an invalid decision.
- **Abstraction** — it models *only* a decision (action, reason, alternative + derived status);
  it holds no persistence, so it's unit-testable in isolation (11 tests, SCRUM-123).
- **Why no inheritance (yet)** — `BookingDecision` and `EventDecision` share a shape, so a shared
  abstract `Decision` base (polymorphic `_STATUSES` / `status()`) is *possible*. It's deliberately
  **not** done: their status vocabularies and consumers differ, and Week 5 warns "reuse is a side
  benefit, not the point" — extracting a base now would be premature abstraction. Flagged here as
  a future option, not a commitment.
- **Association vs the engine** — overlap is a plain **delegation** to `OverlapEngine` (SCRUM-33),
  not inheritance/composition: booking approval *uses* the engine, it isn't *a kind of* it.

> [!note] Interim implementation vs this design
> This diagram shows the **agreed target** (overlap delegated to SCRUM-33). The current backend
> (SCRUM-121) uses the DB partial-`EXCLUDE` constraint as an **interim backstop** — it catches a
> `23P01` and returns 409. When SCRUM-33's engine lands, `decide_booking` calls it *before*
> confirming, and the DB constraint stays as defence-in-depth. Settle this split with Ernest/Jessica.
```

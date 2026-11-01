# ConnectSphere backend (Flask) — rules for AI agents

Read the root `AGENTS.md` first — the five reviewer questions, the Decision Log rule, and
the team working agreement apply here. This file adds backend specifics.

## Architecture: rules are value objects, I/O is separate

The core pattern is **DB-independent value objects** for business rules, with persistence
and HTTP kept out of them:

- **Value objects** (`event_decision.py`, `booking_decision.py`, `event_confirmation.py`,
  `safety_decision.py`, `venue_suitability.py`, `venue_overlap.py`) are pure: plain inputs
  in (status strings, rows, datetimes), plain results out. **No Flask imports, no database
  calls.** They are the fast base of the testing pyramid and are unit-tested in isolation.
- **Repositories** (`*_repository.py`) own all database access.
- **Blueprints** (`events.py`, `venues.py`, `bookings.py`, `auth.py`, …) wire HTTP →
  authorisation → value object → repository.

When you add a business rule, add it as a value object and unit-test it in isolation; do
not embed rules inside route handlers or repositories.

## What an agent may do vs what a human must review (backend)

- **Agent may do:** add CRUD/read routes that follow the existing blueprint pattern, add
  repository queries, write unit/integration tests, refactor within an established pattern.
- **Human must design and review:** anything touching the **overlap engine**
  (`venue_overlap.py`), **status transitions / confirmation / safety gates**, **auth and
  RBAC** (`auth.py`, `rbac.py`), **API contracts**, and **schema migrations**
  (`supabase/*.sql`). These get a Decision Log entry and a named owner.

## Invariants not to break

- **Overlap uses half-open intervals** `[start, end)` — back-to-back bookings are allowed;
  only true overlaps conflict. The engine applies the venue's setup/turnaround buffer to
  occupied windows `[start - setup, end + turnaround)` while keeping touching boundaries
  compatible. The database enforces the same buffered invariant independently
  (`EXCLUDE USING gist` on a buffered `tstzrange`) — keep the three read/write layers
  consistent.
- **Authorisation is server-side.** Enforce access with the central guards
  (`require_role`, `require_related_user`); the UI hiding an action is never the control.
- **Gated transitions go through their endpoint**, not the generic status PATCH — e.g.
  `Confirmed` is reachable only via the confirm endpoint, which applies the confirmation
  gate.

## Testing & local run

- `pytest` runs against an **isolated Postgres/PostgREST** test database (see
  `compose.acceptance.yml`); CI stands it up per run. Do not point tests at a shared
  instance. Follow the root rule: never weaken a test to go green.
- Lint with `ruff check .` before pushing.
- **Local API runs on port 5001** (`flask --app app run`). Do **not** use port 5000 —
  macOS AirPlay occupies it.

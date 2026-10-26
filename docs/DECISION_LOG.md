# ConnectSphere — Decision Log

A living record of the significant engineering decisions behind ConnectSphere: the
domain model, the safety-critical gates, authentication and access control, and the
testing/CI approach. Each entry captures **what was decided, what constrained it, how it
was verified, the trade-off accepted, and who owns it** — so that any team member (or
reviewer) can understand *why* the system is built the way it is, not just *what* it does.

> **How this log is maintained.** Record a new entry whenever a decision is non-trivial,
> hard to reverse, or affects a contract others depend on — schema changes, domain-model
> or value-object changes, authentication/authorisation logic, status-transition rules,
> and accepted trade-offs. Routine implementation that follows an existing pattern does
> not need an entry. Keep entries short; link the governing story (`docs/SCRUM-XX.md`).

---

## AI usage policy

ConnectSphere is built with AI coding assistants as part of the team's normal workflow.
The team applies a consistent, bounded policy:

- **AI accelerates routine implementation** under human-authored specifications — CRUD
  and read endpoints, UI components against a fixed design system, test scaffolding, and
  boilerplate that follows an already-established pattern.
- **Humans design and own every safety-critical and architectural decision** — the
  value-object domain model, the venue-overlap engine, authentication and role-based
  access control, and the confirmation and safety gates. These are specified by a person,
  reviewed by a person, and gated in CI before they reach `main`.
- **Verification is not delegated.** Acceptance criteria and the tests that encode them
  are human-authored to express *intent*; a passing suite is treated as necessary but not
  sufficient, and every change is reviewed against the "what would have to break for this
  to fail?" standard before merge.
- **Known trade-offs are recorded here explicitly** rather than left implicit in the code,
  so that deferred work is visible and owned rather than concealed.

An at-a-glance summary of where AI was and was not used sits in the
[AI usage summary](#ai-usage-summary) table at the foot of this document.

---

## Decision records

### D1 — DB-independent value objects as the domain spine
- **Context.** Core business rules (decisions, gates, suitability, overlap) must be
  correct, fast to test, and independent of Flask and the database.
- **Decision.** Model each rule as a small, immutable value object — `event_decision`,
  `booking_decision`, `event_confirmation`, `safety_decision`, `venue_suitability`, and
  the `OverlapEngine` — with persistence and HTTP handled separately in the endpoints and
  repositories.
- **Constraints / guardrails.** Value objects take plain inputs (status strings, rows,
  datetimes) and return plain results; no I/O, no framework imports.
- **Verification.** Each object is unit-tested in isolation (no Postgres), making the rule
  layer the fast base of the testing pyramid; endpoints add integration tests.
- **Trade-off.** A little extra indirection (object + endpoint + repository) in exchange
  for rules that are independently testable and reusable.
- **Owner.** Shared team convention, applied across all domain work.

### D2 — Secure login (credential handling & account protection)
- **Context.** The brief requires authenticated access with protection against brute
  force and account enumeration.
- **Decision.** Email/password login with **bcrypt** password hashing; lockout after **5
  failed attempts for 15 minutes**; a **generic 401** for both wrong password and unknown
  email; a fixed-cost dummy hash so the unknown-email and missing-password paths run the
  same bcrypt work (equalising response time to prevent **timing-based email
  enumeration**); a **30-minute** session lifetime.
- **Constraints / guardrails.** Lockout thresholds are named constants; the dummy-hash
  path is exercised by tests so the timing defence cannot silently regress.
- **Verification.** Unit tests covering the acceptance criteria (correct/incorrect
  credentials, lockout, unknown email, enumeration defence).
- **Trade-off.** A generic 401 is slightly less friendly to legitimate users who mistype
  an email, accepted in exchange for not leaking which emails are registered.
- **Owner.** Authentication & authorisation work.

### D3 — Centralised, server-side role-based access control
- **Context.** Role checks were beginning to appear ad hoc inside individual endpoints,
  risking duplication and gaps.
- **Decision.** Centralise access control into reusable guards — `require_role(...)` and
  `require_related_user(...)` — applied server-side (not merely hidden in the UI), with
  **denied attempts logged**. Existing record-level access checks were folded into the
  central guards rather than duplicated.
- **Constraints / guardrails.** Authorisation is enforced on the server for every
  protected route; the UI's hiding of actions is a convenience, never the control.
- **Verification.** Tests assert out-of-role actions are rejected server-side and that
  denials are recorded.
- **Trade-off.** One shared choke-point to keep correct, in exchange for consistent
  enforcement and an audit trail.
- **Owner.** Authentication & authorisation work.

### D4 — Venue-overlap engine: half-open intervals + status precedence
- **Context.** Two bookings for the same venue must not overlap, but **back-to-back**
  bookings (one ends exactly as the next begins) must be allowed. Getting the boundary
  condition wrong is a classic defect.
- **Decision.** Treat every booking as a **half-open interval** `[start, end)`: two
  intervals conflict only when `existing.start < new.end AND new.start < existing.end`, so
  **touching endpoints are compatible**. Classify conflicts by status — `Confirmed` and
  `Blocked` are **hard** conflicts; `Requested`/`Pending` are a single **tentative** hold
  that blocks another *request* but never defeats a later confirmed decision. **No setup
  or turnaround buffer** is applied by the engine.
- **Constraints / guardrails.** The engine is pure and total — unrecognised statuses are
  ignored defensively; the half-open rule is the single source of truth for "do these
  overlap?".
- **Verification.** Unit tests cover the exact boundary (back-to-back allowed, true
  overlap rejected) and status precedence; the database enforces the same invariant
  independently (see D7).
- **Trade-off.** No buffer means consecutive events have zero changeover gap — accepted
  for the MVP; a configurable turnaround is a known future change (venue setup/turnaround).
- **Owner.** Venue & booking work.

### D5 — Event confirmation gate (multi-venue), with a documented deferred seam
- **Context.** An event may only be confirmed once its essential arrangements are in
  place. A Week-7 customer change made events **multi-venue**, so confirmation must check
  *all* of an event's venue bookings, not one.
- **Decision.** A pure gate allows confirmation only when **at least one** venue booking
  is `Confirmed`, **none** are still awaiting approval (anything not settled
  `Confirmed`/`Rejected` blocks; unknown statuses block defensively), and technical
  arrangements are resolved. `Rejected` bookings are settled history and do not block.
  Non-essential items (programme, registration) are intentionally **not** checked. The
  generic status endpoint was **locked** to reject a direct set to `Confirmed`, so the
  gate cannot be bypassed.
- **Constraints / guardrails.** Confirmation is reachable only through the dedicated
  confirm endpoint, which enforces role, relation, and `Planning` status before applying
  the gate; failures return the outstanding reasons.
- **Verification.** Unit tests for every branch of the gate plus integration tests for the
  endpoint (confirms when eligible, audits the change, blocks with a clear message, leaves
  status unchanged on failure, rejects non-Coordinators and non-Planning events).
- **Trade-off — recorded explicitly.** The confirmation gate passes the
  **technical-arrangements seam as "resolved"** — it does *not* inspect equipment. The
  equipment epic (catalogue, requests, reservations — see D12) is now built and merged,
  but the confirm endpoint still hard-codes the "resolved" flag rather than checking
  equipment-request status; the gate logic supports the flag and is unit-tested both ways.
  This is a **known, deferred** seam — logged so it is owned, not concealed. Note the
  *completion* gate (D13) **does** check equipment-request status, so the gap is specific
  to confirmation. Risk if forgotten: an event could be confirmed while equipment is
  unresolved. Resolution: wire the confirm endpoint to real equipment-request status.
- **Owner.** Event-lifecycle / readiness work.

### D6 — Operational safety check as a distinct lifecycle stage
- **Context.** A confirmed event must pass an operational safety review before
  preparation begins.
- **Decision.** Add a safety-check stage after `Confirmed`: a Safety Officer either
  approves (event → `Preparation`) or sends it back to `Planning` with a reason. Modelled
  as its own value object, consistent with D1.
- **Constraints / guardrails.** Only a Safety Officer can act; the transition is audited
  with actor and timestamp.
- **Verification.** Unit and endpoint tests for approve / send-back paths and role
  enforcement.
- **Trade-off.** An extra mandatory stage in the lifecycle, accepted because the brief
  treats safety sign-off as non-negotiable.
- **Owner.** Event-lifecycle / readiness work.

### D7 — Double-booking enforced at the database, not only in code
- **Context.** The overlap rule (D4) must hold even against concurrent requests that both
  pass an application-level check.
- **Decision.** Enforce non-overlap at the database with an **exclusion constraint**
  (`EXCLUDE USING gist` over a `tstzrange`), so two conflicting confirmed bookings cannot
  coexist regardless of application timing. A shared `venue_bookings` contract records
  `status`, `decided_by`, `decision_at`, `decision_reason`, and `suggested_alternative`;
  the decision endpoint returns `409` if a booking is already decided and `403` if the
  caller is not Venue Staff.
- **Constraints / guardrails.** The database is the ultimate guarantor of the invariant;
  the application layer gives friendly errors but is not the sole defence.
- **Verification.** SQL-level tests for the exclusion constraint plus endpoint tests for
  approve/reject, audit fields, and the already-decided / wrong-role cases.
- **Trade-off.** Duplicates the invariant in two places (engine + DB), accepted because
  correctness under concurrency outweighs the small redundancy.
- **Owner.** Venue & booking work.

### D8 — One event, many venues (1-to-many)
- **Context.** A Week-7 customer change requires an event to book **multiple** venues.
- **Decision.** Model `Event → VenueBooking` as **one-to-many** and ripple the change
  through booking submission, the availability view, and the confirmation gate (D5), which
  now requires *all* bookings settled.
- **Constraints / guardrails.** Downstream rules that previously assumed a single venue
  were updated together to keep the model consistent.
- **Verification.** Confirmation and booking tests exercise the multi-venue cases.
- **Trade-off.** More complex confirmation logic, accepted as a direct customer
  requirement.
- **Owner.** Event & venue work.

### D9 — Auto-assign a Coordinator on submission (with a known successor)
- **Context.** A submitted event request needs an owning Coordinator without manual
  routing.
- **Decision.** On submit, the system auto-assigns a Coordinator.
- **Constraints / guardrails.** Assignment happens at the submit transition and is
  recorded in history.
- **Verification.** Tests cover assignment on submit.
- **Trade-off — recorded explicitly.** A later customer change introduces an **Event
  Coordinator Lead** who assigns coordinators. Auto-assign is therefore a **known interim**
  behaviour to be **disabled/superseded** when the Lead-role stories land. Logged so the
  successor work is not forgotten.
- **Owner.** Event-intake work.

### D10 — Isolated, ephemeral test database in CI
- **Context.** Integration tests need a real Postgres/PostgREST surface without touching
  any shared or production data.
- **Decision.** CI stands up an **isolated Postgres + PostgREST** stack via compose,
  seeds it, runs the suite against it, uploads evidence artifacts, and tears it down.
- **Constraints / guardrails.** The test database is created and destroyed per run; tests
  never point at a shared instance.
- **Verification.** The pipeline itself is the verification — the suite only passes
  against the freshly-provisioned, seeded database.
- **Trade-off.** Slower CI (container spin-up) in exchange for realistic, hermetic
  integration tests.
- **Owner.** Platform / CI work.

### D11 — Single design-system frontend (shadcn/ui + semantic tokens)
- **Context.** The UI needed a consistent, themeable, accessible foundation.
- **Decision.** Standardise the frontend on shadcn/ui with Tailwind semantic colour
  tokens; **no hardcoded colours** — theming is done by editing CSS variables only. The
  authenticated app renders inside a shared shell.
- **Constraints / guardrails.** The end-to-end suite selects by accessible name/role, so
  restyling must change `className` only and preserve labels, roles, and landmarks.
- **Verification.** Lint, build/typecheck, and the Playwright e2e suite gate UI changes.
- **Trade-off.** An up-front migration cost, accepted for long-term consistency and
  accessibility.
- **Owner.** Frontend work.

### D12 — Equipment epic (catalogue, requests, availability, reservations)
- **Context.** Events need technical equipment; the brief gives a Technical Support role
  that owns it.
- **Decision.** A full equipment module — catalogue CRUD, availability checking, equipment
  requests, and reservations — with its own repositories, validation, blueprints, and
  database tables/migrations. Availability follows the same interval reasoning as venue
  overlap (D4); request state transitions mirror the decision/audit pattern used elsewhere.
- **Constraints / guardrails.** Equipment access is role-scoped; reservations are linked
  to equipment requests; closed events make their equipment requests read-only (see D13).
- **Verification.** Unit and acceptance tests across catalogue, availability, requests, and
  reservation status, plus e2e specs for the equipment screens.
- **Trade-off.** A sizeable surface delivered late in the project; it is built and merged,
  but is **not yet wired into the event confirmation gate** (see D5).
- **Owner.** Equipment / technical-support work.

### D13 — Event completion gate (Preparation → Completed)
- **Context.** A delivered event must be formally closed, and closing it must not strand
  outstanding arrangements.
- **Decision.** A DB-independent `EventCompletion` value object (same pattern as D1/D5)
  allows completion only when the event is in **Preparation** *and* no venue booking is
  still awaiting approval *and* no equipment request is still unactioned. The
  `complete_event` database function **re-checks the same rule under a row lock** before
  closing, so the invariant holds even under concurrency. Closed events become read-only.
- **Constraints / guardrails.** The rule lives in one value object and is re-asserted at
  the database; settled booking/equipment statuses do not block.
- **Verification.** Unit tests for each gate branch plus real-database acceptance tests for
  the endpoint and the locking completion function.
- **Trade-off.** Completion checks equipment-request status even though *confirmation* does
  not (D5) — a deliberate, logged asymmetry, not an oversight.
- **Owner.** Event-lifecycle work.

### D14 — Change management (request / review changes, cancel)
- **Context.** After an event is in motion, organisers need to request changes and
  coordinators to review them; events must be cancellable.
- **Decision.** Add change-request handling (submit a change, coordinator review/decision)
  and cancellation, reusing the existing decision/audit pattern; changes and decisions are
  recorded with actor and timestamp in the event's history.
- **Constraints / guardrails.** Change decisions are role-gated and audited; the event page
  degrades gracefully when change requests are unavailable.
- **Verification.** Endpoint and e2e tests for requesting and reviewing a change.
- **Trade-off.** Cancellation's release of held venue/equipment resources is an area to
  confirm against the brief (a known follow-up, not assumed complete).
- **Owner.** Event-lifecycle work.

---

## AI usage summary

Per-feature view of where AI assistance was applied, always under human specification and
review. "Routine implementation" means CRUD/read endpoints, UI against the fixed design
system, test scaffolding, and boilerplate following existing patterns.

| Area | AI used? | For what | Reference |
|------|----------|----------|-----------|
| Domain value objects (D1) | Partially | Scaffolding of object/test structure; **rules human-designed** | `docs/SCRUM-33.md`, `docs/SCRUM-39.md` |
| Secure login (D2) | Partially | Boilerplate & test scaffolding; **security design human-authored** | `docs/SCRUM-20.md` |
| RBAC (D3) | Partially | Guard refactor scaffolding; **policy human-authored** | `docs/SCRUM-21.md` |
| Overlap engine (D4) | Minimal | **Boundary/precedence rule human-designed**; tests human-authored | `docs/SCRUM-33.md` |
| Confirmation gate (D5) | Partially | Endpoint & test scaffolding; **gate rule + lock human-designed** | `docs/SCRUM-39.md` |
| Safety check (D6) | Partially | Scaffolding; **stage design human-authored** | `docs/SCRUM-128.md` |
| `venue_bookings` + DB constraint (D7) | Partially | CRUD/endpoint scaffolding; **schema & constraint human-designed** | `docs/SCRUM-31.md` |
| Multi-venue (D8) | Partially | Mechanical ripple; **model change human-decided** | — |
| Auto-assign (D9) | Partially | Implementation; **behaviour + successor plan human-decided** | `docs/SCRUM-17.md` |
| CI test DB (D10) | Partially | Pipeline authoring; **approach human-decided** | `.github/workflows/ci.yml` |
| Design system (D11) | Yes | Component implementation against fixed tokens | `docs/UI_DESIGN_SYSTEM.md` |
| Equipment epic (D12) | Partially | CRUD/requests/reservations scaffolding; **availability & state rules human-designed** | `docs/SCRUM-34.md`, `docs/SCRUM-37.md` |
| Event completion (D13) | Partially | Endpoint/test scaffolding; **gate rule + DB-lock re-check human-designed** | `docs/SCRUM-132.md` |
| Change management (D14) | Partially | Implementation of change/cancel flows; **rules human-decided** | `docs/SCRUM-46.md` |

**Summary statement.** AI accelerated routine implementation and scaffolding throughout,
under human-authored specifications. Every safety-critical decision — the overlap engine,
the confirmation and safety gates, and the authentication/authorisation model — was
human-designed, documented in this log, and review-gated in CI before merge. Known
trade-offs (notably the deferred technical-arrangements seam in D5 and the interim
auto-assign in D9) are recorded explicitly rather than left implicit.

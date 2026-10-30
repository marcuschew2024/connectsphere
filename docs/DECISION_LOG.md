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

**29 October 2026 update:** the deferred seam above is superseded locally by D22.
It remains a description of the previously merged baseline, not the updated gate.

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

**30 October 2026 update:** auto-assignment is superseded by D26 (SCRUM-130).

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
  but was initially not wired into the event confirmation gate (D5). D22 supplies
  that integration locally; merge/review is still required.
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

### D15 — Registration capacity is a separate, atomic signup limit (SCRUM-41)

- **Context.** Expected attendance is a planning estimate, and no registration table
  previously existed. Counting signups before a separate insert could oversell the last
  place when requests race.
- **Decision proposed for Jerome's review.** Add an explicit nullable registration
  capacity and counter to events, plus a unique event/attendee registration row. A table
  trigger locks and conditionally updates the parent event in the signup transaction.
  A pure `RegistrationCapacity` object supplies the application precheck. The organiser
  sets capacity before confirmation through a separate, audited endpoint.
- **Constraints.** No inferred limit/backfill from expected attendance; unset capacity
  keeps signup closed. Existing confirmation and safety gates are preserved. SQL
  independently validates status, role, uniqueness and capacity. RLS and backend-only
  grants keep identities supplied by the session, not the browser. Invoker functions
  use an empty search path. SCRUM-40/43/44 retain their full attendee workflows.
- **Verification.** Boundary and endpoint tests, SQL replay/permissions/100-of-100
  checks, real database final-slot concurrency/direct-write tests, and browser checks
  for clear save, full, failure, read-only and mobile states; full regression evidence
  is recorded in `docs/SCRUM-41.md`.
- **Trade-off.** A stored counter avoids snapshot-based overselling and repeated counts;
  all future registration state changes must preserve the trigger. Capacity is locked
  after confirmation, matching the existing change-request model. Waiting-list
  behaviour is deferred because it is not enabled.
- **Owner.** Jerome. This design was proposed and implemented by Codex against the
  story and sprint plan; human design/API/schema review is still required before merge.

### D16 — Registration capacity input is limited to 10,000 (SCRUM-41)

- **Context.** During manual review, the user requested a practical maximum instead
  of displaying PostgreSQL's integer ceiling in the validation message.
- **Decision.** Accept whole numbers from 1 to 10,000 in the organiser form and Flask
  capacity endpoint; show the same range in both validation messages.
- **Constraints.** Preserve ownership, confirmation locks and atomic signup checks.
  No schema migration is needed: storage retains its integer representation; trusted
  direct database operations can still exceed the application input limit.
- **Verification.** API boundary tests accept 1/10,000 and reject 10,001 before storage;
  browser checks cover the correction and saving 10,000. Existing maximum-integer
  acceptance and correction expectations change to match the requested contract.
- **Trade-off.** This is an application input limit, not a new database invariant.
  Existing saved values are preserved; editing them requires a value within the range.
- **Owner.** Jerome remains accountable for API/domain review before merge; the user
  requested the 10,000 maximum during manual review on 28 Oct 2026.

### D17 — Expected attendance uses the same practical input range

- **Context.** The user's follow-up identified the old integer-ceiling error in
  Expected attendance, a separate field from registration capacity.
- **Decision.** Limit expected attendance to whole numbers from 1 to 10,000 in
  event creation/draft/edit forms and their shared API validator; use the same error
  wording as registration capacity. Blank attendance remains allowed for drafts.
- **Constraints.** Keep expected attendance separate from the signup limit. Preserve
  existing storage, events, authorisation and status gates.
- **Verification.** Event API tests cover draft/submission boundaries at 1, 10,000
  and 10,001. Run event regression tests, lint and the frontend production build.
- **Trade-off.** Application input limit only; direct database writes and existing
  saved values retain the database's integer range.
- **Owner.** Jerome remains the SCRUM-41 review owner; event contract changes require
  review by the event-lifecycle owner before merge. Requested by the user on 28 Oct 2026.

### D18 — Account-only registration, atomic receipt and public discovery (SCRUM-40)

- **Context.** SCRUM-41 supplies an atomic capacity-protected insert, but attendees
  cannot discover events, supply required information, receive a confirmation or
  retain participant access. Registration periods are separately owned by SCRUM-42.
- **Decision proposed for Jerome's review.** Add attendee-only discovery and receipt
  endpoints with explicit public projections. Store one text response to the
  organiser's existing free-text registration requirements (maximum 4,000 characters).
  Table triggers validate the stored requirements and optional opening/closing times,
  then create participant access and an in-app confirmation in the signup transaction.
  Keep SCRUM-41's two-argument RPC and empty HTTP payload compatible when no information
  is required. Add a separate information-aware RPC and attendee confirmations endpoint.
- **Constraints.** Session supplies identity; Origin and central role guards apply.
  Private drafts and unrelated planning records stay hidden. Attendees retrieve only
  their own receipt and registration confirmations, never organiser decision messages.
  Existing organiser notifications, confirmation/safety gates and capacity locks remain
  unchanged. Database functions are invoker-only with empty search paths and no browser
  execution grants; registration RLS stays enabled.
- **Verification.** Prescriptive route/browser tests, disposable Postgres/PostgREST
  tests for real accounts, required information, period refusals, duplicates, receipt
  isolation and simultaneous final-place writes. SQL checks force notification failure
  and assert that count, signup, participant and receipt all roll back. Migration replay
  and backend/browser regression evidence are recorded in `docs/SCRUM-40.md`.
- **Trade-off.** Confirmation is in-app, not email. Requirements remain unstructured
  text; a configurable form builder is outside the story. Optional period bounds use
  `[open, close)`; NULL is unbounded, preserving SCRUM-41's Confirmed + capacity rule.
  SCRUM-42 owns period editing. No waitlist is enabled, so full events report no places.
  Previously stored registrations are preserved without fabricating historical receipts.
- **Owner.** Jerome. Schema, API, data-collection, session and access design require his
  explicit review before merge; these are AI-proposed decisions, not claimed human approval.

### D19 — Action endpoints resolve the same account as /session (SCRUM-40)

- **Context.** The existing `/session` endpoint prioritises password-authenticated
  accounts, but `require_acting_user` used only the development switcher. Real attendees
  could appear signed in while registration rejected them or used a different demo identity.
- **Decision proposed for Jerome's review.** Resolve the existing real-account session
  first, then fall back to the already gated development switcher. Reuse the current
  authentication resolver; no new login flow, cookie, role source or request identity.
- **Constraints.** Production ignores demo identities; deleted/absent real accounts
  retain the existing resolver behaviour. Role/record guards still decide each action.
- **Verification.** Signup acceptance runs with production configuration and real account
  sessions. A conflicting real-Organiser/demo-Attendee test must deny signup. Existing
  auth, switcher, RBAC and full regression suites remain unchanged.
- **Trade-off.** This central helper change also enables existing guarded action endpoints
  for real accounts, completing the documented login integration. It needs broader human
  access review because its effect extends beyond registration.
- **Owner.** Jerome, with the authentication/RBAC owner reviewing before merge.

### D20 — One-time initial capacity setup for an empty Confirmed event (SCRUM-40 review)

- **Context.** Confirmation deliberately does not require registration setup (SCRUM-39
  AC2). Manual review reached a legitimate Confirmed event whose capacity was still
  NULL. The blanket post-confirmation capacity lock then prevented the Organiser from
  ever opening registration; the change-request workflow records decisions but does
  not apply capacity values.
- **Decision proposed for Jerome's review.** Permit the existing owning-Organiser
  capacity endpoint/RPC to set the first limit when, under the event row lock, status
  is exactly Confirmed, capacity is NULL and registered count is zero. After the first
  save, the established post-confirmation limit remains locked. The UI explains this
  one-time setup and hides its input immediately after a successful save.
- **Constraints.** No exception for Preparation, terminal events, another Organiser
  or other roles. No reduction or replacement of an existing limit, status rollback,
  inferred limit from expected attendance, or bypass of confirmation/safety gates.
  Retain session identity, Origin checks, input range, atomic signup counter, audit
  record, invoker RPC, empty search path and backend-only execution grants.
- **Verification.** Pure/route tests for the exact exception and retained locks;
  disposable-database tests for owning actor, first setup → signup, auditing, later-state
  refusal and two competing initial saves (one succeeds, one is locked). SQL replay and
  privilege checks plus full browser/backend regressions are recorded in SCRUM-40.md.
- **Trade-off.** This narrowly revises D15's pre-confirmation editing rule. Setting an
  absent limit is treated as registration setup, while changing an existing limit still
  requires the coordinator change process. That process still does not automatically
  apply later capacity changes. The migration changes a function, without rewriting
  events or selecting a signup limit for the Organiser.
- **Owner.** Jerome. This is an AI-proposed domain/API/database rule change requiring
  human design review before merge. It is prepared locally; applying the migration to
  the shared development project awaits the owner's approval.

### Merge authorization for D18–D20 — 29 Oct 2026

Following manual workflow review and discussion of the unset Confirmed capacity
case, the owner explicitly requested push and merge of the SCRUM-40 branch. Proceed
only after remote lint/build/e2e pass. Jerome owns these domain/API/access decisions.
Shared Supabase migration deployment is separate and is not implied by the Git merge.

### D21 — Tentative venue holds with auto-expiry and FCFS override (SCRUM-79)

- **Context.** Venue Staff need to tentatively hold a venue slot while arrangements are finalised.
  Customer Week 7 Change #4 requires that holds must have an expiry timestamp and release the venue
  if unconfirmed; confirmed bookings (FCFS) override active holds.
- **Decision.** Model tentative holds as booking records with `status = 'Held'` and `expires_at timestamptz`.
  In `OverlapEngine`, holds block new tentative requests while active (`now < expires_at`), but release
  the slot once expired (`now >= expires_at`). A confirmed booking wins over a tentative hold (`can_confirm = True`).
- **Constraints / guardrails.** Enforce `expires_at` in the future and strictly before the event starts.
  Single hold per venue/slot enforced by Postgres EXCLUDE gist constraint and the overlap engine.
- **Verification.** `test_venue_overlap.py` unit tests for hold precedence and expiry; `test_booking_decision_route.py`
  integration tests for Venue Staff placement, expiry validation, and coordinator notification.
- **Trade-off.** Automatic slot release is evaluated on-demand during conflict checks (`is_expired()`) rather
  than running a continuous background daemon, ensuring zero background compute overhead and high reliability.
- **Owner.** Jessica Ang (Sprint 4 Overlap & Availability owner).

### D22 — Confirmation requires fully reserved equipment (SCRUM-39)

- **Context.** Database-backed regression tests reproduced confirmation returning
  200 with approved venues but a Requested equipment request. D5 documented this
  deferred seam. On 29 October 2026 the owner explicitly instructed that both
  Partially fulfilled and Unavailable must also block until fully reserved.
- **Decision.** The confirmation value object requires every recorded equipment
  request to be Reserved. Requested, Partially fulfilled, Unavailable, unknown and
  unreadable statuses block. The repository derives current request status from
  required quantities and active Reserved allocations; a stale stored Reserved
  label, Pending allocation or released/cancelled allocation is insufficient.
  All requests are checked without UI pagination. No equipment requests means no
  recorded equipment arrangements need resolving; programme and registration setup
  remain non-blocking. A failed readiness lookup returns 503 before mutation.
- **Constraints.** Keep pure decision logic in EventConfirmation and I/O in the
  existing repository. Retain Coordinator, relationship, Planning-only and venue
  gates. No schema, grants or hosted-database changes. Existing venue-route tests
  explicitly stub an empty equipment collection; no assertion was removed or
  weakened. This fixture extension is reviewable and does not substitute for the
  real database regressions.
- **Verification.** New unit/repository cases cover all request statuses, malformed
  data, stale labels, current quantities, read failures and a blocking request beyond
  the first UI page. Database tests reject each of the three unresolved outcomes,
  verify unchanged event/bookings/history, then fully reserve that same request and
  confirm successfully with actor/time history. They also cover no-equipment events,
  independent booking writes, denied access and failed writes.
- **Trade-off.** Reads and the existing event/history writes are separate operations;
  this does not establish a serializable transaction across concurrent reservation
  changes and confirmation, or rollback of a later history-write failure. Atomic
  confirmation requires a separately reviewed database/API change. Free-text needs
  that have not been recorded as equipment requests are not inferred by this gate.
- **Owner.** Marcus (product owner), with Jessica/Jerome for equipment review. The
  user supplied the blocking-status decision; implementation review and green CI
  remain required before merge. Nothing here authorizes push, merge or deployment.

### D23 — Venue requirement fragments must not invent requested features

- **Context.** New requirement-matching regressions found that `quiet room` produced
  warnings for both Classroom and Boardroom. The reverse substring check treated
  `room` as a request for each longer canonical name.
- **Decision.** Remove reverse fragment matching. Preserve normalised phrase/synonym
  recognition and conservative typo hints. An ambiguous fragment such as `micro`
  does not by itself request a microphone. Suitability warnings remain advisory;
  no booking, capacity, overlap or authorisation policy changes here.
- **Constraints.** Preserve existing test assertions and coverage settings. This is a
  matching correction, not a new schema, API or value-object interface. No shared
  database writes form part of the coverage verification.
- **Verification.** A regression asserts no warning for `quiet room` in a venue that
  supports Theatre. Existing suitability and boundary suites still pass; the full
  local Python 3.12 run passed 1,403 tests with 96.95% backend line coverage.
- **Trade-off.** Truncated names are not silently accepted as full requirements;
  users can use the complete supported feature or an existing normalised synonym.
- **Owner.** Marcus for scope/merge, with Jessica for venue-suitability review. The
  user requested merging this regression increment behind green CI; this entry
  does not certify a separate teammate review or completion of 100% coverage.

### D24 — Session-scoped current registration status (SCRUM-44)

- **Context:** SCRUM-40 retains historical confirmations and per-event receipts.
  Attendees need a discoverable list of their current registration state, including
  after withdrawal or event cancellation. A confirmation message is not current state.
- **Decision (proposed for Jerome's review):** add Attendee-only
  `GET /events/registrations?page=1`, returning 25 current registrations plus `page`
  and `has_more`. Derive identity exclusively from the existing account/session
  resolver; reject query parameters other than a single bounded page. Filter
  `attendee_id` before ordering/pagination, with `registered_at DESC, id ASC`.
  Select only registration reference/state/timestamps and public event identity,
  title, category, date and lifecycle status. Exclude attendees' identities,
  registration information and internal event planning fields.
- **Constraints:** reuse central role guards, existing Origin policy, repositories,
  backend-only database access and the current schema. All responses are `no-store`;
  the frontend also bypasses its fetch cache. The list refreshes on return/focus,
  every 30 seconds while visible, and explicitly on request. Failed refreshes remove
  old rows and show a retryable error rather than stale confirmation or empty success.
- **Verification:** new HTTP tests cover session/role/Origin/input/failure boundaries;
  disposable-database acceptance tests prove cross-attendee isolation, safe public
  projections, complete pagination, and fresh reads after a persisted withdrawal and
  cancellation. Browser checks cover status changes, focus/polling, errors/retry,
  navigation, pagination and mobile/keyboard use. Existing tests are preserved.
- **Trade-off:** the Sprint 4 Goal & Scope explicitly defers waiting lists to SCRUM-80;
  D15/D18 and the database currently support Registered/Withdrawn only. The display
  understands Waitlisted and a later promotion response without claiming a booked
  place, but this read story adds no queue, status transition, or migration. Waiting-list
  presentation/promotion is verified with API/browser fixtures; a persisted waiting-list
  transition remains an integration check for SCRUM-80. Jerome must review this scope
  reconciliation against the literal Jira wording before accepting SCRUM-44.
- **Owner:** Jerome owns the API/access contract and acceptance decision. Codex authors
  the proposed implementation. Human design review and green CI remain merge gates;
  On 30 October 2026, after the waitlist limitation was disclosed, the user explicitly
  requested push and merge behind green CI. Shared database deployment is not included.

### D25 — Real login is the entry point; the dev switcher never overrides it (SCRUM-139)

- **Numbering note.** The Codex review tickets (SCRUM-135..145) cite planned entries
  "D22–D25". Repository entries D21–D24 landed first with other meanings, so this fix
  is recorded as D25. The ticket's "D22" means this entry.
- **Context.** Codex review R10 (High). On Home, the development switcher's load-time
  `/dev/session` response called the same role setter as `/session`. A password-signed-in
  user with no demo selection was overwritten to "no role", and a disabled switcher (404)
  did the same. `POST`/`DELETE /dev/session` began with `session.clear()`, so using
  the switcher silently ended a real login. Signed-out visitors were never sent to
  `/login`. Demo identities have no password, so no role had a working password account.
- **Decision.** (1) `/session` is the only source of the page's role. The switcher reads
  state on load and reports a role only after an explicit switch. It checks
  `/auth/session` first and does not render while a password session exists.
  (2) The API refuses `POST`/`DELETE /dev/session` with 409 while a password session
  exists; the real session must end through `/auth/logout`. (3) In non-development
  builds, Home redirects to `/login` when `/session` confirms nobody is signed in. An
  unreachable API shows a sign-in link instead of redirecting. (4)
  `supabase/seed_role_accounts.sql` seeds ten non-demo password accounts: all seven
  roles, plus a second Organiser, Coordinator and Attendee for isolation checks.
- **Constraints.** No change to the `/session`, `/auth/*` or `/dev/*` response shapes.
  The existing switcher gates (`APP_ENV=development` and `DEV_ROLE_SWITCHER_ENABLED=true`,
  plus a development build in the frontend) are unchanged, and production still
  ignores `acting_user_id`. The seed contains no password: it refuses to run unless
  `connectsphere.seed_password` (12+ characters) is set for the session. It hashes with
  pgcrypto bcrypt (cost 12), which the API's `bcrypt.checkpw` accepts. No schema or
  grant changes.
- **Verification.** `api/tests/test_login_entry_point.py`: switch/clear refused while
  signed in (both fail without the guard), real identity kept with a leftover demo
  cookie, signed-out switching unchanged, production ignores demo cookies.
  `api/tests/test_role_accounts_acceptance.py` runs on the disposable database: each
  seeded account logs in and `/session` reports its role. It also checks the seven-role
  coverage, the distinct isolation IDs, wrong-password rejection and that production
  never resolves a demo identity. The seed is replayed twice in `run.sh`.
  `src/lib/dev-switcher.test.ts` (loader never consults demo endpoints for a password
  session); `e2e/login-entry.spec.ts` (redirect, no redirect on API failure, login lands
  on the account's workspace with no `/dev/*` calls).
- **Trade-off.** Only Home redirects. Other pages keep their in-page "Sign in or select a
  demo user" states, and the server-side guards still protect them. A blanket guard
  would change many existing e2e expectations and belongs in a separate, reviewed change.
  Development builds still land signed-out users on Home so the switcher stays usable.
  The seed resets passwords on rerun, by design, for development data.
- **Owner.** Ernest Wong (reassigned from Marcus, 29 Oct 2026). This is
  authentication logic and needs human review before merge. Applying the seed to the
  shared Supabase project is a separate step for the owner.
- **Owner verification — 30 Oct 2026.** Ernest Wong ran a production build and confirmed
  that a signed-out visit to `/` lands on `/login`. Push and merge still require the
  owner's explicit instruction and green CI.

### D26 — Unassigned queue; the Event Coordinator Lead assigns and reassigns (SCRUM-130)

- **Context.** Week 7 Customer Change #5. Requests must enter an unassigned queue that
  the Event Coordinator Lead routes, instead of the SCRUM-17 trigger auto-assigning the
  first Coordinator (D9). Coordinators manage only their assigned events, and relevant
  users are notified. SCRUM-17 stays Done as historical work.
- **Decision.** The owner chose these on 30 Oct 2026:
  - **No auto-assignment.** The migration drops `events_assign_coordinator`, so a
    submission is `Submitted` with no Coordinator.
  - **Status is unchanged by assignment.** "Unassigned vs assigned" is
    `coordinator_id` null or set; the stored status stays `Submitted`, so the existing
    approve/reject and clarification flows are untouched.
  - **Reassignment in any active state.** Submitted, Planning, Confirmed and
    Preparation (plus the legacy intake sub-states) can be reassigned; Draft is
    hidden (404) and Completed, Rejected and Cancelled are closed (409).
  - **Notifications.** The new Coordinator is told "assigned", and on reassignment
    the previous Coordinator is told "moved away". After manual testing the owner
    revised this (30 Oct 2026): the Organiser is also told once, on first
    assignment (`request_assigned`), that the request has left the Lead's queue.
    Reassignments stay internal. `/notifications` and the Home panel now include
    Coordinators; each user still reads only their own rows.
  - **The Organiser's status box names the holder:** the Event Coordinator Lead
    while unassigned, then the Coordinator. Status history shows "Coordinator
    Assigned" / "Coordinator Reassigned" rather than the stored action.
- **How.** `POST /events/<id>/coordinator` and `GET /events/coordinators` are
  Lead-only. The `CoordinatorAssignment` value object checks the payload and state.
  The `assign_coordinator_by_lead()` database function re-checks the Lead, the
  Coordinator and the event state under the event row lock. In one transaction it
  updates the event, moves the Coordinator's `event_participants` membership,
  records history (`coordinator_assigned` / `coordinator_reassigned`) and writes the
  notifications. Moving the membership matters: `require_related_user` grants access
  to participants, so a previous Coordinator who kept the row would keep access.
- **Constraints.** `events_submitted_assignment_check` (every submission has a
  Coordinator) is replaced by `events_coordinator_assignment_check`: an assignment
  has a timestamp, and only Draft, Submitted or Cancelled events may be unassigned.
  The old trigger's timestamping is kept as `events_stamp_coordinator_assignment`
  (it never picks a Coordinator). Existing assignments are untouched. The function
  is `security definer`, has an empty search path and is executable only by the
  backend role, like `complete_event` (D13). No table grant changes.
- **Verification.** `supabase/tests/coordinator_assignment.sql` checks the
  unassigned submission, assign, reassign, membership move, history, notifications,
  every refusal and the new constraint. The migration is replayed twice.
  `api/tests/test_coordinator_assignment.py` covers the value object and non-Lead
  denials. `api/tests/test_coordinator_assignment_acceptance.py` maps to
  TC-130-01..04 on the disposable database. A mutation check confirmed TC-130-03/04
  fail if the membership move is removed. `e2e/coordinator-assignment.spec.ts`
  covers the queue, assign, reassign, refusal and Coordinator notifications.
  Regression of the intake flow (SCRUM-13/17/18/21): the full API and browser
  suites pass.
- **Changed existing tests (reviewable).** Only assertions encoding the superseded
  SCRUM-17 behaviour were changed, with the owner's approval. No other assertion was
  removed. The changes are in `test_events.py` (fake no longer auto-assigns; the
  submission, multiple-submission and assignment-route tests),
  `test_request_acceptance.py` (TC-US3.3-02, TC-US4.1-01/02/04/05 and the decision
  test now assign through the Lead, and its notification checks count decision
  notices only, since the Organiser also gets `request_assigned`), `test_change_request_acceptance.py` (assign through the Lead;
  history starts with `coordinator_assigned`), `test_event_decisions.py`
  (Coordinators may read notifications) and `e2e/notifications.spec.ts` (Coordinator
  removed from the "no notifications" loop). `supabase/tests/assignment.sql` is
  unchanged: it still verifies SCRUM-17 at its point in the replayed migration order.
- **Trade-off.** The Lead's queue reuses `GET /events`, which is unpaginated, as
  before. The Lead's event detail page can still fail on another Coordinator's
  clarification lookup; that is SCRUM-140 (Marcus), not fixed here. Demo Coordinators
  appear in the assignable list wherever demo users exist.
- **Owner.** Ernest Wong. This changes the API contract, RBAC (notifications), the
  schema/trigger and an intake rule, so it needs human review before merge. Applying
  the migration to the shared Supabase project is a separate step for the owner.

### D27 — R07: notifications use a hybrid user-or-role recipient model; the reader serves every role (SCRUM-49)

- **Context.** The notifications reader was gated to Organiser (then Organiser/Coordinator
  after SCRUM-130), so Venue Staff, Tech Support, Attendee and other recipients never saw
  notifications written for them — "persisted but not delivered" (Codex review R07). This
  folds into SCRUM-49 (its refined acceptance criteria), not a Done-story bug.
- **Decision (PO, Marcus).** Each notification targets **exactly one** of a specific user
  (`recipient_id` — Organiser / Coordinator / Attendee, who are tied to an event) **or** an
  unassigned role pool (`recipient_role` — Venue Staff / Tech Support, who work a shared
  queue). `GET /notifications` returns rows where `recipient_id = current user OR
  recipient_role = current user's role`; the role gate is removed and the Home feed is shown
  for every role. Record-level isolation is preserved: a user sees only their own and their
  pool's notifications, and attendees never see internal planning content.
- **Why a pool for those two roles.** No per-event assignment of Venue Staff / Tech Support
  exists in Release 1 (Customer Clarification S1 Q10/Q16, S2 Q9/Q13); they review from a
  shared queue, so the former per-staff-id fan-out for venue booking requests is replaced by
  one pool notification, and submitting an equipment request now notifies the Tech Support
  pool.
- **Recipient matrix (implemented triggers).** Organiser ← decision / clarification / change
  update · Coordinator ← change requested, booking outcome, assignment/reassignment · Venue
  Staff (pool) ← new booking request · Tech Support (pool) ← new equipment request. Deferred
  to their owning stories (the primitive is now available): booking outcome SCRUM-119,
  hold-expiry SCRUM-79, event cancelled/rescheduled SCRUM-69/48, waitlist SCRUM-80.
- **Constraints / guardrails.** The DB enforces the shape: a CHECK that exactly one of
  `recipient_id` / `recipient_role` is set, and a whitelist allowing `recipient_role` only
  for `Venue Staff` / `Tech Support`. The pure `notification_visibility` value object mirrors
  the read rule and is unit-tested; the repository mirrors it in a PostgREST `.or_()` query.
- **Verification.** Unit tests (visibility rule), route tests (all roles 200; pool + isolation),
  and a real-database acceptance test (constraints + `.or_()` filtering incl. the quoted role
  value). Frontend e2e covers the Venue Staff / Tech Support pool feeds.
- **Trade-off.** Pool notifications have no "claimed by X" dedup — every holder of a pool role
  sees every pool item — which is acceptable for Release 1 because no assignment model exists;
  per-staff routing would be a future story.
- **Owner.** Marcus (SCRUM-49). Changes schema and authorisation, so it is human-reviewed and
  merged only behind green CI. Applying the migration to the shared Supabase project is a
  separate step for the owner.

### D28 — A Coordinator views every event, their own surfaced first; read grants no edit (SCRUM-54)

- **Context.** Customer Clarification S1 Q34: a Coordinator "mainly views their own assigned
  events, **but can view all**." Under Change #5 (D26 / SCRUM-130) a new submission sits
  unassigned in the Lead's queue, so a regular Coordinator's `GET /events` showed only their
  own organised/assigned events — unassigned and other Coordinators' events were invisible
  (the "queue-visibility" gap the Sprint 4 scope notes against this story).
- **Decision (PO, Marcus).** For the Coordinator role, `GET /events` returns **every
  non-Draft event**, with the Coordinator's own (organiser or assigned) **surfaced first**
  and flagged `is_mine`; all other events follow. This is **visibility only** — record-level
  access and every action gate (`require_related_user`) are unchanged, so opening, editing,
  deciding or confirming a non-owned event is still refused (the AC's "read ≠ edit"). Drafts
  stay private to their organiser.
- **Scope boundary.** This is list visibility, deliberately separate from **SCRUM-140 / R11**
  (the Lead cannot open another Coordinator's event via the clarification endpoint), which
  stays an open bug. SCRUM-54 does **not** touch `require_event_access`.
- **Implementation.** `list_all_events_for_coordinator()` reuses `get_events_for_user()` for
  the "own" group (keeping its draft-privacy and pending-clarification hide) and appends every
  other non-Draft event; the acting Coordinator's own event currently back with its organiser
  for clarification stays hidden in both passes. The endpoint tags each returned event with an
  additive `is_mine` boolean (Coordinator responses only), computed server-side so the browser
  never learns the user id. Frontend: `/events/managed` becomes "All events" with **Your
  assigned events** (actionable) and **All other events** (view-only, non-linked because their
  detail is record-level protected); `/events/review` shows all submitted requests split the
  same way.
- **Verification.** Unit route tests (own-first ordering, `is_mine`, drafts excluded; edit on
  a non-owned event → 403) and real-database acceptance tests (visibility + ordering +
  read/edit denial). Three existing acceptance tests that encoded the pre-SCRUM-54 "Coordinator
  sees only its own" rule (TC-130-01, TC-130-04, TC-us41-02) and one SCRUM-131 list test were
  updated to the new behaviour; **every actionability / 403 assertion in them is retained**.
  Frontend e2e covers the own-vs-others sections and the view-only treatment.
- **Trade-off.** A Coordinator sees other Coordinators' and unassigned events but cannot open
  their detail (list-only scope), so those cards are intentionally non-interactive rather than
  links into a 403. The list is unpaginated, consistent with the Lead's oversight list
  (SCRUM-130 known limitation).
- **Owner.** Marcus (SCRUM-54). Broadens read-authorisation scope and adds a response field,
  so it is human-reviewed and merged only behind green CI. No schema or migration change.

### D29 — R11: reading a clarification follows the event-read rule, so the Lead can open any event (SCRUM-140)

- **Context.** Codex review R11 (High). The Event Coordinator Lead can list and read any
  non-draft event (D26 / SCRUM-131), but its detail screen also fetches
  `GET /events/<id>/clarification`, which was still gated on event relationship
  (`require_related_user`). The Lead is not "related" to another coordinator's event, so
  that one fetch 403'd and broke the whole detail page.
- **Decision (PO, Marcus).** Grant the clarification read to the **Lead** on any non-draft
  event — the same oversight exemption the event-read rule (`require_event_access`) already
  applies — so the Lead's detail screen loads. The fix is deliberately **Lead-only**: it does
  **not** open clarification (or event detail) to Coordinators, who stay record-scoped
  (SCRUM-54 is list-only; D28). It also does **not** open the endpoint to the Safety Officer:
  rather than route through `require_event_access` (which would additionally grant the Safety
  Officer's Confirmed/Preparation review window — an unnecessary surface with no clarification
  use), `get_clarification` keeps `require_related_user` for everyone except the Lead.
- **Verification.** Acceptance — the Lead opens the full detail screen (event + history +
  clarification, including a real note) on another coordinator's event; a non-owning
  Coordinator still 403s; the existing Safety-Officer-denied-clarification test still passes.
  Unit — a non-related Coordinator still 403s. Frontend e2e — the Lead opens an unrelated
  event's detail and it renders.
- **Trade-off.** A one-line role check duplicates the Lead exemption that
  `require_event_access` already expresses; this is intentional, to keep the Safety Officer
  out of the clarification endpoint.
- **Owner.** Marcus (SCRUM-140). Broadens read authorisation (the Lead), so it is
  human-reviewed and merged only behind green CI. No schema or migration change.

### D30 — R16: the Safety Officer reads event-scoped venue + technical detail to decide (SCRUM-145)

- **Context.** Codex review R16 (High). The operational safety check (SCRUM-128) lets the
  Safety Officer approve/reject/request-changes, but the review screen lacked the venue and
  technical detail SCRUM-128's AC requires ("expected attendance, venue capacity and layout,
  emergency access, accessibility requirements, equipment placement, crowd movement and known
  venue restrictions"). A working approve button without that information is not an informed
  safety check. (This is the decision the SCRUM-145 Jira comment records; that comment
  provisionally called it "D29" — now D29 is R11/SCRUM-140, so this decision is **D30**.)
- **Decision (PO, Marcus).** On a **Confirmed/Preparation** event, grant the Safety Officer
  **read-only, event-scoped** access to that event's venue booking(s), each booked venue's
  safety record (capacity, supported layouts, accessibility, facilities) and its equipment
  reservations. No catalogue access, no management, no cross-event access, no generic status
  changes — least privilege.
- **Implementation.** A single new endpoint `GET /events/<id>/safety-review-details`, guarded
  by `require_event_access` (which already gates the Safety Officer to the Confirmed/Preparation
  window and admits the event's related users/Lead). It reuses the existing repository reads and
  **projects each venue through a whitelist** (`safety_venue_view`) so operating hours, buffers,
  timezone and audit columns never reach the screen. Deliberately **not** done by loosening the
  per-resource endpoints: `GET /venues/<id>` is catalogue-wide, so widening it would break the
  event-scoping requirement. Frontend: a read-only "Venue & technical detail" panel on the
  Safety Officer's review screen (venues + bookings + equipment reservations).
- **Verification.** Unit — `safety_venue_view` exposes only the safety fields. Acceptance — the
  Safety Officer reads the detail on a Confirmed and a Preparation event, is denied outside the
  window (Planning) and when unrelated/not the Safety Officer; the existing safety decision
  journey (approve→Preparation; request-changes/reject→Planning) still passes. Frontend e2e — the
  panel renders capacity/layout/accessibility/facilities + booking + equipment, with no
  management controls.
- **Trade-off.** The Safety Officer gains a new read endpoint (not the catalogue), and reservations
  are shown rather than the thin equipment-request records, because reservation rows carry the
  placement detail (type + location) relevant to safety.
- **Owner.** Marcus, with Jerome (SCRUM-145). Broadens read authorisation (the Safety Officer),
  so it is human-reviewed and merged only behind green CI. No schema or migration change.

### D31 — Own-registration withdrawal with one optional cutoff (SCRUM-43)

- **Context.** SCRUM-41 already persists Registered/Withdrawn and maintains capacity,
  and SCRUM-44 displays current status. SCRUM-43 needs the attendee command, organiser
  conditions and a private receipt. The user requested implementation and asked to
  keep conditions simple; the proposal uses one optional timestamp.
- **Decision proposed for Jerome's review.** A nullable `events.withdrawal_closes_at`
  lets the owning Organiser set an earlier cutoff. NULL means until event start.
  A deadline must be future, timezone-aware and no later than the event start when
  saved. Conditions may be set in pre-confirmation states or Confirmed before the
  first signup and before start. They lock after any registration exists, including
  Withdrawn rows, so attendees' accepted conditions cannot be restricted retroactively
  through this control. Confirmed/Preparation registrations may be withdrawn strictly
  before both cutoff and start; other lifecycle states deny a new withdrawal.
- **API/access constraints.** Attendee-only `POST /events/{id}/registrations/withdraw`
  accepts `{}` and obtains identity solely from the existing session. Owning Organiser
  GET/PUT `/events/{id}/withdrawal-policy` uses `{closes_at}` and returns the saved
  cutoff/editability. Central role/record guards and configured Origin checks remain;
  query/body identity selectors are rejected and responses are no-store. The public
  offer exposes only the cutoff/refusal; own receipts expose the withdrawal timestamp.
  Home's private confirmation feed adds the withdrawal notification type while still
  excluding internal notices. No browser-role DB grants or SECURITY DEFINER functions.
- **Atomicity.** The withdrawal RPC locks the own registration, consistent with direct
  UPDATE ordering, then existing capacity triggers lock/update the event. A separate
  withdrawal guard rechecks stored conditions and wall time after that lock. The
  timestamp, one-place release and one private notification commit together. Concurrent
  or later retries return the original Withdrawn receipt, without a second mutation,
  timestamp change or notification. Failed notification creation rolls everything back.
  Policy writes lock the same event before checking for any registration.
- **Verification.** Migration replay twice; SQL rollback and privilege/invoker checks;
  41 focused HTTP/domain/database tests including two real competing withdrawals and
  a replacement signup; eight production-browser scenarios for confirmation, denial,
  refresh, navigation, Singapore cutoff and mobile/keyboard. Full local regression:
  1,541 API tests (96.47% coverage), 221 browser tests, 53 frontend unit tests, lint,
  build/TypeScript and diff checks. CLI advisors failed to connect to the non-TLS local
  container; no hosted advisor or CI result is claimed. See `docs/SCRUM-43.md`.
- **Trade-off.** Waiting-list promotion remains deferred SCRUM-80 under S4 scope;
  literal AC2/TC-43-02 is not implemented or marked passing. Jerome must accept that
  reconciliation. The existing unique event/attendee registration prevents undo or
  re-registration, and existing participant links/historical receipts are retained.
  Cancellation is not treated as attendee withdrawal; terminal records stay unchanged.
- **Owner.** Jerome owns the API/schema/domain/access and acceptance decision, with an
  independent human reviewer; Marcus owns release scope/merge. Codex authored the
  proposal. Human design review and green hosted CI gate merge. The migration was
  applied only to a disposable local database; shared deployment is a separate step.
  On 30 October 2026 the user explicitly authorized pushing and merging this proposal
  behind green CI, with the deferred waiting-list criterion already disclosed. This
  records merge authorization, without claiming an independent teammate review.

### D32 — FCFS precedence rule: confirmed booking beats tentative hold; no auto-cancellation of superseded holds (SCRUM-120)

- **Context.** SCRUM-120 (split from SCRUM-33). The overlap engine must implement a FCFS rule: when
  a confirmed booking and a tentative hold compete for the same venue/slot, the confirmed booking
  wins. S1 Q3, Q17, and Q31 all confirm this is the intended business rule. Additionally, S1 Q44
  states that superseded holds are cancelled manually by Venue Staff rather than auto-cancelled by
  the system.
- **Decision.** The domain engine (`_highest_priority` in `venue_overlap.py`) sorts conflicting
  bookings by a three-level key: (1) status tier -- Confirmed/Blocked rank 0, Held ranks 1,
  Requested/Pending rank 2; (2) `requested_at` ascending (earliest first) within the same tier;
  (3) `start_at` ascending as a final tie-breaker. A confirmed booking therefore always outranks a
  hold in the priority sort, and `can_confirm` returns `True` when the only conflict is tentative.
  No auto-cancellation: the application does not automatically cancel or expire the superseded hold
  when a confirmation wins. Venue Staff must manually cancel it.
- **Constraints.** S1 Q44 (no auto-cancellation); SCRUM-33 DB constraint structure (must not break
  existing `venue_bookings_no_overlap_hard` / `venue_bookings_one_tentative_hold`); `api/AGENTS.md`
  value-object rule (domain engine has zero DB/Flask dependency).
- **Verification.** TC-120-01 through TC-120-06 (unit, `test_venue_overlap.py`);
  TC-120-route-01 / TC-120-route-02 (integration, `test_booking_decision_route.py`);
  DB-120-01 through DB-120-03 (`supabase/tests/venue_fcfs.sql`). 100% statement and branch coverage
  on `app/venue_overlap.py` (106 stmts, 38 branches). All pass alongside the existing suite.
- **Trade-off.** Holding both a Confirmed and a (now-superseded) Held row in the DB simultaneously
  is intentional: the DB constraint allows one hard row + one soft row on the same slot so the
  application layer can perform FCFS resolution and then separately cancel the hold. The window
  between confirmation and manual hold-cancellation means the hold is visible as "Tentative" in the
  calendar even after confirmation -- acceptable per S1 Q44.
- **Owner.** Jerome (SCRUM-120). The FCFS resolution policy is a domain rule reviewed and merged
  only behind green CI.

### D33 — R12: failed-login counting is atomic; auth evidence is strengthened (SCRUM-141)

- **Context.** Codex review R12 (Medium), against SCRUM-20 (Secure login, stays Done). Four
  weaknesses: the failed-attempt increment was a read-then-write (`SELECT` count → `UPDATE`
  count+1 → re-fetch), so concurrent failures could lose an increment and undercount the
  lockout; lockout tests used a preset counter; inactivity-expiry was asserted from config
  rather than a timed journey; the logout UI swallowed a server failure.
- **Decision (PO, Marcus).** Make the increment atomic and strengthen the evidence, **without
  changing SCRUM-20's security policy** (5 consecutive failures → 15-minute lock; 30-minute
  inactivity expiry). A single SQL function `register_failed_login(user_id, max_attempts,
  lockout_minutes)` does `failed_attempts = failed_attempts + 1` and sets `locked_until` at
  the threshold in one `UPDATE … RETURNING`, so no increment can be lost. The thresholds are
  passed from the Flask constants, which stay the single source of truth. Logout now only
  treats sign-out as done once the server confirms it; a failure is surfaced to the user.
- **Implementation.** `supabase/migrations/20261030140000_scrum_141_atomic_failed_login.sql`
  (replay-safe `create or replace`, granted to `service_role`, registered in
  `supabase/tests/run.sh`). `auth.py` calls the RPC and uses its returned state, dropping the
  re-fetch. `app-shell.tsx` `handleLogout` awaits the logout and shows an error instead of
  redirecting on failure. Needs a one-time apply to the shared Supabase after merge.
- **Verification.** Unit — real sequential lockout (five actual wrong logins → 429, then
  recovery resets the counter) and a genuine inactivity-expiry test (1 s lifetime + real
  sleep → the idle session is rejected). Real-DB acceptance — the same sequential
  lockout/recovery through the live RPC. Frontend e2e — a failed logout surfaces an error and
  keeps the user on the page. The stateful auth fakes gained matching RPC support.
- **Trade-off.** The atomic counter now lives in SQL (one more RPC), consistent with the
  codebase's other atomic operations; the Python no longer re-fetches after a failure.
- **Owner.** Marcus (SCRUM-141). Changes the auth path + adds a DB function, so it is
  human-reviewed and merged only behind green CI; the migration is applied to the shared
  Supabase as a separate step.

### D34 — Who may cancel an event, and what cancelling does (SCRUM-69)

- **Context.** SCRUM-69 says "an authorised user can cancel an event; its venue and
  equipment reservations are automatically released" and "registered Attendees are
  notified", but does not name the authorised user. Before this story the generic
  `PATCH /events/{id}/status` let any related user (including Venue Staff, Tech Support
  and Attendees) set `Cancelled`. It released equipment, silently ignored a failure to
  do so, never released venue bookings and notified nobody. D14 flagged cancellation's
  release of resources as a known follow-up.
- **Decision (Ernest, 30 Oct 2026; for team confirmation).** The authorised users are:
  - the event's **assigned Coordinator**, because Coordinators manage only their assigned
    events (D26, SCRUM-130); and
  - the **Event Coordinator Lead**, who oversees every event, including unassigned
    submissions (SCRUM-131).
  Organisers do not cancel directly. Like any change after submission, they ask the
  Coordinator through a change request (SCRUM-46, S1 Q28). Any submitted or active
  state can be cancelled (Submitted, including its legacy sub-states, Planning,
  Confirmed and Preparation). Draft stays private (404), and Completed, Rejected and
  Cancelled are closed (409). A reason of 1–2000 characters is required.
- **How.** `POST /events/{id}/cancel` → the `EventCancellation` value object → the
  `cancel_event()` database function. In one transaction, under the event row lock, it
  re-checks the actor and state and:
  - cancels every Requested, Pending, Held and Confirmed venue booking for the event
    (the event will not take place);
  - releases Reserved/Pending equipment reservations;
  - sets `Cancelled` and records `event_cancelled` with the reason in the history;
  - notifies each **Registered** Attendee by name of event only, without the internal
    reason. It also notifies the Organiser with the reason and, when the Lead cancels,
    the assigned Coordinator. This is the cancellation trigger D27 deferred to SCRUM-69.
  Registrations are **not** changed. Per D31, cancellation is not an attendee withdrawal.
  Because the row stays *Registered*, the Attendee's own pages read the event status:
  a Registered or Waitlisted Attendee of a cancelled event sees **Event cancelled** (no
  "place is booked" text, no withdraw action); a withdrawal still shows as Withdrawn.
  The generic status route can no longer set `Cancelled` or move an event out of it, and
  change requests on a cancelled event can no longer be raised or reviewed.
- **Constraints.** Like `complete_event` (D13), the function is `security definer`, has
  an empty search path and is executable only by the backend role. No table grants change.
- **Verification.** Value-object unit tests, endpoint tests, the repository's error
  mapping, and real-database acceptance tests: resources released, registrations
  unchanged, the right recipients notified, refused actors audited, database re-checks,
  two simultaneous cancellations and the read-only cancelled event. Browser tests cover
  the panel, its visibility, the read-only view and the Attendee's cancelled-event view.
  The migration is replayed twice.
  See `docs/SCRUM-69.md`.
- **Trade-off.** Organiser self-service cancellation was not added; the team can revisit
  that if the customer wants it. Rejected events remain changeable through the generic
  route, as before (SCRUM-135 covers the full transition matrix).
- **Owner.** Ernest.

### D35 — Retiring a venue keeps its history and stops new bookings (SCRUM-26)

- **Context.** SCRUM-26: "As Venue Staff, I want to retire a venue, so that it's no
  longer offered for new bookings but its history is preserved." AC: a retired venue
  is excluded from new booking searches but preserved for historical records; existing
  confirmed bookings are unaffected; retirement is recorded with actor and timestamp.
  SCRUM-28 had already added the `venues.is_retired` marker and flagged retired venues
  in search, but nothing could set it and bookings did not check it.
- **Decision (Ernest, 31 Oct 2026; for team confirmation).**
  - **Who:** Venue Staff only, the story's actor and the role that manages the
    catalogue (SCRUM-24/25).
  - **Outstanding requests first:** a venue with Requested, Pending or Held bookings
    cannot be retired. Staff decide them first, so no request is rejected on their
    behalf and no Coordinator is surprised.
  - **Kept:** the venue row, its details and every booking. Confirmed bookings are not
    changed and can still follow their normal lifecycle (for example be cancelled).
  - **No new or moved bookings:** the booking routes refuse a retired venue, and a
    database trigger refuses any active booking inserted on, or moved to, a retired
    venue.
  - **Not offered to Coordinators:** their catalogue, search and suitability ranking
    leave retired venues out (filtered before pagination, so pages stay full). Venue
    Staff still see them in the catalogue, flagged as retired, for history.
  - **Read-only:** a retired venue's details cannot be edited. Retirement is final;
    there is no un-retire action in this story.
- **How.** `POST /venues/{id}/retire` → the `VenueRetirement` value object →
  `retire_venue()`. Under the venue row lock it re-checks the actor, refuses an already
  retired venue (409) or one with outstanding requests (409, with the count), sets
  `is_retired`, `retired_at`, `retired_by` and moves `revision` on, all in one
  transaction. The trigger reads the venue `FOR SHARE`, so a retirement and a new
  request racing each other cannot both succeed.
- **Constraints.** Like `cancel_event` (D34), the function is `security definer`, has
  an empty search path and is executable only by the backend role. A check constraint
  keeps `retired_at`/`retired_by` consistent with `is_retired`. `retired_by` has no
  foreign key on purpose: a second `venues → app_users` link would make the
  catalogue's existing `creator` embed ambiguous in PostgREST and break the catalogue
  as soon as the migration ran. `retire_venue()` is the only writer and checks the
  actor first.
- **Verification.** Value-object unit tests; endpoint tests (roles, input, refusals,
  Coordinator exclusion with full pages, suitability ranking, booking refusals,
  read-only edit, the repository's error mapping); real-database acceptance tests
  (audit recorded, every booking unchanged, outstanding requests refused, database
  re-checks, the trigger, Coordinator search, and a retirement racing a new request).
  Removing the trigger makes the guard tests fail. Browser tests cover the panel, the
  confirm step, refusals, visibility by role, the banner, the catalogue and the edit
  page. The migration is replayed twice. See `docs/SCRUM-26.md`.
- **Test change (flagged).** SCRUM-28's
  `test_search_filters_across_database_pages_and_flags_retirement` now searches as
  Venue Staff instead of a Coordinator. Its old assertion, that a Coordinator's search
  returns a retired venue flagged, contradicts SCRUM-26 AC1. The cross-page search and
  the retired flag are still checked, in the Venue Staff catalogue.
- **Trade-off.** Retiring needs outstanding requests decided first, which is one more
  step for staff but avoids silent rejections. Coordinators reading pages of a
  catalogue with many retired venues make a few more page reads. No un-retire action.
- **Owner.** Ernest.

### D36 — Approving a change request applies it atomically (SCRUM-138, R06)

- **Context.** Codex review R06 (High), against SCRUM-46 (stays Done). Change-request
  decisions only recorded a status: the requested change was free text, nothing was
  applied to the event, and downstream arrangements were never flagged. The PO
  confirmed the contract in a SCRUM-138 comment (29 Oct 2026; the comment calls it
  "D26" in the review's planned numbering, like the note in D25).
- **Decision (PO, Marcus; implemented by Ernest).**
  - An Organiser may attach **proposed values** to a change request, alongside the
    required description: title, description, purpose, category, expected attendance
    and the four requirement fields. Date and time are not requestable: rescheduling
    is SCRUM-48. Events have no duration field, so a duration change stays a
    described request.
  - **Approving** a request with proposed values applies them to the event in one
    transaction, recording the Coordinator and time on the request and in history.
  - A **significant** change, number of pax (`expected_attendance`) or venue
    (`venue_requirements`) per S1 Q7/Q11, marks the request significant and notifies
    the Coordinator to re-review. The event shows "Re-review needed" until the
    Coordinator marks that request Implemented.
  - **Nothing is auto-cancelled or un-booked.** The event's active venue bookings and
    equipment reservations are counted and shown for a manual re-check.
  - **Ordinary** changes apply without a flag. **Any failure rolls back** the whole
    approval: the event, the request, history and notifications stay unchanged.
  - A request that only describes a change keeps the SCRUM-46 behaviour (status only),
    since there is nothing to apply.
- **How.** `ChangeRequestProposal` validates proposals at request time with the
  existing event validation (required details cannot be blanked; unchanged values are
  refused). `approve_change_request()` locks the event and the request, re-checks the
  assigned Coordinator and both states, applies the values, stores what actually
  changed as `applied_changes` (from → to; a value already in place is not reported),
  sets `significant`, writes history and notifications, and returns the affected
  counts. Under Review, Rejected and Implemented use the existing path.
- **Constraints.** Like `cancel_event` (D34), the function is `security definer`, has
  an empty search path and is executable only by the backend role. Check constraints
  limit `requested_changes` to the changeable fields and allow `applied_changes` only
  on Approved or Implemented requests. No existing table grants change. The
  Coordinator's direct Planning edit route is out of scope (the PO limited this bug to
  the SCRUM-46 decision path); the structured re-review queue is SCRUM-47.
- **Verification.** Value-object unit tests; endpoint tests (what may be proposed,
  which decisions apply, refusals, the repository's error mapping); real-database
  acceptance tests (values applied with actor and time, significant pax and venue
  changes flagged with every booking and reservation unchanged, rollback when the
  event table refuses a value, values already in place, database re-checks, stored
  proposal constraints, Implemented keeping the record, two simultaneous approvals
  applying once). Browser tests cover proposing, field errors, approving, the
  re-review notice, marking implemented and a failed approval. The migration is
  replayed twice. No existing test was changed. See `docs/SCRUM-138.md`.
- **Trade-off.** Proposals are validated when raised; if the event changes before
  approval, only values that still differ are applied and reported. The re-review
  flag is a notice, not a queue. SCRUM-47 can build on `significant`.
- **Owner.** Ernest (implementation); Marcus (PO decision).

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
| Event cancellation (D34) | Partially | Endpoint, DB function and test scaffolding; **authorised-user rule human-decided** | `docs/SCRUM-69.md` |
| Venue retirement (D35) | Partially | Endpoint, DB function, trigger and test scaffolding; **retirement rules human-decided** | `docs/SCRUM-26.md` |
| Change-request apply (D36) | Partially | Endpoint, DB function and test scaffolding; **apply/re-review contract PO-decided** | `docs/SCRUM-138.md` |

**Summary statement.** AI accelerated routine implementation and scaffolding throughout,
under human-authored specifications. Every safety-critical decision — the overlap engine,
the confirmation and safety gates, and the authentication/authorisation model — was
human-designed, documented in this log, and review-gated in CI before merge. Known
trade-offs (notably the former deferred technical-arrangements seam in D5, addressed
locally by D22, and the interim
auto-assign in D9) are recorded explicitly rather than left implicit.

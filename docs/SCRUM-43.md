# SCRUM-43 — Withdraw registration

[Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-43) · Jerome · Sprint 4 · 5 points.

Implemented on `feature/SCRUM-43-withdraw-registration`. On 30 October 2026 the user
explicitly authorized push and merge behind green hosted CI, after disclosure of the
waiting-list limitation. No shared database deployment is included.

## Walkthrough

1. Before the first signup, the event's Organiser opens its event page →
   **Withdrawal conditions**. Leave the optional deadline blank to permit withdrawal
   until the event starts, or set an earlier deadline in Singapore time. Save it.
   Conditions lock after the first signup, even if that attendee later withdraws.
2. An Attendee opens **My registrations → View event → Withdraw registration**.
   The dialog explains that the place will be released and the withdrawal cannot
   be undone. **Keep registration** is focused first and sends no request.
3. **Confirm withdrawal** shows the persisted Withdrawn receipt and timestamp.
   My registrations shows the same state. Home's **Registration confirmations**
   includes the withdrawal receipt and links back to the current registration.
4. Another attendee can take the freed place if registration is still open. A
   repeated withdrawal returns the original receipt and cannot release their place.

## Setup

Apply `supabase/migrations/20261030062503_scrum_43_withdraw_registration.sql` after
SCRUM-40/41 and the SCRUM-49 notification migration. The migration is replay-safe;
existing events get a nullable `withdrawal_closes_at`, meaning event-start cutoff.
Apply the reviewed migration before running this API/frontend version against the
shared development database. It has only been applied to disposable local PostgreSQL.
Never apply `supabase/tests/*.sql` to shared Supabase.

## Acceptance and boundaries

- **AC1:** Attendees can withdraw only their own saved registration. A Confirmed or
  Preparation event must not have started, and any organiser deadline must not have
  been reached. Exact cutoff equality is closed. Draft, Planning, Rejected,
  Cancelled, Completed and missing-start events do not allow a new withdrawal.
- **AC2:** The existing capacity trigger releases exactly one place. Signup and
  withdrawal serialize on the parent event; duplicate withdrawals serialize on the
  registration row and return one receipt. A later retry cannot release a replacement
  attendee's place. The place becomes available to ordinary signup if that window is open.
- **AC3:** The stored withdrawal timestamp survives reload; the receipt and registration
  list display it. One private in-app notification is recorded in the same transaction.
- **Deferred part of AC2:** waiting lists and first-waitlister promotion remain SCRUM-80,
  explicitly deferred by Sprint 4 Goal & Scope. This change does not implement or claim
  that scenario; TC-43-02 remains unexecuted pending SCRUM-80. Jerome must accept this
  scope reconciliation before merge. No Confluence test status has been changed.

There is one optional cutoff, with no enable switch, configurable formulas, reasons,
refunds or waiting-list mechanism. The existing unique registration identity remains:
withdrawal cannot be undone and does not enable re-registration. Event participant
links and historical signup receipts remain, preserving the existing public receipt
access. New APIs do not grant planning access or expose other attendees' information.

## Contract and implementation

| Endpoint | Caller | Request and result |
| --- | --- | --- |
| `GET /events/{uuid}/withdrawal-policy` | Owning Organiser | `withdrawal_policy: {closes_at, can_edit}` |
| `PUT /events/{uuid}/withdrawal-policy` | Owning Organiser | `{closes_at: null}` or a future zoned timestamp no later than event start; returns saved policy |
| `POST /events/{uuid}/registrations/withdraw` | Attendee | `{}` only; returns own `registration: {id, event_id, status, registered_at, withdrawn_at}` |

Existing `GET /events/{uuid}/registration-offer` adds the public cutoff and refusal
reason, and includes `withdrawn_at` in an existing registration. The existing private
confirmation feed additionally allows `registration_withdrawn` and returns
`notification_type`; organiser/staff notifications remain excluded. It remains a
bounded historical feed; My registrations is the current-state source.

Every new route requires the configured Origin and the existing session/role guard.
Withdrawal rejects all body identity selectors and query parameters. Expected errors
are 400 malformed input, 401 guest, 403 role/owner/Origin denial, 404 no own
registration, 409 closed conditions, and safe 503 database/uncertain-commit failure.
Responses retain `Cache-Control: no-store`. After a failed withdrawal response, the
dialog requires closing and refreshing the receipt before another attempt; it never
announces a successful withdrawal from an unconfirmed response.

Pure rules live in `registration_withdrawal.py`, HTTP in `events.py`, and persistence
in `registration_repository.py`. SQL independently checks stored policy and wall time
after the capacity guard obtains the event lock, protecting direct backend updates.
The notification trigger runs in the same transaction; notification failure rolls
back registration, timestamp and count. Functions use SECURITY INVOKER and empty
search paths; no browser role receives table or RPC privileges. See Decision D31.

## Verification — 30 October 2026

- Full API suite against fresh disposable PostgreSQL 17/PostgREST: **1,541 passed**,
  **96.47% application coverage**, no skips.
- **41 focused withdrawal tests passed**, including 10 real database cases. They
  cover ownership, exact boundaries, role/Origin/input failures, current receipts,
  freed-capacity replacement signup, direct-update denial and competing withdrawals.
- Migration replayed twice from a clean database. SQL contract checks passed for
  one-place/one-notification behavior, policy lock, backend-only function grants,
  SECURITY INVOKER and rollback when notification creation fails.
- Full production Playwright regression: **221 passed**, including eight new
  withdrawal scenarios: normal, cancellation, closed states, uncertain response,
  keyboard/mobile and organiser cutoff persistence/lock. Browser scenarios use mocked
  HTTP; the API acceptance tests separately exercise actual database transactions.
- Frontend **53 unit tests**, ESLint, production webpack build/TypeScript, backend
  Ruff and `git diff --check` passed. Desktop/mobile dialog screenshots inspected.
- Supabase CLI advisors could not connect to the disposable non-TLS PostgreSQL
  container (TLS refused, including with `sslmode=disable`). SQL privilege/invoker
  checks passed; this is not a claim that hosted Supabase advisors passed.

Existing test assertions, names and files were not weakened or replaced. The only
change to existing SQL test infrastructure appends replay and execution of SCRUM-43's
new migration/checks to `supabase/tests/run.sh`. Dependencies and lockfiles are unchanged.
Hosted CI, shared-environment smoke testing and human acceptance remain outstanding.

## Five reviewer questions

- **Delegated:** implement SCRUM-43's own-registration withdrawal, organiser cutoff,
  released capacity, timestamp/status, notification, tests and handoff documentation.
- **Constrained by:** Jira ACs, S4 scope and planning, existing capacity/receipt and
  session/Origin/RBAC patterns, root/backend/frontend AGENTS, semantic UI tokens, and
  the user's request to keep conditions simple.
- **Evidence:** the local tests, SQL replay/rollback/permissions checks and build/lint
  results above. These do not substitute for remote CI or a real shared demo.
- **Human review:** Jerome reviews the cutoff/default and lock-after-signup policy,
  no-re-registration/retained-receipt behavior, API/schema/access and transaction design,
  attendee/organiser UX, and deferred waitlist criterion. An independent human reviews
  the PR. Shared migration deployment needs the owner's separate authorization.
- **Accountability:** Jerome owns design/acceptance for SCRUM-43; Marcus owns release
  scope/merge decisions. Codex authored this implementation proposal. Jira stays out of
  Done until an explicitly authorized merge behind green CI.

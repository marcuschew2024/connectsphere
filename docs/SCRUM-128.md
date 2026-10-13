# SCRUM-128: Operational Safety Check before preparation

> Status: **in progress** — increment 1 of 3 (pure decision + unit tests) is complete.
> Increment 2 = `POST /events/<id>/safety-check` endpoint + "Preparation" status +
> integration tests; increment 3 = Safety Officer review UI + E2E. This doc grows with
> each increment. Builds on SCRUM-39 (branch `feature/SCRUM-128-safety-check`).

As a Safety Officer, I want to review a confirmed event's operational safety and
approve / reject / request changes, so unsafe events do not proceed to preparation
(Week 7 customer change #6). The event lifecycle gains a stage:
**Confirmed → (safety review) → Preparation**.

## The state machine (PO decisions)

The safety review acts on a **Confirmed** event — there is no separate "Operational
Safety Check" status; a Confirmed event is the safety-review queue. The Safety Officer's
decision moves the event:

| Decision | New status | Meaning |
|----------|------------|---------|
| approve | **Preparation** (new status) | the event may proceed to preparation |
| request_changes | Planning | return to re-review the affected venue/technical arrangements |
| reject | Planning | safety-rejected; the team reworks and resubmits |

An event **cannot reach Preparation except through an approval** — approval is the only
transition that produces `Preparation`, so the preparation gate is enforced by construction.

## Why a separate value object

Like `EventDecision` / `BookingDecision`, the decision rule is pure logic — valid action,
the status it produces, and the reason required when the event is sent back. It has no
persistence, so it is unit-testable in isolation; the endpoint and repository handle the
status change and the audit. The implementation lives in `api/app/safety_decision.py`.

- `SafetyDecision(action, reason=None)` — `action` is `approve` / `request_changes` /
  `reject`. A **non-blank reason is required** for `request_changes` and `reject` (the team
  needs to know what to address); it is dropped on `approve`.
- `SafetyDecision.from_payload(data)` — build from client JSON (`decision`, optional
  `reason`), rejecting unknown keys.
- `.status` → the event status the decision produces.
- `.approved` → `True` only for `approve`.
- `.returns_to_planning` → `True` when the decision sends the event back.

## Test coverage

`api/tests/test_safety_decision.py` (24 unit cases, parametrised). Each traces to an AC and
would fail for a plausible wrong implementation:

- approve → `Preparation`, `approved`, reason dropped;
- request_changes / reject → `Planning`, reason trimmed, not approved;
- reject/request_changes with a missing, blank, or non-text reason → `ValueError`;
- unknown or wrongly-cased action → `ValueError`;
- `from_payload` builds approve/reject, and rejects unknown keys / non-dict input.

The endpoint-level ACs (Safety Officer role, Confirmed-only precondition, actor/timestamp
audit, the review information shown, and the preparation gate) are covered in increment 2.

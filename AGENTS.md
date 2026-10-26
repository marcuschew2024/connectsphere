# ConnectSphere — project rules for AI agents

Read this before making changes anywhere in the repo. Area-specific rules live in
`api/AGENTS.md` (backend) and `frontend/AGENTS.md` (frontend) — read the one you are
working in as well.

ConnectSphere is a campus event-management system (event requests → coordination → venue
booking → confirmation → safety check), built by a student team. Treat it as a real
product: correctness, security, and accountability matter.

## The working model: Delegate → Constrain → Verify → Own

AI assistants do routine implementation here, but **a human designs, reviews, and owns
every non-trivial change.** Before you consider a change complete, you must be able to
answer these **five reviewer questions** — they are the standing review bar for any
agent-authored change:

1. **What was delegated?** — the task, with its acceptance criteria.
2. **What constrained the agent?** — the specs, patterns, and guardrails you worked within.
3. **What evidence supports it?** — the tests (and their intent), lint, and CI that prove it.
4. **Where is human review needed?** — what a person must look at before this merges.
5. **Who is accountable?** — the owner of the decision.

If you cannot answer all five, the change is not ready.

## Record durable decisions

For any decision that is **architectural, safety-critical, hard to reverse, or a contract
others depend on** — schema changes, domain-model/value-object changes, auth/access-control
logic, status-transition rules, or an accepted trade-off — **add an entry to
`docs/DECISION_LOG.md`** (context · decision · constraints · verification · trade-off ·
owner). Routine work that follows an existing pattern does not need an entry. This log is
how any teammate or reviewer understands *why* the system is built the way it is; keep it
current.

## What an agent may do vs what a human must review

- **Agent may do, with CI + review as the gate:** CRUD and read endpoints, UI against the
  existing design system, test scaffolds, and refactors that stay within an established
  pattern.
- **A human must design and review before merge:** API contracts, domain-model/value-object
  changes, database schema/migrations, authentication and authorisation logic, and any
  status-transition or safety gate. These always need a named owner and an explicit
  Decision Log entry.

## Testing discipline

- **Tests encode intent, not the implementation.** Write tests from the acceptance
  criteria so that a plausible wrong implementation would fail them ("what would have to
  break for this to fail?"). Prefer a few prescriptive end-to-end tests (happy / error /
  edge) over many implementation-coupled unit tests.
- **Never weaken the suite to go green.** Do not modify, delete, or rename existing tests
  to make a change pass. If a test genuinely must change, that is a reviewable decision —
  flag it and explain why. CI enforces this.
- A green suite is **necessary but not sufficient** — it does not replace review.

## Team working agreement

- **Never push to a remote or merge to `main` without the owner's explicit instruction.**
  Work on a feature branch (`feature/SCRUM-XX-short-description`); merge only behind green
  CI (lint + build + e2e).
- **Small increments, explain every piece** — each change should be understandable and
  defensible on its own.
- **Jira is the source of truth** for scope and status; keep it current (start → In
  Progress, merge → Done). A sub-task's assignee follows its parent story's owner.
- Add one `docs/SCRUM-XX.md` per story when it is done; add one `supabase/*.sql` per story
  that needs a schema change.
- Keep the repo to **durable artifacts**. Transient, session-level scratch notes do not
  belong in the shared repo.

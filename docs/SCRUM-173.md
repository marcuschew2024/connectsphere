# SCRUM-173 — confirmation response matches persisted state

PR #112 implements Jira SCRUM-173's chosen approach: once the authoritative event
status write succeeds, a repository HTTP error while recording history or notifying
the Organiser must not turn a successful confirmation into a misleading 503 response.
History and notification are attempted independently and secondary failures are logged.

The implementation follows the existing best-effort audit pattern in `edit_event`.
It preserves confirmation eligibility, access checks, and the status-write failure path;
it introduces no schema change or transaction/RPC contract.

Evidence: original GitHub CI runs `41614525176` and `41614488037` passed frontend,
API, and integrated browser/database checks. Failure-injection tests in
`api/tests/test_event_confirmation_route.py` cover unavailable history persistence and
unavailable notification persistence, requiring HTTP 200 and Confirmed state; the
notification-failure case also requires the history row to survive. Updated branches
must pass CI again before merge.

The trade-off requiring human ownership is that secondary history/notification writes
can be lost: this is not atomic persistence, an outbox, guaranteed retry, or automatic
recovery. Marcus Chew, the PR author, is the accountable decision owner. Jira records
the chosen approach; the repository owner authorized pushing and merging on
3 November 2026. The documentation records that authorization without claiming an
independent review occurred. See DECISION_LOG.md for the durable decision.

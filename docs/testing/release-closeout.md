# Release 1 closeout — 3 November 2026

Baseline: `9b7973b24e037b6bd96faf47742561594370ce36` (PR #107 merged).
This is an evidence reconciliation, not release acceptance. No application code or
test assertions were changed in this documentation increment.

## Merged work and Jira

| Issue | Evidence | Reconciled state |
| --- | --- | --- |
| SCRUM-167 | [PR #104](https://github.com/marcuschew2024/connectsphere/pull/104), green CI and recorded live notification check | Done; corrected from To Do |
| SCRUM-143 | [PR #98](https://github.com/marcuschew2024/connectsphere/pull/98) updates README/C4 source/env | In Review: PNG exports refreshed and visually checked in this local increment; merge/review and final clean-checkout rehearsal remain outstanding |
| SCRUM-169 | [PR #107](https://github.com/marcuschew2024/connectsphere/pull/107), green CI, hosted R5 guard observed | Already Done; PR and hosted observation linked in Jira |

## Hosted observations

Read-only checks against `pqdkfrvqjeqlsdwvddcd` confirmed the four occupied-window
columns, R1's per-venue write guard, R5's enabled block-write lock trigger and
maintenance function using setup/turnaround occupation, and SCRUM-166's
reschedule-to-Planning logic. These are targeted checks, not a complete schema diff
or proof that the deployed API/frontend matches this commit. Migration history is
empty despite these manually applied changes; the release owner must retain the
actual deployment order rather than inventing migration timestamps.

After the user's explicit instruction to cancel the old Cedar demo bookings,
`BKG-012` / `BKG-014` at `[SEED CS10] Cedar Seminar Room` were changed from
Confirmed to Cancelled on 3 November 2026 at 14:10:29 SGT (06:10:29 UTC).
The transaction checked their exact IDs, venue, original times on 31 October and
Confirmed status, and required exactly two updates. Both booking rows remain.
Each records the cleanup reason and timestamp; the note identifies Codex using the
administrative SQL connection without claiming an application-user identity.
Existing event history was retained, and `EVT-017` / `EVT-019` remain Planning /
Confirmed respectively. No event cancellation was performed.

The existing database trigger refreshed the conflict report automatically. A
separate read confirmed both Cancelled statuses and **zero entries** in
`problematic_venue_bookings`. This resolves the historical demo-data pair; it does
not resolve the separate A2 safety-gate finding below or establish release acceptance.

## Acceptance decisions — resolved 3 November 2026

These four items were resolved by the Product Owner (Marcus Chew) for Release 1, each
with the accountable reviewer noted. See the matching P1–P4 entries ("Release 1
acceptance decisions — resolved 3 November 2026") at the end of the Decision Log.

| Area | Resolution | Accountable review |
| --- | --- | --- |
| Lead booking access | **Confirmed — defer.** Retain the current denial: the Event Coordinator Lead oversees/reassigns events and reads event overviews but does not get direct booking read/change/cancel endpoints in R1. No new authorization without review. | Ernest with Marcus (PO) |
| Safety information | **Confirmed — meets AC by interpretation.** The SCRUM-145 panels present all resourced, event-specific data; emergency access, crowd movement and known venue restrictions appear as on-site assessment prompts because R1 does not model them as structured venue data. Accepted as satisfying "present … to assess", not waived; structured capture is a post-R1 enhancement. | Marcus (PO) with Jerome |
| Advisory capacity | **Resolved in code — SCRUM-174.** The hard `attendance > capacity` reject is removed from the booking request/change paths; over-capacity is surfaced as a suitability advisory and each booking's `capacity_warning` (SCRUM-152), and the Coordinator decides, matching SCRUM-29's advisory AC. Double-booking overlaps and attendee-registration capacity remain hard limits. | Jessica with Marcus (PO) |
| Registration window | **Confirmed — compliant, no change.** Registration opens while the event is Confirmed and closes when safety approval advances it to Preparation — exactly SCRUM-40's "only for Confirmed events". No requirement keeps it open into Preparation. Accepted as compliant. | Jerome with Marcus (PO) |

## Evidence refresh

[Execution provenance](release-verification/execution.json) identifies existing
[main CI run 41573118557](https://github.com/marcuschew2024/connectsphere/actions/runs/41573118557)
and hashes the retrieved evidence. The refreshed manifest removes obsolete claims
about R1 syntax/harness failures, unavailable database parity evidence and absent
hold-expiry implementation. It adds mappings for R1 buffer changes, R5 maintenance
boundaries/replacement, hold release and full-duration confirmation.

The genuine remaining audit findings stay open:

- A1: an Expired hold blocks confirmation despite a valid replacement.
- A2: cancellation of the only confirmed venue does not prevent safety approval.
- A3: a buffer increase can create an unreported conflict with existing maintenance.
- A4: confirmation can persist before its history/notification operation fails.

Existing passing evidence is reassembled, not rerun. Earlier artifacts remain in Git
history. Numeric coverage and passing mapped checks are not human acceptance.

## Documentation consolidation

The [documentation guide](../README.md) identifies the maintained source for each
purpose. The old E2E matrix now points to the canonical manifest and generated
checklist; its original rows are retained in the archive. Ten earlier JSON
verification snapshots and the original SCRUM-146 handoff are also archived, with
story references updated. Required story records, decision history, architecture
sources/exports and final evidence remain available.

Cleanup validation confirmed all 26 requirement mappings, eight evidence-tool
checks, 80 relative links in changed/new Markdown documents, unchanged hashes for
all ten archived JSON snapshots, and the generated report's matching verification
source digest. No application code or test assertions changed. The full product
suite was not rerun for this documentation-only consolidation.

## Final release gate — after the outstanding fixes merge

1. Pin the final merged commit and reviewed migration order. Reconcile the open
   audit findings and acceptance decisions; record actual owners/review evidence.
2. Rehearse setup from a clean checkout using documented dependencies and a new
   isolated database. Never run the SQL test harness on shared Supabase: it creates
   test fixtures and additional cleanup grants.
3. Execute the SQL harness/replay/concurrency checks, Ruff, full backend coverage
   suite, frontend lint/unit coverage/build, controlled Playwright suite, combined
   coverage and real browser/API/database journeys. Use the commands in
   [testing README](README.md); preserve failures and skips honestly.
4. Generate a new checklist from that run's matching JUnit/coverage/logs. Record
   tested SHA, source digest and execution provenance; do not recycle this baseline
   as a post-fix release pass.
5. Compare the shared schema's columns, constraints, trigger definitions/enabled
   states, function definitions and grants with the final migrations, including
   R1 and R5. Resolve differences through reviewed migrations.
6. Smoke-test the exact deployed browser/API/database combination, including
   login/cookies, booking/search/calendar buffer parity, maintenance and replacement,
   hold expiry through confirmation, resource changes before safety approval,
   notification failure recovery and the agreed registration window.
7. Confirm conflict-report disposition and obtain release-owner acceptance. Finish
   authentic Scrum evidence, final artifacts and instructor access separately.

This final gate has **not** run: the outstanding audit fixes are not on the recorded
main baseline. The user authorised pushing and merging this documentation increment
behind green CI. Its merge checks do not constitute final product acceptance.

## Review ownership

- Delegated: documentation, traceability and Jira reconciliation; execute the
  explicitly authorised two-booking demo cleanup and document outstanding decisions.
- Constraints: 20 core features plus six Week 7 changes, current Jira ACs, existing
  D58–D66 and project rules; no weakening tests or inventing acceptance.
- Evidence: linked merged PRs/current CI, refreshed mappings and artifact hashes,
  targeted hosted checks, verified cancellation outcomes and report validation.
- Human review: acceptance decisions and final release
  sign-off; any resulting schema/auth/status change needs its own reviewed design.
- Accountability: Marcus for release evidence, with Ernest/Jessica/Jerome for the
  areas named above; no approval is implied by listing an owner.

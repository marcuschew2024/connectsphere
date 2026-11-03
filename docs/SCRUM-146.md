# SCRUM-146 Release testing and traceability

[Jira task](https://spm-g6t4.atlassian.net/browse/SCRUM-146). Accountable release
owner: Marcus. This story delivers requirement mappings, coverage reporting and
real integrated journeys. Its Done status does not establish complete Release 1
acceptance.

## Current evidence

- [Canonical mappings](testing/requirements.json): requirement intent, owners,
  test names, SQL assertions and unresolved acceptance gaps.
- [Generated checklist](testing/release-verification/requirements.md): recorded
  outcomes and coverage; use this report for current numbers.
- [Execution provenance](testing/release-verification/execution.json): tested
  revision, CI run, artifact hashes and execution limits.
- [Release closeout](testing/release-closeout.md): outstanding findings, pending
  decisions, hosted observations and the final release gate.
- [Testing guide](testing/README.md): reproduction commands and test-layer limits.

The 3 November documentation refresh reconciles merged PRs #101–104 and #107
against main `9b7973b`. It reassembles existing CI evidence, not a new test run or
final release acceptance. A1–A4 and unresolved owner decisions remain open.

## Historical implementation evidence

The [31 October handoff](archive/testing/SCRUM-146-2026-10-31.md) preserves the
original implementation details, test counts, review constraints and then-open
gaps. The [notification fixture isolation evidence](archive/testing/notification-isolation-2026-10-31.json)
records the repeatability and failure-cleanup checks. Historical counts are not
maintained as a second current release dashboard.

## Review ownership

- **Delegated:** requirement traceability, coverage evidence, integrated journeys
  and documentation consolidation; retain submission and historical evidence.
- **Constrained:** project brief and Jira ACs, repository rules, existing test
  assertions, honest provenance and no invented acceptance decisions.
- **Evidence:** linked checklist and execution metadata; documentation cleanup
  checks mappings, preserved artifact content and local links.
- **Human review:** Marcus reviews release evidence and the submission set;
  story owners decide acceptance gaps. Documentation cleanup does not approve them.
- **Accountability:** Marcus owns release scope; each story owner owns its rules.
  The user authorised pushing and merging this documentation increment behind green
  CI; independent teammate acceptance and the final release gate remain separate.

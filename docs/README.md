# Documentation guide

Use this index to distinguish current guidance from historical evidence. Jira is
the source of truth for scope and status; passing tests do not replace owner acceptance.

| Purpose | Maintained source |
| --- | --- |
| Install and run the app | [Repository README](../README.md) |
| Release findings, decisions awaiting review and final checks | [Release closeout](testing/release-closeout.md) |
| Requirement-to-test mappings | [Requirements manifest](testing/requirements.json) |
| Recorded test outcomes and coverage | [Generated checklist](testing/release-verification/requirements.md) and [execution provenance](testing/release-verification/execution.json) |
| Run verification and interpret each test layer | [Testing guide](testing/README.md) |
| Durable design and policy decisions | [Decision Log](DECISION_LOG.md); proposed entries remain pending until accepted |
| Architecture and setup handoff | [SCRUM-143](SCRUM-143.md) and [design diagrams](design/diagrams/) |
| Story-specific acceptance and implementation evidence | Each `SCRUM-XX.md` in this directory |
| Earlier reviews, counts and handoffs | [Historical archive](archive/README.md) |

Keep per-story records, architecture sources and required exports, final release
evidence, and authentic Scrum/submission records. Do not copy changing test counts
into new summaries: link to the generated checklist. Retain dated story results as
historical evidence, with their original scope and limitations.

Temporary inspection output and duplicate bundles do not belong in the submission
set. Check that their source artifacts are retained before removing them.

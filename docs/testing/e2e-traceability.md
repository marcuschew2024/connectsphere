# E2E requirement traceability

The maintained mapping is [requirements.json](requirements.json). The
[generated evidence checklist](release-verification/requirements.md) joins that
mapping to recorded test results; [execution provenance](release-verification/execution.json)
identifies the tested revision and evidence source.

Update the manifest when an approved requirement or test mapping changes, then
regenerate the checklist using the [testing guide](README.md). Do not maintain a
second manual pass/fail table here. A passing mapped scenario does not establish
complete acceptance of its requirement.

The [historical Sprint 4 matrix](../archive/testing/e2e-traceability-sprint-4.md)
retains the original row numbers and owner assignments cited in story documents.
For unresolved findings and release decisions, use [release closeout](release-closeout.md).

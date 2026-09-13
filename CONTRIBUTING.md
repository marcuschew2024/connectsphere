# Contributing to ConnectSphere

## Branch naming

Create a branch off `main` for every piece of work. Use the pattern:

- `feature/US-x.x-short-desc` - new functionality (e.g. `feature/US-1.2-login-page`)
- `fix/short-desc` - bug fixes (e.g. `fix/health-cors-origin`)
- `test/short-desc` - test-only work (e.g. `test/api-health-coverage`)

Keep the short description in kebab-case and tie `US-x.x` to the user story.

## Linking work to Jira

Every branch and pull request must reference the Jira issue it implements using the
issue key (e.g. `SCRUM-14`). Put the key in the PR title or description and in your
commit messages where practical.

## Pull request rules

- Every PR needs at least one reviewer approval before merge.
- A human must have read and understood the code, including any AI-generated parts.
  Do not approve or merge code you do not understand.
- Fill in the pull request template completely, including the Definition of Done checklist.

## Definition of Done

A change is done only when:

- It is linked to a Jira issue (SCRUM-xx).
- All acceptance criteria for that issue are met.
- Tests are written and passing (unit and/or E2E as appropriate).
- No regressions are introduced.
- RBAC, input validation, and error handling are considered; no secrets are committed.
- Documentation is updated where relevant.
- CI is green.

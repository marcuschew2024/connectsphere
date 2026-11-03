# SCRUM-143 — Current architecture and release setup documentation

Owner: Marcus coordinating the team. Status: In Review; final clean-checkout setup
rehearsal on the frozen release remains outstanding.

[PR #98](https://github.com/marcuschew2024/connectsphere/pull/98) merged the README,
frontend environment example and C4 source corrections: seven roles, Flask-owned
session authentication, Supabase PostgreSQL and in-app notifications. Its PR body
explicitly left the PNG exports and clean-checkout rehearsal unfinished.

## 3 November documentation increment

The [context source](design/diagrams/c4-context.mmd) and
[container source](design/diagrams/c4-container.mmd) now use Mermaid flowchart routing
to express the same C4 model without overlapping relationship labels. C4 element
types, seven actors, technology labels, system boundary and external database remain
explicit; the Structurizr model is unchanged. This is a presentation correction,
not a change to application architecture or role permissions.

Both [context PNG](design/diagrams/c4-context.png) and
[container PNG](design/diagrams/c4-container.png) were rendered and visually inspected.
The old experimental C4 renderer drew edges/labels through nodes, so those outputs
were not kept. The final exports have readable labels and separate relationships.

To regenerate, use Mermaid CLI (`mmdc --help`) with a locally available Chromium
browser configured through `--puppeteerConfigFile`, and render each `.mmd` to its
same-name `.png` with `--scale 2`. The CLI was installed in a temporary tooling cache;
no application dependency or lockfile changed.

## Remaining acceptance

- Review and merge the refreshed documentation/images through the normal gate.
- After outstanding release fixes merge, rehearse README setup from a clean checkout
  with an isolated database and record the exact revision, steps and results.
- Confirm the authoritative SQL deployment order. Do not run the CI SQL harness
  against shared Supabase; it installs disposable fixtures and test cleanup grants.
- Verify current C4 artifacts match the shipped release, and confirm instructor access.

The [release closeout](testing/release-closeout.md) records current evidence and the
final gate. A passing baseline CI run does not constitute the setup rehearsal.

## Review bar

Delegated: reconcile architecture/setup documentation and stale image exports.
Constraints: existing C4 model, seven roles, Flask auth, in-app notifications and
project documentation rules. Evidence: successful rendering and visual inspection;
traceability checks are recorded in release evidence. Human review: diagram meaning,
clean setup and final deployment instructions. Accountable owner: Marcus; no human
acceptance is asserted by this document.

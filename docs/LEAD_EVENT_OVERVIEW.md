# Lead event overview

The project owner requested an intuitive way to follow already-assigned events as the event list grows. This is a frontend follow-up to SCRUM-130/131, on the existing SCRUM-135 branch. The API already returned all non-draft events and Coordinator names. No backend, schema, assignment-authority or status-transition change is needed.

## Behaviour and acceptance

- The Lead can reach the page through Event overview in the sidebar, or Supervised events on Home.
- Summary links show total counts and jump to Needs assignment, Assigned and active, or Past events.
- The unassigned queue shows active unassigned requests oldest submission first. This includes legacy active unassigned records that the existing API permits the Lead to assign.
- Assigned events show the current Coordinator, last assignment time, readable event reference/date, status and detail link. Recent assignments appear first.
- Completed, Rejected and Cancelled events move into a separate Past events section, with detail links and no reassignment controls. Drafts remain excluded.
- Search matches event names or references, case-insensitively. Coordinator and displayed-status filters combine with search; Clear filters resets all three. Global summary counts remain totals, while section counts and matching totals reflect filters.
- Each section has independent six-event pages. Searching/filtering resets pagination; assignment resets pages so the latest assignment is discoverable.
- A successful assignment has a persistent page-level notice and Open updated event link. Under a Coordinator filter, reassigning away naturally removes the event from that filtered result; the notice link still opens the updated record.
- Refresh events retrieves changes made elsewhere. Errors and timeouts provide retry. Other roles cannot load this frontend overview; existing API authorization remains authoritative.

The page retains existing assignment/reassignment labels and actions. Existing controlled browser tests are unchanged. The real lifecycle test now searches for its newly created event reference before assigning it, because the queue is paginated, and verifies it remains in Assigned events after reload. This changes navigation to match the requested UI; no existing assertion or scenario was removed.

## Review and accountability

Delegated scope is the overview/navigation and acceptance criteria above. Constraints are the existing Lead-only API, assignment rules, ownership/status restrictions, semantic design tokens and protected test labels. The original SCRUM-130 owner is Ernest Wong; the requesting project owner owns acceptance of this UI follow-up. Human review should confirm the grouping, date meanings, filters and behaviour after reassignment. This does not claim their independent review or alter Jira ownership/status.

Verification is recorded in docs/testing/lead-overview-verification.json. Existing local manual-test records are preserved; integrated checks add ordinary sample events. No shared database is changed. Hosted CI and human review remain required before merge.

Manual check: sign in as coordinator-lead@connectsphere.test, open Event overview, search an event reference, assign it, then confirm its Coordinator appears under Assigned events. Reload and search again. Clear filters, choose a Coordinator and status, then page through results. Past events should remain readable but should not offer reassignment.

Local validation: build and lint passed; 73 frontend unit tests, 266 controlled browser tests and four integrated journeys passed. Desktop and 390-pixel mobile screenshots were inspected with no horizontal overflow. Backend code is unchanged from the preceding 1,953-test verified commit.

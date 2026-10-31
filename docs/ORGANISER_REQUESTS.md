# Organiser submitted requests

The user requested this flow-audit F06 fix alongside the SCRUM-135 branch. It extends the submission/status journey (SCRUM-16/19); it does not expand the status-transition authority introduced by SCRUM-135.

An Organiser can now find submitted requests at /events/mine through:

- My requests in the sidebar.
- My submitted requests on Home.
- View my requests after successful submission.

The page uses the existing GET /events ownership filter. Active requests include unassigned submissions, with Waiting for Coordinator assignment shown until a Coordinator is assigned. Past requests retain Completed, Rejected and Cancelled events and their detail links. Drafts stay in the existing private Drafts workspace. Events display their current customer-facing status, category and Singapore date/time, in the API's most-recently-updated order.

An assigned request shows Coordinator assigned. The existing response has no Coordinator display name, so the page does not invent a name or expose raw account IDs. Open the detail page to see decisions, history and respond to clarification. The list is independent of the newest-50 notification feed.

The API continues to enforce ownership; the frontend also restricts the workspace to Organisers and filters displayed rows to the signed-in Organiser. Loading, timeout, retry, empty and signed-out states are explicit. There is no backend, schema, access-policy or lifecycle change in this follow-up.

## Acceptance and verification

- A submitted event is immediately reachable before Lead assignment.
- Leaving the page, signing out and signing back in does not lose the event.
- Another Organiser cannot see it in their list or open its detail through the API.
- Active and terminal records are separated; drafts are not incorrectly treated as submissions.
- Loading errors offer retry and do not masquerade as an empty list.
- More than 50 returned requests remain accessible independently of notifications.

Seven controlled browser tests cover navigation, active/past records, draft/foreign filtering, empty/error/retry states, role restrictions and 55 records. INTEGRATED-03 uses real password login, UI submission, sign-out/sign-in, rediscovery and a second Organiser to check API isolation. The two existing real lifecycle journeys also pass against the combined branch.

Local verification: production webpack build, frontend lint, 67 unit tests, 261 controlled browser tests and three real browser/API/database journeys passed. Desktop and 390-pixel mobile views were inspected; no horizontal overflow. The backend was unchanged from SCRUM-135's 1,952-test verified commit b081852. See docs/testing/organiser-requests-verification.json for exact evidence.

Manual test: sign in as Organiser, submit a request, open View my requests, sign out, sign back in, then open My submitted requests from Home and select the same event. Its unassigned state remains visible even without an assignment notification. No shared database was changed. Existing local test data was preserved.

## Review and accountability

Delegated scope is the Organiser rediscovery journey and acceptance criteria above, constrained by the existing GET /events contract, server ownership policy, customer status mapping and frontend design system. Existing tests were preserved; the new tests exercise user-visible outcomes and cross-account isolation.

The requesting project owner is accountable for accepting this navigation follow-up. Before merge, a human should review placement of the three entry points, active/past grouping and the distinction between customer status and assignment state. SCRUM-135's separate status-transition design and named review owners remain documented in its story and Decision Log. Hosted CI and human review are pending; local checks do not replace either.

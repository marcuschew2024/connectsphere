# Readable record references

The project owner's requested convention is **EVT-001 · 31 Oct 2026**, shown alongside the normal event title. This follows the Organiser navigation work on feature/SCRUM-135-status-transitions, but does not change that story's status-transition scope.

| Record | Prefix | Date shown |
| --- | --- | --- |
| Event or draft | EVT | Scheduled event date; omitted if not chosen |
| Venue booking | BKG | Booking start date |
| Equipment request | EQR | Request date |
| Attendee registration | REG | Registration date, retained after withdrawal |
| Venue | VNU | Catalogue creation date |
| Equipment stock | EQP | Catalogue creation date |

Dates use Singapore time. Reference numbers remain stable when names, dates, assignments or statuses change. Numbers can exceed three digits and may have gaps. Records with the same title have different references. UUID-based links and relationships continue to work. Automated sample titles now use ordinary names; tests distinguish records by their actual IDs instead of putting random identifiers or timestamps in titles.

## Deployment and acceptance

Apply supabase/migrations/20261031040259_readable_record_references.sql after the existing schemas, then deploy/restart the API and frontend. Existing records receive references automatically; no destructive reset or primary-key rewrite is required. The migration is replay-safe. Only the local test database has been upgraded during this task; the shared database is not modified. The old-ID fallback supports an older backend response, but new explicit database reads require the migration before the new API.

Manual checks: create an event, see its reference/date on the receipt and My requests, open it and reload. Rename or reschedule an editable request and confirm its reference remains the same. Check booking, equipment-request, registration and catalogue screens for their prefixes. Withdraw a registration and confirm its REG reference remains unchanged.

The SQL, concurrent-backend and integrated-browser checks encode these acceptance criteria. See docs/testing/record-references-verification.json for execution evidence. D39 in docs/DECISION_LOG.md records constraints, trade-offs, test-contract changes and named review owners. Human review must inspect the migration, additive API projections and date meaning before merge; local green checks do not replace hosted CI or approval.

Local result: 1,953 backend tests (including database acceptance), 70 frontend unit tests, 261 controlled browser tests and four integrated journeys passed; build, lint and TypeScript checking passed. Desktop/mobile screenshots were inspected. Supabase CLI advisors could not resolve the isolated Docker hostname; direct SQL security assertions passed. No hosted advisor result is claimed.

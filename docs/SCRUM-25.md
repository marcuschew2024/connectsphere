# SCRUM-25 — Update a venue's details

[Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-25) · US-6.1b · Jerome

Venue Staff can open **Venue catalogue → Edit venue** and update capacity,
facilities, accessibility, supported layouts and weekly opening hours. The form
starts with the current values. Name and location are read-only for this story.

## Set up and try it

1. Apply `supabase/update_venues.sql` in the development Supabase SQL editor after
   the existing `create_venues.sql` setup. It adds two venue columns, an audit table
   and one update function. It does not remove venues or alter booking records.
   The migration has been tested on a disposable local database; it has **not**
   been applied to the team's hosted database by this change.
2. Start the API and frontend as described in the README. Select **Demo Venue Staff**
   (or sign in with a Venue Staff account), then open **Venue catalogue**.
3. Use a test venue. Click **Edit venue**, change its capacity and facilities, and
   click **Save changes**. You should see **Venue updated**.
4. Return to the catalogue and search for the new facility or attendance capacity.
   Reload the page and confirm the saved values remain.
5. Enter capacity `0` or set Monday's closing time before opening. Saving should
   show an error and retain your input.
6. Open the same venue in two tabs. Save in the first, then save the second.
   The second save should explain that another staff member updated the venue.
   Note down any changes you want to keep, reload, and reapply them.
7. As a Coordinator, check that there is no **Edit venue** action and direct access
   to `/venues/<id>/edit` is denied. Other roles cannot edit either.

## How to explain the code

The existing add-venue form accepts an optional venue. With a venue it pre-fills
its controls and sends `PUT /venues/<id>`; without one it still creates a venue.
The server checks the session, frontend origin, Staff role and the same validation
rules used when creating venues. The only accepted inputs are the five editable
fields plus the loaded `revision` number. It derives the actor from the session.

The database locks that venue while saving. If its revision has changed since the
form loaded, it rejects the stale save with HTTP 409. Otherwise it updates the
five fields, increments the revision and records the before/after values, actor
and database timestamp in `venue_update_history`. Both writes are one transaction:
if the audit write fails, the venue update rolls back too.

Search, suitability and availability continue reading the same venue record, so
future requests use its new details. Confirmed bookings keep their IDs, status,
times, attendance and other stored fields. Updating a venue does not cancel,
revalidate or modify those bookings. The audit table is backend-readable, with no
new history screen in this story.

## Compatibility and deployment

- Branch: `feature/US-6.1b-SCRUM-25-update-venue`, based on main after SCRUM-28 merged.
- Existing creation, catalogue, calendar, suitability and booking APIs remain intact.
- Existing/custom layout values are retained in the editing form.
- The catalogue's `creator:app_users` relationship stays unambiguous: update actors
  are stored in the separate history table.
- Apply the additive migration before using the editing UI. Existing venues receive
  revision 1; existing create/read clients can ignore the additional response fields.
- Human review and the normal pull-request CI checks are still needed before merging.

## Validation completed locally

- 561 API tests passed, including 33 new update unit/route tests and 3 new database
  integration cases. They cover permissions, invalid input, safe failures, audit
  actor/time, stale saves, immediate search changes and unchanged confirmed bookings.
- 98 browser tests passed, including 11 new edit-flow tests. These cover prefill,
  all five fields, custom layouts, reload, role restrictions, errors, cancel and mobile width.
- 16 existing frontend unit tests passed.
- API Ruff, frontend ESLint and TypeScript/production build passed. The local build
  used `npm run build -- --webpack`; normal CI retains its existing build command.
- Migrations passed twice. SQL checks verify restricted database privileges and
  rollback when an audit insert fails. Desktop and mobile screenshots were inspected.

For repeatable database tests, follow the disposable-stack commands in
`compose.acceptance.yml` and `supabase/tests/run.sh`, then run pytest with
`POSTGREST_TEST_URL=http://127.0.0.1:55433`. Do not point these tests at shared data.

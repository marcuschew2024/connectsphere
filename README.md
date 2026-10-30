# ConnectSphere

ConnectSphere is an event lifecycle management web app built as a student Scrum project: from an organiser raising an event request, through coordinator review and venue/equipment booking, to attendee registration and confirmation, with role-appropriate access throughout.

## Architecture

A mono-repo with two deployable parts:

- `frontend/` - Next.js (App Router, React, TypeScript) styled with Tailwind CSS.
- `api/` - Python Flask REST API.
- Data is stored in Supabase PostgreSQL. Flask manages application login sessions and the local demo role selector. Supabase is not run locally.

The six roles are: Organiser, Coordinator, Venue Staff, Tech Support, Attendee, and Safety Officer.

## Development users (SCRUM-83)

Run [`supabase/seed_users.sql`](supabase/seed_users.sql) in your development
Supabase SQL Editor to create and seed the five demo users. It is safe to rerun.
The same file also upgrades the original UUID users to IDs 1-5 automatically.
This one user-setup script works whether the user table is empty or already set up.
Follow the [setup and explanation](docs/SCRUM-83.md) to enable the passwordless
development switcher, test action attribution, and understand the code.
The switcher is disabled by default and outside development.

## Event requests (SCRUM-14)

After the user setup, run [`supabase/create_events.sql`](supabase/create_events.sql)
in the Supabase SQL Editor. This creates the events table without deleting existing
users or events. Both SQL scripts are safe to rerun on their supported schemas.

For coordinator approve/reject decisions, also run
[`supabase/event_decision_notifications.sql`](supabase/event_decision_notifications.sql)
in the same SQL Editor. This adds decision metadata to events and creates the
organiser notification table.

For automatic Coordinator assignment, also run
[`supabase/auto_assign_coordinator.sql`](supabase/auto_assign_coordinator.sql).
Submitted requests are assigned to one Coordinator and show as Planning to customers;
the Coordinator queue retains the internal Submitted marker.

For the confirmed request clarification workflow, run
[`supabase/request_clarification.sql`](supabase/request_clarification.sql) after the
event and notification migrations. Coordinators can return submitted requests with a
note; organisers revise and resubmit them before they return to the review queue.

For organiser change requests after submission or confirmation, run
[`supabase/migrations/20261025000000_scrum_46_change_requests.sql`](supabase/migrations/20261025000000_scrum_46_change_requests.sql).
This is also included in the current `create_events.sql`, so rerunning that safe
setup script repairs an existing project that was created before SCRUM-46. Organisers
cannot edit submitted events directly; requests are routed to the assigned Coordinator
and can be raised at any time.

For venue booking requests, run
[`supabase/create_venue_bookings.sql`](supabase/create_venue_bookings.sql) after the
event, venue, and notification migrations. Coordinators can request a venue from a
Planning event; Venue Staff receive the request with status `Requested`.

Open **http://localhost:3000/events/new**, select **Demo Organiser**, and create a
draft or submit a completed event request. See the [code walkthrough, API contract,
team integration notes and test instructions](docs/SCRUM-14.md).

## Continue private drafts (SCRUM-15)

Run the updated [`supabase/create_events.sql`](supabase/create_events.sql) again.
It preserves existing events and adds the function used to save/submit a draft.
Select **Demo Organiser**, then open **My drafts** from the home page, or visit
**http://localhost:3000/events/drafts**. Reopen a draft, save changes, and submit
when ready. Saving and submitting keep the same event reference.

See the [SCRUM-15 walkthrough and acceptance checks](docs/SCRUM-15.md).
Events still use the development role switcher. The newly merged login feature
has a [documented integration handoff to SCRUM-21](docs/SCRUM-20.md#known-limitation--future-work).
After pulling teammates' backend changes, rerun `pip install -r requirements.txt`
in the API virtual environment (the login module requires bcrypt).

## Venue catalogue (SCRUM-24)

Run [`supabase/create_venues.sql`](supabase/create_venues.sql) after the user setup.
Select **Demo Venue Staff**, then **Add a venue** from the home page. Saved venues
are immediately visible in **Venue catalogue** to Venue Staff and Coordinators.
See the [SCRUM-24 walkthrough, shared data contract and acceptance checks](docs/SCRUM-24.md).

For venue search (SCRUM-28), also apply [`supabase/venue_search.sql`](supabase/venue_search.sql).
Open **Venue catalogue** and use **Search venues** to filter and check a Singapore-time
slot. Time searches use the existing `create_venue_bookings.sql` setup. See the
[simple walkthrough, matching rules and team integration notes](docs/SCRUM-28.md).

For venue editing (SCRUM-25), apply [`supabase/update_venues.sql`](supabase/update_venues.sql).
Venue Staff can then choose **Edit venue** from the catalogue. See the
[setup, testing walkthrough and integration notes](docs/SCRUM-25.md).

## Equipment catalogue (SCRUM-34)

Apply [`supabase/create_equipment.sql`](supabase/create_equipment.sql) after the user
setup. Tech Support can open **Equipment catalogue** from the home page to add and
edit stock. Coordinators can browse the catalogue. Damaged equipment and equipment
under maintenance contribute zero usable stock; event/time reservations are handled
by the separate availability stories.

See the [code walkthrough, shared data contract, demo and acceptance checks](docs/SCRUM-34.md).

## Safety Officer access (SCRUM-127)

After the user/event and request-clarification migrations, apply
[`20261017074746_scrum_127_safety_officer.sql`](supabase/migrations/20261017074746_scrum_127_safety_officer.sql).
It adds **Demo Safety Officer** without overwriting existing user IDs and enables
the `Preparation` database status used by the operational safety check.

Select **Demo Safety Officer** in the development role switcher, then open
**Review operational safety** on Home. Only confirmed events appear in the queue.
The role can review safety and read Confirmed/Preparation events; it cannot create
events, manage venues/equipment, or use generic status changes.
See the [SCRUM-127 setup, code guide and test evidence](docs/SCRUM-127.md).
## Equipment requests (SCRUM-35)

After the event and equipment migrations, apply
[`supabase/create_equipment_requests.sql`](supabase/create_equipment_requests.sql).
Coordinators can open **Request equipment** from Home for their assigned Planning
events. Tech Support opens **Review equipment requests** to see quantities, notes,
event references and the recorded requester/time. Requests do not reserve stock.

See the [SCRUM-35 walkthrough, API contract and test evidence](docs/SCRUM-35.md).

## Equipment request status (SCRUM-38)

After the SCRUM-35 migration, apply
[`20261018111728_scrum_38_equipment_request_status.sql`](supabase/migrations/20261018111728_scrum_38_equipment_request_status.sql).
Tech Support opens an equipment request with **Review request**, selects its new
status and records optional update notes. Coordinators use **View request** to see
the latest status and who changed it, without editing controls. Stock reservations
remain a separate operation. See the [setup, status rules and test evidence](docs/SCRUM-38.md).

## Complete and close an event (SCRUM-132)

Apply [`20261025120000_scrum_132_complete_event.sql`](supabase/migrations/20261025120000_scrum_132_complete_event.sql)
after the event, venue booking and equipment migrations. The assigned Coordinator opens
an event in **Preparation** and chooses **Mark event complete**, with optional post-event
notes. The event becomes Completed and read-only, and its remaining equipment
reservations and future venue bookings are released. See the
[workflow, read-only rules and test evidence](docs/SCRUM-132.md).

## Registration capacity (SCRUM-41)

Apply [`20261026150854_scrum_41_registration_capacity.sql`](supabase/migrations/20261026150854_scrum_41_registration_capacity.sql)
after the event and `edit_planning.sql` setup. The event's Organiser can set
**Maximum attendees** in **Registration capacity** before confirmation. This signup
limit is separate from expected attendance; full events reject further signups,
including concurrent attempts. Existing events start with registration closed until
a limit is set. See the [setup, API handoff and test evidence](docs/SCRUM-41.md).
The attendee registration screens remain SCRUM-40 work.

## Attendee registration (SCRUM-40)

After the SCRUM-41 capacity and notification setup, apply
[`20261029044510_scrum_40_attendee_registration.sql`](supabase/migrations/20261029044510_scrum_40_attendee_registration.sql).
Attendees open **Browse events** from Home, provide the organiser's required information
and book a place. The saved receipt and **Registration confirmations** on Home show
their confirmation. Full events reject further signups; no waiting list is enabled.
See the [API, setup, review decisions and verification](docs/SCRUM-40.md).

For first-capacity setup on an already Confirmed event, also review
[`20261029062324_scrum_40_initial_confirmed_capacity.sql`](supabase/migrations/20261029062324_scrum_40_initial_confirmed_capacity.sql).
It allows the owning Organiser to initialise an unset limit once, with zero existing
registrations. An established Confirmed limit stays locked. See Decision D20 before
applying this change to the shared development database.

## Withdraw registration (SCRUM-43)

After SCRUM-40/41 and SCRUM-49, apply the reviewed
[`20261030062503_scrum_43_withdraw_registration.sql`](supabase/migrations/20261030062503_scrum_43_withdraw_registration.sql).
An Organiser may set one optional withdrawal deadline before the first signup;
otherwise withdrawal stays open until the event starts. Attendees use
**My registrations → View event → Withdraw registration**, confirm, and see the saved
timestamp. The place is released and Home shows a private withdrawal confirmation.
Waiting-list promotion remains deferred SCRUM-80. See the
[setup, policy, API and review evidence](docs/SCRUM-43.md).

## Cancel an event (SCRUM-69)

After the registration, Event Coordinator Lead and notification migrations, apply
[`20261030180000_scrum_69_cancel_event.sql`](supabase/migrations/20261030180000_scrum_69_cancel_event.sql).
The event's assigned Coordinator, or the Event Coordinator Lead, opens **Cancel event**
on a submitted or active event, gives a reason and confirms. All of the event's venue
bookings and equipment reservations are released, registered Attendees are notified,
and the event becomes read-only. See the
[rules, who may cancel and test evidence](docs/SCRUM-69.md).

## Retire a venue (SCRUM-26)

Apply
[`20261031090000_scrum_26_retire_venue.sql`](supabase/migrations/20261031090000_scrum_26_retire_venue.sql).
Venue Staff open a venue, choose **Retire venue** and confirm. Outstanding booking
requests must be decided first. A retired venue keeps its confirmed bookings and
history, records who retired it and when, is no longer offered to Coordinators for new
bookings, and becomes read-only. See the
[rules and test evidence](docs/SCRUM-26.md).

## Apply approved change requests (SCRUM-138)

Apply
[`20261031120000_scrum_138_apply_change_request.sql`](supabase/migrations/20261031120000_scrum_138_apply_change_request.sql).
An Organiser can propose new values with a change request. When the assigned
Coordinator approves it, the values are applied to the event in one transaction. A
change to the number of attendees or the venue flags a re-review and notifies the
Coordinator; bookings and equipment are kept for a manual re-check. See the
[rules and test evidence](docs/SCRUM-138.md).

## Prerequisites

For draft submission, on-screen confirmation and coordinator assignment, see the
[simple SCRUM-16/17 walkthrough and test instructions](docs/SCRUM-16.md).

- Node.js 22
- Python 3.12
- git
- A Supabase project for demo users and event persistence (the health check works without it)

## Environment setup

Copy the API example and fill in real values. Create `frontend/.env.local` if
you need to override the default API address:

```bash
cp api/.env.example api/.env
```

Frontend variables:

- `NEXT_PUBLIC_API_URL` - base URL of the Flask API (defaults to `http://localhost:5001`)

The role switcher accesses Supabase through Flask; it needs no frontend Supabase key.

API variables:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` - backend-only `sb_secret_...` key for database access
- `SUPABASE_KEY` - optional fallback for an existing legacy `service_role` key
- `APP_ENV` - defaults to `production`; use `development` locally
- `DEV_ROLE_SWITCHER_ENABLED` - defaults to `false`; set `true` to opt in locally
- `SECRET_KEY` - a random session-signing secret, required when enabling the switcher
- `FRONTEND_ORIGIN` - defaults to `http://localhost:3000`
- `FLASK_RUN_PORT` - use `5001` locally to avoid macOS AirPlay's port 5000

The health endpoint works without Supabase. With the switcher enabled, database
endpoints return a helpful error if Supabase is missing or unavailable. See the
[development setup](docs/SCRUM-83.md) for the seeded-users authentication stub.

## Run the frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs at http://localhost:3000 and displays the API health status.

## Run the API

```bash
cd api
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
flask --app app run --port 5001
```

The API runs at http://localhost:5001. Check `GET /health` returns `{"status":"ok"}`.

## Run the tests

Frontend end-to-end tests (Playwright):

```bash
cd frontend
npx playwright install --with-deps chromium   # first run only
npm run build
npm run test:e2e
```

API unit tests (pytest):

```bash
cd api
source .venv/bin/activate
pytest
```

## Continuous integration

GitHub Actions runs two jobs on every push and pull request (see `.github/workflows/ci.yml`):

- **frontend**: `npm ci`, lint, build, Vitest unit checks, then Playwright E2E on Chromium.
- **api**: install requirements, `ruff check`, then unit and disposable-database acceptance tests with coverage.

Both jobs also run advisory dependency audits. GitHub stores API and browser test
evidence, and the disposable test database is removed after the API checks.

## Team

- Marcus
- Jerome
- Ernest
- Jessica

## Project links

- Jira board: https://spm-g6t4.atlassian.net/jira/software/projects/SCRUM/boards/1
- Confluence space (ConnectSphere): https://spm-g6t4.atlassian.net/wiki/spaces/CS

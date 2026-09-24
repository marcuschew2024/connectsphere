# ConnectSphere

ConnectSphere is an event lifecycle management web app built as a student Scrum project: from an organiser raising an event request, through coordinator review and venue/equipment booking, to attendee registration and confirmation, with role-appropriate access throughout.

## Architecture

A mono-repo with two deployable parts:

- `frontend/` - Next.js (App Router, React, TypeScript) styled with Tailwind CSS.
- `api/` - Python Flask REST API.
- Data is stored in Supabase PostgreSQL. Flask manages application login sessions and the local demo role selector. Supabase is not run locally.

The five roles are: Organiser, Coordinator, Venue Staff, Tech Support, and Attendee.

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

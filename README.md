# ConnectSphere

ConnectSphere is an event lifecycle management web app built as an IS212 Scrum
project: an Event Organiser raises an event request, which flows through coordinator
review, venue and equipment booking, attendee registration, and confirmation, with
role-appropriate access throughout.

See the [documentation guide](docs/README.md) for release findings, test evidence,
story records and historical reviews.

## Repository & instructor access

- Repository: https://github.com/marcuschew2024/connectsphere
- Both IS212 instructors have been granted access to the repository.
  <!-- Confirm both instructors are added as collaborators before submission. -->

## Architecture

A mono-repo with two deployable parts plus a managed database:

- `frontend/` — Next.js (App Router, React, TypeScript) + Tailwind CSS. Runs on `:3000`.
- `api/` — Python Flask REST API. Runs on `:5001`. Owns session login and writes in-app notifications.
- Database — Supabase PostgreSQL (managed SaaS; not run locally).

Authentication is handled by the Flask API (session login). Notifications are in-app
(stored in Postgres, shown in the web app); there is no external email service.

## Roles

Seven roles, each seeing only what its relationship to an event allows:
Event Organiser · Event Coordinator · Event Coordinator Lead · Venue Staff ·
Technical Support · Attendee · Safety Officer.

## Prerequisites

- Node.js 20+
- Python 3.12+
- A Supabase project (for the Postgres database)

## Setup

1. **Clone** the repository.
2. **Backend env** — copy `api/.env.example` to `api/.env` and set:
   - `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the backend `sb_secret_...` key — never the publishable key)
   - `SECRET_KEY` — generate with `python -c "import secrets; print(secrets.token_hex(32))"`
   - `APP_ENV=development` for local use (see note below), `DEV_ROLE_SWITCHER_ENABLED=false`
   - keep `FRONTEND_ORIGIN=http://localhost:3000` and `FLASK_RUN_PORT=5001`

   > **Local login note:** use `APP_ENV=development` when running on `http://localhost`.
   > `APP_ENV=production` issues a Secure session cookie that only works over HTTPS, so
   > login will fail on plain http. Use `production` only for an HTTPS deployment.
3. **Frontend env** — copy `frontend/.env.example` to `frontend/.env.local`
   (defaults to `NEXT_PUBLIC_API_URL=http://localhost:5001`).
4. **Install dependencies**
   - API: `cd api && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
   - Frontend: `cd frontend && npm install`
5. **Database** — apply the SQL objects to your Supabase project in the order the CI
   bootstrap uses (`supabase/tests/run.sh`), followed by the remaining
   `supabase/migrations/` files in timestamp order. Then seed the demo users
   (`supabase/seed_users.sql`) and the role-login accounts (`supabase/seed_role_accounts.sql`
   — set `connectsphere.seed_password` first; see Demo accounts).
   <!-- Exact release sequence is confirmed in the clean-checkout setup rehearsal. -->

## Demo accounts

Sign in at `/login`. All demo role accounts share the seeded demo password:
**`G6T4Connectsphere`**

| Role | Email |
| --- | --- |
| Event Organiser | organiser.a@connectsphere.test |
| Event Coordinator | coordinator.a@connectsphere.test |
| Event Coordinator Lead | coordinator-lead@connectsphere.test |
| Venue Staff | venue-staff@connectsphere.test |
| Technical Support | tech-support@connectsphere.test |
| Attendee | attendee.a@connectsphere.test |
| Safety Officer | safety-officer@connectsphere.test |

A second Organiser, Coordinator and Attendee (`*.b@connectsphere.test`) also exist, for
cross-account isolation testing.

### Development mode (optional)

Real login (above) is the primary way in. For quick local exploration there is also a
passwordless **role switcher** that lets you act as a demo identity without signing in.
It is a development-only convenience: it is **off by default** and never active outside
development (it requires `APP_ENV=development` and `DEV_ROLE_SWITCHER_ENABLED=true`). See
[`docs/SCRUM-83.md`](docs/SCRUM-83.md).

## Running locally

Run the release build (this is the deployed experience: real `/login`, no dev switcher):

1. **API:** `cd api && source .venv/bin/activate && python -m flask --app app run --port 5001`
   (with `APP_ENV=development` in `api/.env` so the session cookie works over http — see Setup.)
2. **Frontend:** `cd frontend && npm run build && npm start` → http://localhost:3000

Opening http://localhost:3000 redirects to `/login`. Sign in with a demo account (see above).

> For frontend development with hot reload, use `npm run dev` instead. Note that the dev
> server (`NODE_ENV=development`) shows the role-switcher home and does **not** redirect to
> `/login` — so use `npm run build && npm start` to see the actual release behaviour.

## Testing

- Backend: `cd api && source .venv/bin/activate && pytest` (CI runs `ruff check .` first, then pytest with coverage)
- Frontend unit: `cd frontend && npm run test:unit`
- End-to-end: `cd frontend && npm run test:e2e` (Playwright)
- CI: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs lint, build, and the backend + frontend suites on every push.

## Project structure & further detail

- `api/` — Flask app (`app/`) and backend tests (`tests/`)
- `frontend/` — Next.js app (`src/`) and end-to-end tests (`e2e/`)
- `supabase/` — database objects (`migrations/`) and seed scripts
- `docs/` — the C4 model (`design/`), per-feature walkthroughs (`SCRUM-*.md`), and the Decision Log (`DECISION_LOG.md`)

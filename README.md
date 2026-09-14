# ConnectSphere

ConnectSphere is an event lifecycle management web app built as a student Scrum project: from an organiser raising an event request, through coordinator review and venue/equipment booking, to attendee registration and confirmation, with role-appropriate access throughout.

## Architecture

A mono-repo with two deployable parts:

- `frontend/` - Next.js (App Router, React, TypeScript) styled with Tailwind CSS.
- `api/` - Python Flask REST API.
- Data and authentication are provided by Supabase (Postgres + Auth), accessed via environment variables. Supabase is not run locally.

The five roles are: Event Organiser, Coordinator, Venue Staff, Technical Support, and Attendee.

## Prerequisites

- Node.js 22
- Python 3.12
- git
- A Supabase project (for later sprints; the current scaffold runs without it)

## Environment setup

Each part has its own `.env.example`. Copy it and fill in real values:

```bash
cp frontend/.env.example frontend/.env.local
cp api/.env.example api/.env
```

Frontend variables:

- `NEXT_PUBLIC_API_URL` - base URL of the Flask API (e.g. `http://localhost:5000`)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

API variables:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `FLASK_ENV`

The API does not crash if Supabase variables are absent. Sprint 1 auth is a seeded-users stub.

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
flask --app app run --port 5000
```

The API runs at http://localhost:5000. Check `GET /health` returns `{"status":"ok"}`.

## Run the tests

Frontend end-to-end tests (Playwright):

```bash
cd frontend
npx playwright install --with-deps chromium   # first run only
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

- **frontend**: `npm ci`, lint, build, then Playwright E2E on Chromium.
- **api**: install requirements, `ruff check`, then `pytest`.

## Team

- Marcus
- Jerome
- Ernest
- Jessica

## Project links

- Jira board: https://spm-g6t4.atlassian.net/jira/software/projects/SCRUM/boards/1
- Confluence space (ConnectSphere): https://spm-g6t4.atlassian.net/wiki/spaces/CS

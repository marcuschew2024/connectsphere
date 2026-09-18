# SCRUM-83: demo users and the development role switcher

The database started empty. This feature adds five demo users so we can develop
and test the app before real login exists. There is no admin role.

## 1. Create and seed the table in Supabase

Open your **development** Supabase project, open **SQL Editor**, and run the
whole contents of [`supabase/seed_users.sql`](../supabase/seed_users.sql).
**This is the only SQL file everyone needs to run.** It creates the table if
missing, upgrades the original UUID IDs to numbers if needed, and seeds the five
demo users with IDs 1-5. It is safe to rerun. The final query should return five users.

If you used the original UUID setup, restart Flask and select a user again after
running this file. Old browser sessions containing UUIDs are automatically cleared.
The upgrade stops without changing data if unexpected UUIDs or dependent foreign
keys prevent conversion. No separate migration or DELETE query is needed.

The table is called `public.app_users`:

| Column | Purpose |
| --- | --- |
| `id` | A unique integer: demo users have IDs 1-5. Actions should reference this ID. |
| `display_name` | The name shown in the dropdown, such as Demo Organiser. |
| `role` | Organiser, Coordinator, Venue Staff, Tech Support, or Attendee. |
| `is_demo` | Marks users that this temporary switcher is allowed to select. |

The seed script always uses the same five IDs. `ON CONFLICT (id) DO UPDATE`
refreshes those rows instead of inserting duplicates. It does not delete other
users. Running it again restores the five demo names and roles.
The identity column automatically assigns IDs starting at 6 for future users.

These are application users in Postgres, not Supabase Auth accounts. No passwords
are created. Real authentication will need to link an authenticated identity to
an application user in a later ticket.

The table has row level security enabled and denies access to the `anon` and
`authenticated` database roles. Flask reads it using a backend secret API key,
which uses Supabase's `service_role` database role. That key is infrastructure
access, not an admin role in our app.
Keep it only in the backend environment, never in `NEXT_PUBLIC_*` variables.

## 2. Configure and run Flask

From the repository root, copy the example if you do not already have `api/.env`:

```bash
cp api/.env.example api/.env
```

Edit `api/.env`:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_BACKEND_SECRET_KEY
APP_ENV=development
DEV_ROLE_SWITCHER_ENABLED=true
SECRET_KEY=YOUR_GENERATED_RANDOM_STRING
FRONTEND_ORIGIN=http://localhost:3000
FLASK_RUN_PORT=5001
```

Use the **secret key** beginning with `sb_secret_` from your project's API key
settings. Flask reads `SUPABASE_SECRET_KEY` first, even if `SUPABASE_KEY` contains
a publishable key. For an existing legacy setup, `SUPABASE_KEY` can still hold a
`service_role` key when `SUPABASE_SECRET_KEY` is absent. A publishable key cannot
read this table. `SUPABASE_JWKS_URL` is not used by this temporary switcher.
Do not commit your `.env` file.

The Supabase Python client must support these modern keys. After pulling changes,
run `python -m pip install -r requirements.txt` inside `api` with its virtual
environment activated, then restart Flask.

Generate your own session secret and paste the result into `SECRET_KEY`:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

The secret signs the session cookie so the browser cannot change its user ID.
Keep the same secret across restarts to retain existing development sessions.

Start the API using the existing Python 3.12 setup:

```bash
cd api
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m flask --app app run --port 5001
```

`APP_ENV` is an explicit application setting. `FLASK_ENV` is not used.
Debug mode alone does not enable the switcher. If the switcher is enabled but
`SECRET_KEY` is missing, Flask reports a configuration error at startup.

## 3. Run the frontend and try it

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

The API address defaults to `http://localhost:5001`. To change it, set
`NEXT_PUBLIC_API_URL` in `frontend/.env.local` and restart Next.js. The frontend
does not need a Supabase key for this feature.

Open **http://localhost:3000**. Use `localhost` consistently for the frontend and
API so the browser can send the session cookie; do not mix it with `127.0.0.1`.

We use port 5001 because macOS AirPlay can intercept `localhost:5000` and return
403, even when Flask appears to be running on IPv4. If you see this, use the
port 5001 command above. The health check and switcher share the same API URL.

1. Select **Demo Organiser** in the development dropdown.
2. Click **Test action**. The message identifies Demo Organiser and their role.
3. Check the Flask terminal for `test_action actor_user_id=... role=Organiser`.
4. Select **Demo Coordinator** and click again. Both the message and log change.
5. Refresh the page. Your selection is remembered.
6. Open an incognito window. It starts with no selection because it has its own
   cookies. Tabs in the same browser share the selection; refresh another tab
   to update its displayed selection.
7. Choose **Select a demo user** to clear the session. The test button is disabled.

The test action writes to the Flask application log and returns the actor in its
response. It does not create an event, booking, or permanent database audit row.

## 4. What happens in the code

1. [`users.py`](../api/app/users.py) queries `app_users` through the existing
   Supabase client. It filters for `is_demo = true`.
2. [`dev_auth.py`](../api/app/dev_auth.py) accepts the chosen user ID, verifies it
   exists, and puts just that ID in a signed Flask session cookie.
3. [`acting_user.py`](../api/app/acting_user.py) reads the cookie and looks up the
   current name and role in Supabase. The lookup is reused within that request.
4. An action handler calls `require_acting_user()` and uses the returned ID for
   attribution. A user ID or role in the action's request body is never trusted.
5. [`dev-role-switcher.tsx`](../frontend/src/app/dev-role-switcher.tsx) displays the
   dropdown. [`api.ts`](../frontend/src/lib/api.ts) sends the cookie with requests.

When a teammate adds event creation, the relevant part should look like this:

```python
from app.acting_user import require_acting_user

user = require_acting_user()  # Rejects the request if nobody is selected.
# When inserting the event, set created_by to user["id"].
# Do not get created_by from the submitted JSON.
```

There are currently no event or booking handlers to update. This ticket provides
identity and attribution; role-specific permissions belong in the relevant
feature handlers. A selected role does not automatically enforce permissions.
When real login is implemented, replace the identity lookup in `acting_user.py`
and remove the development routes and dropdown.

| Endpoint | Purpose |
| --- | --- |
| `GET /dev/users` | List the demo users. |
| `GET /dev/session` | Return the current user, or `null`. |
| `POST /dev/session` | Select a demo user with `{"user_id": 1}` (a JSON number). |
| `DELETE /dev/session` | Clear the selection. |
| `POST /dev/actions/test` | Log a test action attributed to the selected user. |

POST and DELETE requests require an `Origin` header matching `FRONTEND_ORIGIN`.
Browsers send it automatically. Include `Origin: http://localhost:3000` when
testing these endpoints with curl or Postman, and preserve the session cookie.

## 5. Verify the development boundary

Set `APP_ENV=production` in `api/.env` and restart Flask, even if
`DEV_ROLE_SWITCHER_ENABLED=true` is still set. All `/dev/*` endpoints return
404 and old development sessions cannot establish an acting user. The same
happens with any environment other than `development`, or with the flag off.

The Next.js production build also omits the dropdown. Backend enforcement works
independently of whether someone has hidden or changed the frontend.

## 6. Automated checks

```bash
cd api
python -m pytest
ruff check .
```

The backend tests use a fake database and exercise the actual Flask routes. They
cover all five roles, session persistence and isolation, forged attribution,
invalid/non-demo users, origin checks, database failures, and production denial.
They do not connect to your Supabase project.

```bash
cd frontend
npm run lint
npm run build
npm run test:e2e
```

The production browser checks include verifying the switcher is absent and makes
no `/dev/*` requests. Install Playwright Chromium first if necessary:
`npx playwright install chromium`.

To verify seeding against your own Supabase project, run the SQL file twice.
Both runs should return the same five IDs. Then test the dropdown against the
running Flask API to verify your URL, backend key, and database configuration.

## Implementation verification

- 47 backend tests and Ruff passed locally (Python 3.14; CI targets Python 3.12).
- Frontend lint, TypeScript, the production build, and both production browser
  tests passed. The build used `npm run build -- --webpack` because this execution
  sandbox blocked Turbopack's worker port. The project's build command is unchanged.
- Development browser checks covered cookies, CORS, switching, refresh persistence,
  separate browser sessions, action attribution, clearing the selection, and mobile
  layout with test data. A subsequent check used the running frontend on port 3000,
  Flask on port 5001, and the actual Supabase database: the API health indicator,
  all five role selections and test actions, and refresh persistence all passed.
- The actual SQL was run repeatedly in an isolated embedded PostgreSQL instance.
  The five IDs stayed stable, an additional user was preserved, the admin role was
  rejected, and table grants permitted the backend role while denying browser roles.
- The same SQL file was also verified against the original UUID seed data:
  it preserves user details and permissions, is safe to rerun, and assigns future
  users IDs starting at 6. Unexpected UUIDs or dependent foreign keys cause a full
  rollback instead of losing data. Tests also verify that old UUID browser sessions
  are cleared and numeric selections work afterward.
- A separate read-only connection check against the configured Supabase project
  retrieved all five users (IDs 1-5). With Supabase 2.31.0 and the backend secret
  key, listing users, selecting each role, and running the attributed test action
  all returned HTTP 200. No database records were changed by this check.

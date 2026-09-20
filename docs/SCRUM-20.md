# SCRUM-20: Secure login (US-1.1)

Users can now log in with email and password. Sessions expire after 30 minutes of inactivity. Accounts lock for 15 minutes after 5 consecutive failed attempts. All login and logout events are recorded in an audit log.

## 1. Apply the database migration

Open your Supabase project → **SQL Editor** and run `supabase/login_auth.sql`.

This adds three columns to `app_users`:

| Column | Purpose |
| --- | --- |
| `email` | Unique login email. NULL for demo users that have no real credentials. |
| `password_hash` | bcrypt hash of the user's password. NULL until a password is set. |
| `failed_attempts` | Consecutive failed login counter. Resets to 0 on success. |
| `locked_until` | Set to `now() + 15 min` when `failed_attempts` reaches 5. NULL when unlocked. |

It also creates `auth_audit_log` which records every `login_success`, `login_failure`, `account_locked`, and `logout` event with a timestamp and IP address.

Run it once. It is safe to rerun (all DDL uses `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

## 2. Set a password for a user (development only)

To test login against your Supabase database, set a password hash directly in the SQL Editor:

```sql
update public.app_users
set email    = 'organiser@example.com',
    password_hash = '<bcrypt hash>'
where id = 1;
```

Generate a bcrypt hash locally:

```bash
cd api
source .venv/bin/activate
python -c "import bcrypt; print(bcrypt.hashpw(b'YourPassword123!', bcrypt.gensalt()).decode())"
```

Paste the output (starting with `$2b$`) as the `password_hash` value.

## 3. Configure Flask

No new environment variables are required. Session expiry is controlled by `PERMANENT_SESSION_LIFETIME` in `main.py` (30 minutes). The existing `SECRET_KEY` signs the session cookie.

## 4. New API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/login` | Login with `{"email": "...", "password": "..."}` |
| `POST` | `/auth/logout` | Clear the session |
| `GET` | `/auth/session` | Return the current user or `null` |

`GET /session` (the root-level endpoint) still works: it returns a real auth user if logged in, falls back to the dev switcher in development mode.

### Login response

**200 OK** (success):
```json
{ "user": { "id": 1, "display_name": "Alice Organiser", "role": "Organiser" } }
```

**401 Unauthorized** (wrong credentials — same message for wrong password and unknown email):
```json
{ "error": "Invalid email or password." }
```

**429 Too Many Requests** (account locked):
```json
{ "error": "Account temporarily locked. Try again in N minute(s)." }
```

## 5. Frontend

- `/login` — login page with email + password form, handles 401 and 429 error states.
- Home page now shows a **Sign out** button when a user is logged in.

## 6. Security notes

- Passwords are never stored, transmitted, or logged in plaintext.
- `bcrypt.checkpw` is used for constant-time comparison of the hash itself.
- Login errors never reveal whether the email exists or the password was wrong.
- **Timing-safe against email enumeration:** the "unknown email" and "no password set" paths run bcrypt against a throwaway hash (`_DUMMY_HASH`) so every failure takes the same time — an attacker cannot tell a valid email from an invalid one by response timing, not just by the error message.
- The lockout check runs before password verification so a locked account cannot be probed.
- Demo users (seeded identities) have no `password_hash` and cannot log in via this endpoint. They remain available via the dev role switcher in development mode.

## Known limitation / future work

**Real login is not yet wired to the events API.** SCRUM-20 introduces real authentication (`get_authenticated_user()` reads `session["user_id"]`), but the events endpoints (`events.py`) still resolve identity through the **dev role switcher** (`require_acting_user()` → `session["acting_user_id"]`). These are two separate session keys, so a real `/auth/login` does **not** grant access to the events API.

- This is **intentional for Sprint 1**: the demo drives the events flow via the dev role switcher, and US-1.1's scope is login only.
- **Future work:** unify the two identity paths so `events.py` (and any role-gated endpoint) trusts the real auth session in production. This is the natural place for **SCRUM-21 (role-based access)** to decide which identity it enforces on. Until unified, `require_acting_user` only works when `DEV_ROLE_SWITCHER_ENABLED=true`.

## 7. Run the tests

```bash
cd api
source .venv/bin/activate
python -m pytest tests/test_auth.py -v
```

All 8 tests (TC-US1.1-01..08) should pass without a network connection.

## What happens in the code

1. `api/app/auth.py` — `POST /auth/login`: looks up the user by email, checks lockout, verifies the bcrypt hash, resets or increments the failure counter, writes an audit row, starts a Flask session.
2. `api/app/auth.py` — `POST /auth/logout`: clears the session, writes an audit row.
3. `api/app/auth.py` — `get_authenticated_user()`: reads `session["user_id"]` and re-fetches the user from Supabase once per request (cached in Flask `g`).
4. `api/app/main.py` — `GET /session`: tries `get_authenticated_user()` first; falls back to `get_acting_user()` (dev switcher) in development mode only.
5. `frontend/src/app/login/page.tsx` — login form; redirects to `/` on success.
6. `supabase/login_auth.sql` — migration; run once in Supabase SQL Editor.

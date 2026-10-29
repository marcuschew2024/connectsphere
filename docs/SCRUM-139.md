# SCRUM-139: Real login is the entry point (bug fix from SCRUM-20)

Codex review finding R10 (High). SCRUM-20 stays Done; this is the linked fix. Design and
trade-offs: Decision Log **D23**. Owner: Ernest Wong.

## What was wrong

- On Home, the development role switcher's load-time `/dev/session` lookup wrote into the
  same role state as `/session`. A password-signed-in user with no demo selection was
  reset to "no role". A disabled switcher (404) did the same.
- Selecting or clearing a demo user called `session.clear()` on the API, which silently
  ended a real login.
- Signed-out visitors stayed on Home instead of being sent to `/login`.
- Demo identities have no password, so no role had a working password account to sign
  in with.

## What changed

| Area | Change |
| --- | --- |
| `api/app/dev_auth.py` | `POST` / `DELETE /dev/session` return **409** "Sign out before using the development role switcher." while a password session exists. |
| `frontend/src/lib/dev-switcher.ts` | New pure loader. It checks `/auth/session` first, hides the switcher for a password session, and never reports a role on load. |
| `frontend/src/app/dev-role-switcher.tsx` | Uses the loader. It calls `onRoleChange` only after an explicit switch. |
| `frontend/src/lib/use-acting-role.ts` | Also returns `signedOut`, which is true only when `/session` answered `user: null` (not on network/API failure). |
| `frontend/src/app/page.tsx` | Non-development builds redirect a confirmed signed-out visitor to `/login`. If the API is unreachable, Home shows a "Go to sign in" link instead. |
| `supabase/seed_role_accounts.sql` | Ten password accounts covering all seven roles, plus isolation duplicates. |

No API response shapes, schema or grants changed. The switcher's existing gates are
unchanged: `APP_ENV=development` + `DEV_ROLE_SWITCHER_ENABLED=true` on the API, and a
development build on the frontend.

## Seeding the role accounts (development only)

Run after `seed_users.sql`, `login_auth.sql` and the SCRUM-127 / SCRUM-131 migrations.
The file stores **no password**. In the Supabase SQL Editor, put this line above the file
contents and run both together:

```sql
select set_config('connectsphere.seed_password', '<choose a password of 12+ characters>', false);
```

Share the password with the team out of band. Do not commit it. The script is safe to
rerun: each account keeps its ID, and its password is reset and any lockout cleared.

| Email | Role |
| --- | --- |
| `organiser.a@connectsphere.test` / `organiser.b@…` | Organiser |
| `coordinator.a@connectsphere.test` / `coordinator.b@…` | Coordinator |
| `coordinator-lead@connectsphere.test` | Event Coordinator Lead |
| `venue-staff@connectsphere.test` | Venue Staff |
| `tech-support@connectsphere.test` | Tech Support |
| `safety-officer@connectsphere.test` | Safety Officer |
| `attendee.a@connectsphere.test` / `attendee.b@…` | Attendee |

The `.b` accounts let you check that one Organiser / Coordinator / Attendee cannot see
another's records.

## Tests

```bash
cd api && pytest tests/test_login_entry_point.py            # no database needed
# Disposable database (CI does this): run.sh seeds with a test-only password, then
POSTGREST_TEST_URL=http://127.0.0.1:55433 pytest tests/test_role_accounts_acceptance.py
cd ../frontend && npm run test:unit && npm run build && npm run test:e2e
```

- `test_login_entry_point.py`: switch and clear are refused while signed in. These two
  tests fail without the fix. Also covers: the real identity wins over a leftover demo
  cookie, signed-out switching still works, and production ignores demo cookies.
- `test_role_accounts_acceptance.py`: each of the ten accounts logs in with its role in
  production configuration. Also checks all seven roles covered, distinct isolation
  IDs, wrong password rejected with no session, and no demo identity resolved.
- `dev-switcher.test.ts`: a password session never consults `/dev/*`, and failures are
  surfaced rather than turned into an identity.
- `e2e/login-entry.spec.ts`: signed-out redirect, no redirect when the API is down
  (both fail without the fix), and login lands on the account's workspace with no
  `/dev/*` requests.

## Known limitation

Only Home redirects. Other pages keep their existing "Sign in or select a demo user"
states. The server-side guards still protect them. See D23 for the trade-off.

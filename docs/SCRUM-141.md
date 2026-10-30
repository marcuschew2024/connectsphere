# SCRUM-141 (R12): atomic failed-login + stronger auth evidence

**Codex-Audit R12 (Medium).** Against SCRUM-20 (Secure login, stays Done). The auth evidence
was weaker than its labels and the failed-attempt increment was not atomic. Design: Decision
Log **D31**. Owner: Marcus.

## Problems

1. **Non-atomic failed-attempt increment** — `login` did `SELECT count` → `UPDATE count+1` →
   re-fetch. Two concurrent wrong-password attempts both read `N` and write `N+1`, losing an
   increment and undercounting the lockout.
2. **Weak lockout test** — preset `failed_attempts = 4` then one failure, rather than a real
   sequential lockout.
3. **Weak expiry evidence** — inactivity expiry asserted from config, not a timed journey.
4. **Logout swallowed server failure** — `handleLogout` did `.catch(() => {})` then redirected
   regardless, so a failed sign-out looked successful.

## Fixes (SCRUM-20 security policy unchanged: 5 failures → 15-min lock; 30-min inactivity)

| Area | Change |
| --- | --- |
| `supabase/migrations/20261030140000_scrum_141_atomic_failed_login.sql` | `register_failed_login(user_id, max_attempts, lockout_minutes)` — one `UPDATE … SET failed_attempts = failed_attempts + 1, locked_until = CASE … END … RETURNING` so the increment + lock are atomic. Replay-safe; granted to `service_role`; registered in `supabase/tests/run.sh`. |
| `api/app/auth.py` | `_register_failed_login` calls the RPC and uses its returned state (drops the read-then-write and the re-fetch). Thresholds still come from `MAX_FAILED_ATTEMPTS` / `LOCKOUT_MINUTES`. |
| `frontend/src/components/app-shell.tsx` | `handleLogout` awaits the server logout; on failure it shows an error and stays put instead of redirecting. |

## Acceptance criteria → evidence

| Behaviour | Test |
| --- | --- |
| Five *real* consecutive failures lock the account (429 even with the right password); lock expiry recovers + resets the counter. | `test_auth.py::test_login_sequential_failures_lock_then_recover` (unit, atomic RPC); `test_role_accounts_acceptance.py::test_account_locks_after_real_consecutive_failures_then_recovers` (real DB RPC) |
| Session expires after inactivity — a genuine timed journey. | `test_auth.py::test_session_expires_after_inactivity` (1 s lifetime + real sleep) |
| Failed-attempt increment is atomic. | the migration (single `UPDATE … RETURNING`) + both lockout tests above |
| A failed sign-out surfaces an error and keeps the user on the page. | e2e `login-entry.spec.ts` "a failed sign-out surfaces an error and keeps the user on the page" |
| DB-down auth helpers fail closed. | `test_runtime_safety.py::test_missing_auth_database_cannot_resolve_an_identity_or_write_counters` |

## Applying the migration (shared Supabase)

Run `supabase/migrations/20261030140000_scrum_141_atomic_failed_login.sql` once in the Supabase
SQL Editor after merge. Safe to rerun; it only (re)creates the function and its grant.

## Run the tests

```bash
cd api && source .venv/bin/activate && ruff check . && python -m pytest tests/test_auth.py -q
docker compose -p connectsphere-acceptance -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-acceptance -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh
POSTGREST_TEST_URL=http://127.0.0.1:55433 python -m pytest tests/test_role_accounts_acceptance.py -q
cd ../frontend && npm run lint && npm run build && npx playwright test login-entry.spec.ts
```

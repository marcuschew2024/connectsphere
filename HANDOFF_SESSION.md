# Session Handoff — 2026-09-20 (mid-session restart to load Supabase MCP)

## Why restarting
Added a read-only Supabase MCP to load its tools. `claude --resume` reloads config + restores this conversation.

## After you resume — do this
1. `/mcp` → select **supabase** → **Authenticate** (OAuth browser; read-only, project `pqdkfrvqjeqlsdwvddcd`).
2. Tell Claude "connected" → it verifies the `login_auth.sql` migration landed:
   - `app_users` has columns: `email`, `password_hash`, `failed_attempts`, `locked_until`
   - `auth_audit_log` table exists
3. Then: finish SCRUM-20 (commit/push/PR/merge) → start SCRUM-21.

## State as of this handoff

### Code — SCRUM-20 (Secure login), branch `feature/SCRUM-20-secure-login`, NOT pushed
- Complete + reviewed. **143 tests pass, ruff clean.**
- Timing side-channel FIX applied this session in `api/app/auth.py`: added `_DUMMY_HASH`; unknown-email and no-password paths now run `bcrypt.checkpw` to equalise timing (prevents email enumeration by timing).
- Docs updated: `docs/SCRUM-20.md` — security note + new "Known limitation / future work" section (real auth not yet wired to events API; events.py still uses dev switcher `require_acting_user`).
- **Still TODO before merge:** run `supabase/login_auth.sql` in Supabase SQL Editor; `git fetch`; commit; push; PR; merge. Branch is current with origin/main (0 behind).

### Jira — cleaned up this session (spm-g6t4, project SCRUM)
- Convention applied: **sub-task assignee follows parent story assignee**.
- SCRUM-20 → In Progress. SCRUM-91/92/93 → Done (create-event, merged in main via PR #2, authored by Jerome).
- Reassigned to match parents: 85/86/87 → Marcus, 88/89/90 → Marcus, 91/92/93 → Jerome, 94–99 → Jerome, 100/101/102 → Ernest.
- SCRUM-13 cluster (82/83/84/115) LEFT AS-IS (bundled setup story; reflects actual authors Jerome/Jessica) — per Marcus's decision.
- Standup note: this reshuffled some teammates' sub-tasks to match story owners.

### SCRUM-21 (Role-based access) — NEXT, assigned to Marcus, To Do
- Plan: `rbac.py` with `require_role()` + `require_related_user()` + denied-attempt logging → new `access_denied_log` table (`supabase/rbac.sql`); refactor events.py to centralise checks; FE role nav + 403; tests TC-US1.2-01..06; `docs/SCRUM-21.md`.
- IMPORTANT reuse: Jessica's SCRUM-112 already added record-level access control to events.py (the `related_users` check, duplicated in get_event/get_event_history/change_event_status). RBAC should CENTRALISE hers + ADD role gating + denial logging, not duplicate.
- Branch off fresh `main` AFTER SCRUM-20 merges.

### Working agreement reminders
- Marcus runs all SQL (writes); Claude verifies via read-only Supabase MCP.
- Nothing pushed to remote without Marcus's OK. Small increments, explain every piece (Week-13 Q&A).

# Sprint 1 Handoff — 2026-09-20

## Session summary
Working on IS212 ConnectSphere Sprint 1 (ends 21 Sep). Marcus's 4 assigned stories per Jira (source of truth). Confluence Goal & Scope page was synced from Jira at session start (8 stories reassigned).

---

## SCRUM-13 — DONE ✅
**No code needed.** All subtasks were already done (code in main). Jira updated:
- SCRUM-82 (CI/repo) → Done
- SCRUM-115 (Supabase wiring) → Done
- SCRUM-13 (parent) → Done
- SCRUM-83 and SCRUM-84 still need manual update → Marcus to flip these to Done in Jira

---

## SCRUM-20 — CODED, AWAITING MARCUS REVIEW ⏳
**Branch:** `feature/SCRUM-20-secure-login`

### What was built
- `supabase/login_auth.sql` — DB migration (adds email, password_hash, failed_attempts, locked_until to app_users; creates auth_audit_log table)
- `api/app/auth.py` — new blueprint: POST /auth/login, POST /auth/logout, GET /auth/session
- `api/app/main.py` — registered auth blueprint, added 30-min session lifetime, updated GET /session to try real auth first then dev switcher
- `api/tests/test_auth.py` — 8 tests covering TC-US1.1-01..08 (all passing)
- `frontend/src/app/login/page.tsx` — login page with email+password form
- `frontend/src/app/page.tsx` — added Sign out button
- `docs/SCRUM-20.md` — implementation guide
- `api/requirements.txt` — added bcrypt==4.2.1
- Pre-existing ruff issues in event_repository.py, events.py, test_events.py also fixed

### Test results
- 143/143 passing, ruff clean

### Action needed before push
1. **Marcus runs `supabase/login_auth.sql`** in Supabase SQL Editor
2. **Marcus reviews** all files above
3. Push branch + open PR

### Security decisions to be aware of
- Generic 401 for wrong password AND unknown email (prevents email enumeration)
- Lockout: 5 failures → 15-min lock (constants in auth.py: MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES)
- bcrypt constant-time comparison
- Session expiry: 30 min (PERMANENT_SESSION_LIFETIME in main.py)

---

## SCRUM-21 — NOT STARTED ❌
**Story:** Role-based access (US-1.2)

**ACs:**
- Role determines navigation, actions, accessible records
- Out-of-role actions denied server-side (not just hidden in UI)
- Organiser cannot view unrelated events; Attendee cannot see planning info
- Denied attempts recorded. No admin role.

**Subtasks:**
- SCRUM-88: BE — Server-side RBAC enforcement + denied-attempt logging
- SCRUM-89: FE — Role-based navigation & action gating
- SCRUM-90: Test — TC-US1.2-01..06

**Plan:**
- Backend: `require_role(*roles)` helper in acting_user.py, denied-attempt log to auth_audit_log (reuse existing table, add event_type='access_denied')
- Frontend: role-based nav (Coordinator sees coordinator dashboard link, etc.), 403 page
- Note: several endpoints in events.py already do role checks — centralise these

---

## SCRUM-23 — NOT STARTED ❌
**Story:** Edit event info during Planning (US-4.6)

**ACs:**
- While in Planning, an authorised Coordinator can update event info fields
- Changes saved with actor + timestamp
- Editing disabled once Confirmed
- Ordinary edits vs important changes distinguished (links US-4.5)

**Subtasks:**
- SCRUM-106: BE — Edit-in-Planning + confirmed-lock + audit
- SCRUM-107: FE — Edit form + disabled-when-confirmed state
- SCRUM-108: Test — TC-US4.6-01..05

**Plan:**
- Backend: `PATCH /events/<event_id>` in events.py — Coordinator only, Planning status only, same validate_event() logic, updates updated_at + last_status_changed_by/at
- Frontend: Edit form on /events/[eventId]/page.tsx — shown only to Coordinator, fields disabled when status=Confirmed
- No new SQL needed (events table already has all required columns)

---

## Repo state
- **Branch:** `feature/SCRUM-20-secure-login`
- **Base:** `main` at `976b874`
- **Local venv:** bcrypt installed, ruff clean, 143 tests passing
- **Supabase SQL to run:** `supabase/login_auth.sql` (not yet applied)

## Key file locations
| File | Purpose |
|------|---------|
| `api/app/auth.py` | New auth blueprint (SCRUM-20) |
| `api/app/main.py` | Updated app factory |
| `api/app/acting_user.py` | Dev switcher helpers (used by SCRUM-21) |
| `api/app/events.py` | Events blueprint (SCRUM-21 role checks go here) |
| `api/tests/test_auth.py` | SCRUM-20 tests |
| `frontend/src/app/login/page.tsx` | Login page |
| `supabase/login_auth.sql` | DB migration — run in Supabase SQL Editor |
| `docs/SCRUM-20.md` | Setup guide for SCRUM-20 |

## Working agreement
- Claude codes, Marcus reviews everything before pushing
- Test cases reviewed too — nothing pushed without sign-off
- Small increments, explain every piece (Week-13 Q&A rubric)
- Jira is source of truth; Confluence updated to match
- `docs/` — add one .md per SCRUM when done
- `supabase/` — add one SQL file per SCRUM that needs DB changes; Marcus runs it
- Branch per SCRUM: `feature/SCRUM-XX-short-description`

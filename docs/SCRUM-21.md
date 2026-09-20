# SCRUM-21: Role-based access (US-1.2)

Access is controlled at two levels, both enforced **server-side** (the UI only hides
things for convenience — it is never the authority):

- **Role-level** — some actions are limited to certain roles (e.g. only Organisers create events).
- **Record-level** — you can only see an event you're tied to (organiser, coordinator, or participant).

Every denied attempt is recorded in `access_denied_log` (who, what, why, when). There is
**no admin role** — no user bypasses these checks.

## 1. Apply the database migration

Supabase → **SQL Editor** → run `supabase/rbac.sql`. It creates `access_denied_log`:

| Column | Purpose |
| --- | --- |
| actor_id | the acting user (nullable, FK to app_users) |
| actor_role | their role at the time (snapshotted) |
| action | what was attempted, e.g. `create_event`, `view_event` |
| event_id | the event involved, when applicable (FK to events) |
| reason | why it was denied |
| ip_address, occurred_at | request IP + timestamp |

Backend-only (RLS on, revoked from browser roles, `service_role` only) — same posture as `auth_audit_log`.

## 2. Backend — `api/app/rbac.py`

| Helper | Does |
| --- | --- |
| `require_role(user, *roles, action=)` | 403 + logs denial unless the user holds one of `roles` |
| `require_related_user(user, event, action=)` | 403 + logs denial unless the user is the event's organiser/coordinator/participant |
| `log_access_denied(...)` | appends one row to `access_denied_log`; **never raises** (an audit failure must not turn a 403 into a 500) |
| `public_event_view(event)` | returns only attendee-safe fields (whitelist) |

`events.py` calls these instead of the inline checks it used to duplicate. Behaviour is
unchanged for allowed users; denials are now audited.

### Attendee field filtering (TC-US1.2-04)
`public_event_view` uses a **whitelist** (`PUBLIC_EVENT_FIELDS` = id, title, description,
category, event_datetime, status) so a newly-added column never leaks to attendees by
default. Internal planning fields (coordinator_id, organiser_id, submitted_at,
last_status_changed_by/at) are dropped. Applied on `GET /events` and `GET /events/<id>`
when the acting role is `Attendee`.

## 3. Frontend

- **`/forbidden`** — a 403 "Access denied" page for server denials / disallowed navigation.
- **`page.tsx`** — role-aware home: shows *"You're in {role} view"* and only that role's
  actions. Organiser → **Create an event request**; other roles → an honest *"No actions
  available for the {role} role yet"* (their tools arrive in later sprints). No placeholder
  dashboards are built for features that don't exist yet.

## 4. Tests — `api/tests/test_rbac.py`

| TC | Test |
| --- | --- |
| TC-US1.2-02 server-side role denial | `test_require_role_denies_non_organiser_and_logs` |
| TC-US1.2-03 cross-client isolation | `test_require_related_user_denies_unrelated_and_logs` |
| TC-US1.2-04 attendee public-only fields | `test_public_event_view_strips_internal_fields` |
| TC-US1.2-05 denied attempts logged | asserted within the 02 & 03 tests |
| TC-US1.2-06 no admin role/bypass | `test_no_admin_bypass` |

TC-US1.2-01 (role-appropriate nav) is verified in the frontend + by manual test.

Run: `cd api && source .venv/bin/activate && python -m pytest tests/test_rbac.py -v` (150 total passing).

## 5. Verified live
- Non-Organiser `POST /events` → 403, row in `access_denied_log` (actor + role + reason + timestamp).
- Attendee event view returns only public fields.

## Known limitation / future work
Same auth seam as SCRUM-20: these endpoints resolve identity via the dev role switcher
(`require_acting_user`), not the real login session. Fine for the Sprint 1 demo (role
switching); unifying real auth with the events API is future work.

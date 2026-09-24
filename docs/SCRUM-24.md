# SCRUM-24 — Add a venue to the catalogue

[Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-24) · US-6.1a · Jerome

Venue Staff can register a venue. It is saved in Supabase and immediately appears
in the shared catalogue for Venue Staff and Coordinators. The record includes the
creator and creation time. This gives SCRUM-28 (search), SCRUM-29 (suitability) and
SCRUM-31 (booking requests) a shared source of venue data.

The story names **Venue Staff** as the creator. The Sprint 2 goal's reference to a
Coordinator building the catalogue conflicts with that wording; this implementation
follows the story. Coordinators can read the catalogue, but cannot create venues.

## Try it locally

1. Apply `supabase/create_venues.sql` to the development Supabase project after
   `supabase/seed_users.sql`. The script is safe to rerun and preserves existing data.
2. Start the existing Flask and Next.js servers. This workspace uses
   `http://localhost:3001` and API port `5001`; `FRONTEND_ORIGIN` must match the frontend.
3. Select **Demo Venue Staff** on the home page, then **Add a venue**.
4. Enter a name, location, positive whole-number capacity and at least one layout.
   List facilities/accessibility features separated by commas; an empty list means none.
5. Check the weekly opening hours, then choose **Save venue**.
6. Choose **View catalogue**. Switch to **Demo Coordinator** from the home page and
   open **Venue catalogue** to confirm the same venue is visible.

Normal localhost use requires the hosted Supabase project, not Docker. Docker is
only used for disposable database tests.

## Data contract for dependent stories

Table: `public.venues`. Venue IDs are UUIDs. Hours use **Asia/Singapore (UTC+8)**.

| Field | Meaning |
| --- | --- |
| `name`, `location` | Required text, up to 200 / 300 characters. |
| `capacity` | Positive integer, at most PostgreSQL's integer limit (2,147,483,647). |
| `facilities`, `accessibility` | Arrays of feature names; empty arrays are allowed. |
| `supported_layouts` | Non-empty array. UI options: Theatre, Classroom, Boardroom, U-shape, Banquet, Standing. |
| `operating_hours` | Seven weekday keys. Each is `{ "opens": "09:00", "closes": "18:00" }` or `null` for Closed. |
| `timezone` | Stored by the database as `Asia/Singapore`. |
| `created_by`, `created_at` | Server-selected user ID and database-generated timestamp. |

Feature lists allow up to 20 entries, each up to 80 characters. The API trims and
normalises whitespace, and deduplicates features without regard to case. Hours must
use `HH:MM`, closing must be later than opening, and at least one day must be open.
The first version supports one same-day interval per day; overnight and split shifts
are not supported. The form starts with Mon–Fri 09:00–18:00 and weekends closed,
which Venue Staff can change before saving.

The same name at the same location is a duplicate, ignoring case and whitespace.
A unique database index enforces this even if two people submit at once. The same
room name at a different location is allowed.

## API and access

`POST /venues` accepts only the seven editable fields above (excluding ID, timezone
and audit fields). It returns `201 { "venue": ... }`. Validation returns `400` with
field errors; duplicates return `409`. Audit fields cannot be supplied by the client.

`GET /venues?page=1` returns `{ "venues": [...], "page": 1, "has_more": false }`.
Pages contain up to six venues, newest first, with an ID tie-breaker. Catalogue
records include `creator.display_name`. A saved venue is eligible for catalogue
queries immediately; there is no separate publishing or approval step.

Both routes check the frontend origin, resolve the signed session and enforce roles
on the backend. Existing real login sessions are accepted; the local demo switcher
is also supported in development, matching `/session`'s identity precedence. Anonymous
and browser Supabase roles have no direct table access. Responses are not cached.

The creation response and list API are the foundation for booking searches. Advanced
search/filter controls, suitability evaluation, booking, editing and retirement stay
in their own Sprint 2 stories. They are not needed to register a venue.

## Files

- `supabase/create_venues.sql`: table, constraints, duplicate index and backend-only grants.
- `api/app/venue_validation.py`: shared field contract and validation.
- `api/app/venue_repository.py`: insert and catalogue queries.
- `api/app/venues.py`: authenticated API routes.
- `frontend/src/app/venues/`: role-aware catalogue and creation screens.
- `frontend/src/lib/venues.ts`: shared TypeScript types, layout options and default hours.

## Acceptance checks

| Case | Expected outcome | Automated coverage |
| --- | --- | --- |
| TC-US6.1a-01 Valid creation | All venue fields persist; confirmation and catalogue entry appear. | API, database, browser |
| TC-US6.1a-02 Required fields | Missing name/location/layouts rejected; no partial record. | API, database |
| TC-US6.1a-03 Capacity | Positive integers accepted; zero, negatives, fractions, booleans and overflow rejected. | API, database, browser |
| TC-US6.1a-04 Hours | Valid weekly schedule accepted; invalid, equal, reversed or all-closed hours rejected. | API, database, browser |
| TC-US6.1a-05 Features | Arrays stored, duplicates normalised, empty optional feature lists accepted. | API, database |
| TC-US6.1a-06 Permissions | Only Venue Staff create; Staff/Coordinators read; direct denied calls stay denied. | API, browser |
| TC-US6.1a-07 Duplicates | Same name/location blocked, including case/space variants and direct DB writes. | API, database, browser |
| TC-US6.1a-08 Audit | Actor comes from session; timestamp comes from DB; client spoofing blocked. | API, database |
| TC-US6.1a-09 Shared catalogue | New venue visible to Coordinator; reload and pagination work. | API, database, browser |
| TC-US6.1a-10 Error handling and mobile | Failed saves preserve inputs; failed reads retry; no horizontal overflow. | Browser |

API checks: `api/tests/test_venues.py`, `api/tests/test_venue_acceptance.py`.
Browser checks: `frontend/e2e/venues.spec.ts`. CI applies the venue migration twice,
runs database acceptance tests with coverage, then stores JUnit and browser reports.
Local evidence is in `api/test-results/pytest.xml` and `frontend/playwright-report/`.

## Local verification — 24 September 2026

- Full API suite: **296 passed**, with **86% overall coverage**.
- Full browser suite: **65 passed**; frontend unit suite: **5 passed**.
- Ruff, ESLint, the production build and database checks passed. Migrations were
  applied twice against the disposable database to check they can be rerun.
- The venue migration is already applied to this workspace's development Supabase
  project. A localhost check confirmed validation, saving, Coordinator visibility
  after reloading, and the mobile catalogue layout. Its temporary venue was removed.

These are local results. The branch has not been pushed, so no remote CI result is
claimed. The usual review and CI checks still apply before merging.

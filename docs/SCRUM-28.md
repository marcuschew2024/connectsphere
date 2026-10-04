# SCRUM-28 — Search and filter venues

[Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-28) · US-6.2 · Jerome

Coordinators and Venue Staff can search the existing venue catalogue. They can
combine location, expected attendance, minimum capacity, layout, facilities and
accessibility requirements. Adding a date and start/end time checks availability.

## Try it

1. Apply `supabase/venue_search.sql` after `create_venues.sql` in the development
   database. It adds `is_retired`, defaulting to false, without removing any data.
   Time searches also need the existing `create_venue_bookings.sql` migration.
2. Start the API and frontend using the README instructions.
3. Sign in as a Coordinator or select Demo Coordinator, then open **Venue catalogue**.
4. Start with **Expected attendance**, **Date**, **Start time** and **End time**.
   All filters are optional; times use Singapore time. **Only show available venues**
   becomes usable once all three time fields are complete.
5. Open **More requirements** for location, layout, extra capacity and features.
   Click feature suggestions from the catalogue or enter comma-separated names.
   Select **Search venues**; the applied-filter summary explains the current results.
6. For example, enter attendance `80`, layout `Classroom`, facilities `Projector,
   Wi-Fi`, and a date with times `09:00`–`10:00`.
7. Compare the venue cards and their availability messages. Open **View availability**
   for the existing calendar. **Clear filters** returns to page one of the catalogue.

The new migration has been tested locally against a disposable database. Applying
it to the team's hosted Supabase database is still a deployment step.

## Why the flow fits the project goal

The [Sprint 2 goal](https://spm-g6t4.atlassian.net/wiki/spaces/CS/pages/5308427)
connects venue discovery, event suitability and booking. The form now follows that
order: start with the event's people and timing, refine optional requirements, then
compare candidate spaces. Extra capacity is secondary because attendance already
checks the minimum size. Availability labels do not claim the full suitability
check has passed or that a booking has been confirmed. Existing suitability,
calendar and booking interfaces retain their roles.

## How Jerome can explain the code

The form sends the selected filters to `GET /venues`. The API validates them, reads
the catalogue in its existing order, and keeps venues matching every requirement.
It fills a six-result page, plus one extra match to decide whether **Next** is needed.
This finds matches on later catalogue pages rather than searching only the first six.

For each displayed venue, the API checks retirement, opening hours and existing
booking conflicts. It adds an availability label to the response without changing
the venue or any booking. The frontend shows the original comparison details and
that label. No matches produces **No venues match** with a suggestion to clear filters.

Main files:

- `api/app/venue_search.py`: validation, matching, pagination and availability labels.
- `api/app/venues.py`: connects search to the existing authenticated catalogue route.
- `frontend/src/app/venues/venue-search-form.tsx`: labelled search controls.
- `frontend/src/app/venues/page.tsx`: results, pagination, empty state and retry.
- `supabase/venue_search.sql`: additive retirement marker.

## Matching rules and API contract

The existing response remains `{ "venues": [...], "page": 1, "has_more": false }`.
Existing `GET /venues?page=1` consumers keep the same behaviour. Filtered results
add `search_availability` to each venue; existing venue fields remain intact.

| Parameter | Meaning |
| --- | --- |
| `location` | Case-insensitive substring of the location. Whitespace is normalised. |
| `attendance`, `capacity` | Positive integer minimums. When both are set, use the larger. |
| `layout` | A complete supported layout name, ignoring case and extra whitespace. |
| `facilities`, `accessibility` | Comma-separated feature names. Every supplied name must match a full catalogue entry, ignoring case and extra whitespace. |
| `date`, `start_time`, `end_time` | Supply all three or none: `YYYY-MM-DD`, `HH:MM`, `HH:MM`, in Singapore time. End must follow start on the same day. |
| `available_only` | Optional `true`/`false`. True requires a complete time slot and excludes unavailable venues before pagination. |
| `page` | Result page, 1–10000. Search/clear resets the UI to page 1. |

Invalid or repeated parameters return `400`. Database failures return `503` and
never claim a venue is available. Failed searches preserve the input for correction
or retry. Results are not cached.

Availability values are `not_checked`, `available`, `retired`, `closed`, `blocked`
and `booked`. By default, unavailable venues remain visible with a clear reason. Selecting
**Only show available venues** excludes them before pagination. Without a full time slot, the UI does not claim
availability. Retired venues are flagged even without a time search.

## Working with teammates' features

- **SCRUM-24:** reuse the existing venue data and repository paging. Creation is unchanged.
- **SCRUM-29:** keep the suitability engine and both suitability endpoints unchanged.
  Search uses explicit catalogue feature names; it does not replace event suitability analysis.
- **SCRUM-30:** keep venue detail and calendar routes and links unchanged.
- **SCRUM-31/33:** reuse `find_overlapping_bookings`. Only Confirmed and Blocked
  intervals prevent availability; Requested, Rejected and Cancelled do not.
  Intervals are half-open: a booking ending at 09:00 does not block a 09:00 start.
- **SCRUM-32:** search does not submit, approve, reject or reserve bookings. Availability
  can change after a search; the existing booking checks remain authoritative.
- **Future retirement work:** `venues.is_retired` is the shared marker. This story
  provides no retirement editing screen or new write permissions. Retirement checks
  in future booking/lifecycle work must use this marker too.

The search reads existing catalogue pages until it has enough matching results.
This is simple for the current catalogue, but large catalogues would benefit from
moving filtering into a database query. Normal time searches make at most six booking queries per result page. Available-only
searches also check candidates before pagination, so they can make more queries.
`GET /venues/filter-options` supplies deduplicated facilities/accessibility choices
from all active catalogue pages, under the same role checks. If suggestions fail,
manual entry remains available.

## Verification

- `api/tests/test_venue_search.py`: 54 unit/API cases for filters, boundaries,
  invalid inputs, permissions, pagination and safe availability failures.
- `api/tests/test_venue_acceptance.py`: real PostgreSQL/PostgREST search tests,
  including retirement, cross-page matching, booking statuses and touching intervals.
- `frontend/e2e/venues.spec.ts`: combined filters, pagination, clear/reset, unavailable
  labels, invalid input, empty results, mobile width and availability retry.
- The disposable database setup applies the new migration twice to verify reruns.

Run API unit tests with `cd api && .venv/bin/python -m pytest`. Database tests need
the isolated stack from `compose.acceptance.yml` and `POSTGREST_TEST_URL` as in CI.
Run frontend checks with `npm run lint`, `npm run test:unit`, `npm run build` and
`npm run test:e2e` from `frontend`.

Local verification on 4 October 2026: the full API suite passed **525 tests** with
the disposable database enabled; the search module had **100% statement coverage**.
Frontend unit tests passed **16 tests** and the full browser suite passed **87 tests**.
The existing booking browser tests now wait for venue options before entering attendance,
avoiding a race with initial form values. Booking application code is unchanged.
Ruff, ESLint and the whitespace check passed. The production build passed with
`npm run build -- --webpack`; the default Turbopack build hit a local worker-port
permission restriction. CI and human PR review remain required before merge.

# SCRUM-27: View a venue's full record

> As a Coordinator, I want to view a venue's full record, so that I can assess its
> suitability before booking.

| Acceptance criterion | How it is met |
| --- | --- |
| A Coordinator can open a venue and view its full record (location, capacity, facilities, accessibility, supported layouts, operating info, status) | A **Venue record** region on `/venues/{venue_id}` lists all seven, plus the setup and turnaround buffers |
| Retired or blocked venues are clearly marked | **Status** reads `Retired`, `Blocked — {reason} until {time}` while a closure is running, or `Active`; Coordinators also get a list of current and upcoming closures |
| The view is read-only for Coordinators (only Venue Staff can edit) | No edit, block or retire control renders for a Coordinator; the block form and retire panel stay behind `actingRole === "Venue Staff"` |

The catalogue card already showed most of the record, but the page it links to — the one
carrying the availability calendar — showed only name, location and capacity, so the record
could not be read where the booking decision is made. Audit finding "Full venue record —
SCRUM-27" (2 November 2026) recorded that gap.

## What the page shows

| Field | Shown as |
| --- | --- |
| Location | the venue's location |
| Capacity | `80 people` |
| Status | `Active`, `Retired`, or `Blocked — Maintenance until 5 Nov 2026, 2:00 pm` |
| Layouts | supported layouts, `·`-separated |
| Facilities | `·`-separated, or `None listed` |
| Accessibility | `·`-separated, or `None listed` |
| Setup buffer | `15 minutes before the event`, or `None` |
| Turnaround buffer | `30 minutes after the event`, or `None` |
| Time zone | the venue's stored zone |
| Opening hours | collapsed per-day list; a day without hours reads `Closed` |

Setup and turnaround are not named in the ACs but are catalogue metadata in core
requirement 8, and they explain the calendar directly below: a slot next to an existing
booking can be unbookable even though it looks free.

### Closures, and why they span 90 days

A Coordinator assesses a venue *before booking*, and bookings are made ahead, so a closure
three weeks out is exactly what should change the decision. The status and the closure list
therefore read a 90-day window from now, independent of the week the calendar is showing —
otherwise a venue shut next month would read `Active` until the Coordinator happened to page
forward. Venue Staff do not get this list: they already manage the same closures, with an
Unblock action, in their own panel further down.

`Retired` outranks `Blocked`: a retired venue takes no bookings whatever its calendar says.
Closure comparison is half-open, matching the booking engine — a closure ending at 14:00 is
over at 14:00.

## Scope

- **Display only.** No API, schema, authorisation or status-transition change, so no Decision
  Log entry. Every field comes from the existing `GET /venues/{venue_id}` payload, and the
  closure list from `GET /venues/{venue_id}/unavailability`, which already admits
  Coordinators.
- **Who can see it:** unchanged. The page stays Coordinator and Venue Staff; every other role
  still gets *The availability calendar is available to Coordinators and Venue Staff.*
  Opening the record to Organisers would be an access-control decision and was deliberately
  kept out of this story.
- The catalogue card is unchanged; the two views now agree.

## Tests

- `frontend/src/lib/venue-status.test.ts`: `activeClosure`, `venueStatus` and `venueMoment` —
  the running closure, closures not yet started, both half-open boundaries, retired
  outranking blocked, and Singapore rendering.
- `frontend/src/app/venues/[venueId]/detail.test.tsx`: every field and value, the absent cases
  (`None listed` / `None`), each day's hours including closed days, `Active` / `Blocked` /
  `Retired`, the Coordinator's closure list, its absence for Venue Staff, a failed closure
  lookup leaving the record readable, no record for a role that cannot open the venue, and
  **AC3** — a Coordinator is offered no block, retire or edit control.
- `frontend/integration/venue-flows.spec.ts` (INTEGRATED-13): against the real API and
  database, the edited venue's record is read back on the venue page — location, capacity,
  `Active`, remaining layout, changed facilities, accessibility, both buffers, time zone, the
  changed Monday hours, both closed days — the removed layout is absent, and after retirement
  the same record reports `Retired`, before and after a reload.

### Changed existing test — reviewable

`detail.test.tsx`'s shared `venue` fixture previously carried only `id`, `name`, `location`,
`capacity`, `operating_hours` and `is_retired`. It now also carries the layouts, facilities,
accessibility, buffers and time zone that `GET /venues/{venue_id}` always returns, so the page
is exercised against the real payload shape. No existing assertion was changed, weakened or
removed. Flagged per the root AGENTS.md test-protection rule.

## Traceability note

`docs/testing/requirements.json` tracked CORE-08 (Venue catalogue) under SCRUM-24, SCRUM-25
and SCRUM-60; SCRUM-27 was not listed there at all. This increment adds it with the checks
above, so the story's evidence is reachable from the requirement manifest.

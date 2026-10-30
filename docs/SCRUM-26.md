# SCRUM-26: Retire a venue

Venue Staff retire a venue so it is no longer offered for new bookings, while its
history is kept. The rules are recorded in [Decision Log D35](DECISION_LOG.md).

## What retiring does

| | After retirement |
| --- | --- |
| Venue record and details | Kept, read-only (editing returns 409) |
| Confirmed bookings, past and upcoming | Unchanged; they can still be cancelled as usual |
| Rejected and cancelled bookings | Unchanged |
| New booking requests, or moving a request to it | Refused (409), also by a database trigger |
| Coordinators' catalogue, search and suitability ranking | Retired venue left out |
| Venue Staff catalogue | Still listed, flagged "Unavailable — retired venue", no edit action |
| Venue page and availability calendar | Still available, with a "Venue retired" banner |
| Audit | `retired_at` and `retired_by` recorded with the flag, in one transaction |

Retirement is final; this story adds no un-retire action.

## Who can retire, and when

- **Venue Staff only** (403 for every other role, logged in `access_denied_log`).
- A venue with **Requested, Pending or Held** bookings cannot be retired: the API
  answers 409 with the count, for example *Decide the 2 outstanding booking requests
  for this venue before retiring it.* Approve or reject them first.
- An already retired venue answers 409 *This venue is already retired.*

## Workflow

- `POST /venues/{venue_id}/retire` with an empty JSON object (or no body). Any field,
  including `retired_by` or `retired_at`, is refused: the server records them.
- The `retire_venue` database function locks the venue, re-checks the actor and the
  rules, then sets `is_retired`, `retired_at` and `retired_by` and moves `revision` on,
  so an edit form opened earlier cannot save.
- The response returns the venue (with `retired_by_name`) and
  `kept_confirmed_bookings`, the number of upcoming confirmed bookings kept.
- `GET /venues/{venue_id}` returns `retired_by_name` for a retired venue.

## Database setup

Apply
[`20261031090000_scrum_26_retire_venue.sql`](../supabase/migrations/20261031090000_scrum_26_retire_venue.sql)
after `venue_search.sql` (SCRUM-28), `update_venues.sql` (SCRUM-25) and
`create_venue_bookings.sql`. It adds two nullable columns, a check constraint, the
function and a trigger, and is safe to rerun. The disposable CI database applies it
automatically. `retired_by` deliberately has no foreign key (see D35).

## Tests

- `api/tests/test_venue_retirement.py`: retirement, booking and edit rules.
- `api/tests/test_venue_retirement_route.py`: endpoint permissions and input,
  refusals, Coordinator exclusion with full pages, suitability ranking, booking
  refusals, the read-only venue and the repository's error mapping.
- `api/tests/test_venue_retirement_acceptance.py`: real database, covering the audit,
  every booking unchanged, outstanding requests, database re-checks, the trigger,
  Coordinator search and a retirement racing a new request.
- `frontend/e2e/venue-retire.spec.ts`: the panel and confirm step, refusals, who sees
  the panel, the banner, the catalogue and the edit page, including a phone width.
- `api/tests/test_venue_acceptance.py`: SCRUM-28's retirement-flag search now runs as
  Venue Staff, because Coordinators no longer see retired venues (flagged in D35).

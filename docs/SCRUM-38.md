# SCRUM-38 — Review and reserve requested equipment

[Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-38) · Jerome · 5 points · Sprint 3 stretch.
[Scope and Definition of Done](https://spm-g6t4.atlassian.net/wiki/spaces/CS/pages/11141141) ·
[Test scenarios](https://spm-g6t4.atlassian.net/wiki/spaces/CS/pages/11141162).

The first version let Tech Support choose **Reserved** without creating a stock
reservation. This follow-up connects the request to the existing SCRUM-36/37
reservation table. Tech Support saves quantities and a time slot on the request
review page; the app calculates the status from those bookings.

## How to explain it

A request records **demand**. A reservation sets aside **stock for a time slot**.

Example: the catalogue has 5 microphones and the Coordinator requests 3.
Tech Support reserves 2 for 31 October, 9–10 am:

- Requested stays **3**: the original demand does not change.
- Reserved becomes **2**; remaining to fulfil becomes **1**.
- Request status becomes **Partially fulfilled**.
- Available stock for an overlapping slot becomes **5 − 2 = 3**.
- Catalogue total stays **5** because the microphones still exist.

Changing the reserved total from 2 to 3 takes **one more** unit, not three more.
Lowering it from 3 to 1 releases two. Zero releases that item's booking. The
quantity field always means the **total to reserve**, not an amount to add.
Outside the booked slot, the booking does not reduce availability. A booking
ending at 10 am does not overlap one starting at 10 am (`[start, end)`).

| Status | Rule |
| --- | --- |
| Requested | No linked units are reserved; arrangements are outstanding. |
| Partially fulfilled | At least one unit is reserved, but some requested quantity remains. |
| Reserved | Every requested item has its full quantity reserved. |
| Unavailable | Tech Support explicitly records that the request cannot be supplied, with no linked units reserved. |

**Reserved** and **Partially fulfilled** are automatic. The manual dropdown only
contains **Requested** and **Unavailable**, and is shown when no units are linked.
Release linked units first if the whole request must become Unavailable.

## Run and review the demo

Marcus applies the following complete files in order, after the existing
`create_equipment.sql`, `create_equipment_requests.sql` and
`create_equipment_reservations.sql` setup:

1. [`20261018111728_scrum_38_equipment_request_status.sql`](../supabase/migrations/20261018111728_scrum_38_equipment_request_status.sql), if not already applied.
2. [`20261018134736_link_equipment_request_reservations.sql`](../supabase/migrations/20261018134736_link_equipment_request_reservations.sql), the new follow-up.

Both are repeatable in this order. Never run `supabase/tests/` on the shared
project. The follow-up preserves existing requests, history and catalogue
bookings; it does not guess which old booking belongs to which request.

Retain the existing `.env` files. In two terminals, from the repository root:

```sh
cd api
source .venv/bin/activate
flask --app app run --reload --port 5001
```

```sh
cd frontend
npm run dev -- --port 3001
```

The frontend port must match `FRONTEND_ORIGIN` in `api/.env`; this workspace uses
`http://localhost:3001`. Restart Flask after applying the migration.

1. As **Demo Coordinator**, submit a request for an assigned Planning event.
2. Switch to **Demo Tech Support → Review equipment requests → Review request**.
3. Under **Reserve requested equipment**, choose start/end in Singapore time.
   Enter each item's total reserved quantity and select **Save reservations**.
4. Check **Reserved / Remaining** and the automatic status. The history records
   the actor, timestamp, quantities and time slot, even if the status stays partial.
5. In the catalogue, check the same equipment and an overlapping time slot.
   Availability must reflect the reserved units; catalogue total stays unchanged.
6. Switch to **Demo Coordinator → View equipment requests → View request**.
   The same details and history are visible, without edit controls.

For the existing **Ernest 2billion dollars / Thomson Reserve Event** demo,
1 unit was already booked for **31 October 2026, 9–10 am SGT** through the catalogue.
Choose that entry in **Existing booking** and save to link it to the request.
This reuses the booking and does not reserve a second unit. Keep its quantity and
slot unchanged while linking; later saves can change the linked booking normally.
An old manually set Reserved label alone is not proof of an allocation. The page
shows the previous label separately until the matching booking is linked.

## Code walkthrough and boundaries

- `reservation-form.tsx` collects one time slot and a reserved total per item.
  The browser explicitly converts Singapore time to UTC.
- `equipment_requests.py` checks the session, Tech Support role, origin and input.
  Actor identity comes from the session, never from the submitted JSON.
- `equipment_request_repository.py` calls one database function. Reads add each
  item's reserved quantity and derive the displayed status from active bookings.
- `save_equipment_request_reservations` validates the request and event, locks the
  shared stock rows, saves all bookings, calculates status, and records history
  in one transaction. Any failure rolls back everything.
- `check_equipment_reservation_capacity` also protects the existing catalogue
  reservation path. Both paths share the same stock. Jessica's availability and
  reservation engines remain in use; no replacement engine was introduced.

`PUT /equipment/requests/{id}/reservations` accepts `start_at`, `end_at`, `revision`,
`notes` and `items`. Each item has `equipment_id`, a whole-number `quantity` from
zero through the originally requested quantity, and optionally `reservation_id`
to link an existing event booking. Include every requested item once. The optional
booking must match the event, equipment, quantity and slot, and be unlinked.
`PATCH .../status` accepts only Requested or Unavailable when no linked stock exists.

Each request uses one common time slot and at most one booking row per item.
A revision check prevents stale edits and repeated clicks from booking twice.
Catalogue stock rows are locked in a consistent order so concurrent requests
cannot reserve the same capacity. The guard uses the existing conservative rule:
sum every active reservation overlapping the selected slot.

Only Tech Support writes. The assigned Coordinator can read; unrelated users
cannot. Cancelled, Completed and Rejected events are read-only. The existing
cancellation trigger releases bookings; reads then show zero reserved units.
Old history remains a record of what was arranged at that time. Passing a slot's
end does not erase a historical reservation, but it no longer overlaps later slots.

Database functions use an empty search path, qualified objects and backend-only
execute grants. Table RLS and the existing Flask session model remain in place.
The SCRUM-39 confirmation-readiness integration is separate from this change.

## Verification — 18 October 2026

| Case | Evidence |
| --- | --- |
| TC-38-01 | Requested/Unavailable manual updates; partial/full status derived from actual quantities; notes and original demand retained. |
| TC-38-02 | Coordinator reads the same quantities and status; role, assignment and read-only browser checks. |
| TC-38-03 | Actor/time and allocation snapshots persist; simulated audit failure rolls back bookings and status. |
| TC-38-04 | Forged metadata, invalid quantities/times, excess demand and manual Reserved/partial labels are rejected; backend grants checked. |
| TC-38-05 | Stale revisions, concurrent catalogue/request bookings, closed events and event cancellation. |
| TC-38-06 | Reducing/releasing reservations restores availability; adjacent slots do not overlap. |
| TC-38-07 | Insufficient stock for one item rolls back the whole request save. |
| TC-38-08 | Existing event booking links once; another event's booking cannot be adopted. |

Final local results: **888 API tests**, **145 browser tests**, **16 frontend unit
tests**, Ruff, ESLint and production Webpack build passed. A fresh disposable
install and repeat migration passes succeeded; SQL permissions and audit rollback
checks passed. Desktop/mobile request screenshots were inspected.

Browser checks use controlled API responses. API acceptance checks use real Flask,
PostgREST and PostgreSQL in disposable containers, separate from shared data.
The test fixture clears inherited Supabase credentials: the earlier status-only
implementation exposed and fixed a fixture leak that had written 31 denial-log
entries to the shared project. Those historical audit entries were retained.

Reproduce from a fresh disposable database using `compose.acceptance.yml` and
`supabase/tests/run.sh`; then run pytest with
`POSTGREST_TEST_URL=http://127.0.0.1:55433`. Browser tests use a separate production
server (`PLAYWRIGHT_PORT=3108`), with the normal build, lint and unit-test commands.

Shared demo verification: the user applied the follow-up migration on 18 October
2026. The still-running old Flask process returned 404 for the new reservation
endpoint's OPTIONS request, producing the browser's generic save error. Restarting
Flask with `--reload` loaded the endpoint (OPTIONS 200). Retrying the user's exact
request reserved 3 “jessica 5billion dollars” units for Thomson Reserve Event,
31 October 9:00 am–10:01 pm SGT. The refreshed page showed Reserved, remaining 0,
and one attributed history entry. The failed preflight attempts made no bookings.

If the same generic error appears immediately after installing backend changes,
restart Flask and reload the request before retrying. `--reload` handles subsequent
Python edits automatically. Do not rerun SQL just to restart the API.

PR/remote CI, human review and merge remain required before Done. Local checks and
the shared demo do not count as human approval.

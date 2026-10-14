# SCRUM-34 — Equipment catalogue

Sprint 3 · Jerome · [Jira story](https://spm-g6t4.atlassian.net/browse/SCRUM-34)

Tech Support can add and edit equipment with a type, description, quantity,
location and operational status. Coordinators can read the same catalogue.
Every successful creation or update records the acting user and database time.

## Setup and a short demo

1. Apply `supabase/seed_users.sql` if user setup has not been done, then apply
   `supabase/create_equipment.sql` in the development Supabase SQL Editor. The
   equipment migration is safe to rerun and preserves existing equipment.
2. Start Flask on port 5001 and Next.js on port 3000 using the README instructions.
3. Sign in as Tech Support, or select **Demo Tech Support** with the development
   switcher enabled. Open **Equipment catalogue → Add equipment**.
4. Enter `Wireless microphone`, `Handheld with receiver`, quantity `8`, location
   `AV store`, status `Operational`. Save and open the catalogue: usable stock is 8.
5. Edit the entry to `Under Maintenance`. Save: total quantity stays 8 and usable
   stock becomes 0. **Show usable stock only** excludes this entry.
6. Try a negative or fractional quantity: saving fails with a field error. Zero is
   valid. Open an entry in two tabs, save one and then the other: the stale save is
   rejected with a reload action, so it cannot silently overwrite the newer change.
7. Switch to Coordinator: the catalogue is readable, with no add/edit controls.
   Other roles cannot read it. The API independently enforces these permissions.

The migration is delivered with the feature; running local acceptance tests does
not apply it to the team's shared Supabase project.

## How the code fits together

| File | Responsibility |
| --- | --- |
| `frontend/src/app/equipment/equipment-workspace.tsx` | Page shell, session lookup and role-specific access |
| `frontend/src/app/equipment/page.tsx` | Catalogue cards, usable-stock filter and pagination |
| `frontend/src/app/equipment/equipment-form.tsx` | Shared add/edit form, field errors and save feedback |
| `frontend/src/app/equipment/new/page.tsx` | Add-page entry point |
| `frontend/src/app/equipment/[equipmentId]/edit/page.tsx` | Fetch the selected item and open its form |
| `frontend/src/lib/equipment.ts` | Shared TypeScript data shape and Singapore-time display |
| `api/app/equipment.py` | HTTP routes, session/origin checks and role enforcement |
| `api/app/equipment_validation.py` | Required fields, text lengths, quantity and status validation |
| `api/app/equipment_repository.py` | Database reads, audited save call and safe error messages |
| `supabase/create_equipment.sql` | Tables, computed stock, permissions and atomic save/history function |

A save follows this path:

```text
Form → Flask checks session and role → validates the five fields
     → save_equipment_item → equipment row + history row in one transaction
     → success message → refreshed catalogue
```

The browser never supplies the actor or timestamp. Flask takes the actor from the
signed session. The database function checks that actor's current Tech Support role
and generates the timestamp. Direct browser access to the tables/function is denied;
the backend service role can read tables and call the function, but cannot bypass
the audit by directly inserting or updating equipment.

An edit includes the revision the form loaded. The database locks the row, compares
that revision, saves the edit and increments the revision. A stale edit returns 409.
If writing the history fails, the equipment change rolls back too.

## Shared contract for SCRUM-35, SCRUM-36 and SCRUM-37

`equipment_items` is the catalogue source. Each row represents a batch of units
with the same type, description, location and condition. Use its UUID `id` as the
reference for later requests and reservations; names are not unique identifiers.

| Field | Rule |
| --- | --- |
| `equipment_type` | Required text, 1–100 characters after trimming |
| `description` | Required text, 1–2,000 characters after trimming |
| `total_quantity` | Integer from 0 to 2,147,483,647 |
| `location` | Required text, 1–300 characters after trimming |
| `operational_status` | Exactly `Operational`, `Damaged` or `Under Maintenance` |
| `usable_quantity` | Database-generated: total quantity when Operational; otherwise 0 |
| `created_by`, `created_at` | Original actor and timestamp; preserved during edits |
| `updated_by`, `updated_at`, `revision` | Latest actor/time and conflict protection |

For example, 8 working microphones and 2 damaged microphones should be separate
entries with quantities 8 and 2. Do not enter 10 in the operational entry as well.
Condition applies to the entire entry. Moving units between entries currently
requires separate edits; an atomic stock-transfer workflow is outside SCRUM-34.

**Usable stock is not time-slot availability.** SCRUM-36/37 must use this stock
ceiling and account for overlapping reservations. They also need to decide how
stock/condition changes affect existing reservations, rather than silently changing
booking state. SCRUM-34 does not create requests, holds, reservations or decisions.
The availability engine should use database rows/functions across the full catalogue,
not just one six-item UI page.

### API

All endpoints require the configured frontend Origin and an authenticated session
(or explicitly enabled development session). Responses use `Cache-Control: no-store`.

| Method/path | Access | Response |
| --- | --- | --- |
| `GET /equipment?page=1&operational_only=false` | Tech Support, Coordinator | `{equipment: [...], page: 1, has_more: false}`; 6 rows per page |
| `GET /equipment/<uuid>` | Tech Support, Coordinator | `{equipment: {...}}`, or 404 |
| `POST /equipment` | Tech Support | Five catalogue fields; returns saved item with 201 |
| `PUT /equipment/<uuid>` | Tech Support | Same five fields plus `revision`; returns saved item with 200 |

`operational_only=true` filters `usable_quantity > 0` before pagination, so damaged,
maintenance and zero-stock entries cannot occupy pages of usable results. Default
listing shows all conditions. Sort order is creation time descending, then UUID.

Invalid fields return 400 with `fields` messages; missing sessions return 401;
forbidden access returns 403; conflicting edits return 409; database/network failures
return 503 with safe recovery text. A network failure may happen after a commit, so
the UI directs the user to check the catalogue before retrying an uncertain save.

`equipment_item_history` contains `Created`/`Updated`, actor, timestamp, and complete
before/after snapshots. Creation has a null before snapshot. History is retained in
the database; the catalogue shows the latest editor/time and the edit form shows
the creator/time. There is no public audit-history or delete endpoint in this story.

## Acceptance evidence

Local execution on 11 October 2026: 642 API tests passed (including real database
acceptance tests), 16 frontend unit tests passed, and all 111 browser tests passed.
Ruff and ESLint passed. The database migration ran twice successfully, and all SQL
checks passed. After attaching screenshots to the HTML report, the 13 equipment
browser tests passed again. The local production build passed with `--webpack`;
the default Turbopack build hit a local worker-port permission error. CI runs the
repository's unchanged default build on Node 22 / Python 3.12. Local versions were
Node 24 / Python 3.14. The PR records CI results separately.

Traceability to the [Sprint 3 test plan](https://spm-g6t4.atlassian.net/wiki/spaces/CS/pages/11141162):

| Planned case | Execution coverage and remaining work |
| --- | --- |
| TC-34-01 | Create/edit persistence and actor/time passed. The concrete schema calls usable condition `Operational`; the draft test plan calls it `Available`. |
| TC-34-02 | Zero accepted; negative and fractional quantities rejected. Passed at API/database boundaries. |
| TC-34-03 | Catalogue condition flags, zero usable stock, and exclusion from usable-stock queries passed. **The planned event-time availability check remains pending SCRUM-36/37 integration.** |
| TC-34-04 | Organiser and Attendee writes denied with no change; the other non-support roles are covered too. Passed. |

| Criterion | Automated evidence |
| --- | --- |
| Maintain all five fields | `test_equipment_acceptance.py`: real create/edit persistence and Coordinator read; `equipment.spec.ts`: create → catalogue → edit |
| Non-negative integer quantity | `test_equipment.py`: zero/max accepted, negative/fraction/bool/string/null/overflow rejected; acceptance tests verify database validation too |
| Unavailable conditions excluded | Real database tests check generated stock and filtering before pagination; browser test checks maintenance flag and zero usable stock |
| Actor and timestamp recorded | Acceptance tests verify creation/update snapshots and attribution; `supabase/tests/equipment.sql` proves audit failure rolls back writes |
| Access, conflict and error handling | API role/session/origin/spoofing checks; stale revision and rollback tests; browser tests for field errors, 409, 503, cancel, missing record and retry |

Run the database suite from the repo root using an unused local port 55433:

```bash
docker compose -p connectsphere-acceptance -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-acceptance -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh
cd api
POSTGREST_TEST_URL=http://127.0.0.1:55433 .venv/bin/python -m pytest --cov=app
.venv/bin/ruff check .
```

From `frontend`, run `npm run build`, `npm run lint`, `npm run test:unit`, then
`npm run test:e2e`. The browser suite uses a production build and mocked HTTP
responses; the API acceptance suite separately exercises real PostgreSQL/PostgREST.
Desktop/mobile screenshots are saved by `e2e/equipment.spec.ts` in Playwright's
test-results directory. GitHub Actions publishes API and browser test reports.

From the repo root, remove only the disposable stack you created:

```bash
docker compose -p connectsphere-acceptance -f compose.acceptance.yml down -v
```

Human review and green CI remain required before merge. Jerome should be able to
explain the five fields, computed usable stock, trusted session identity, transaction
and revision check during the demo/review. Test evidence supports the course's
Definition of Done; it does not replace teammate review or the remaining Sprint 3 work.

# Release testing and requirement traceability

The release checklist covers the 20 Week 4 core features and six mandatory Week 7
changes. Complete acceptance is not established: the checklist retains missing
workflows and unresolved policy decisions even when related tests pass.

- [Reviewed requirement mappings](requirements.json) record intent, accountable
  owners, Jira stories, executable test names, SQL assertion files and open gaps.
- [Latest executed checklist](release-verification/requirements.md) joins those
  mappings to real JUnit results. Its companion JSON retains the matched case names,
  outcomes, coverage denominators and verification-source digest.
- [SCRUM-146 handoff](../SCRUM-146.md) records the implementation, verification and
  human review required before merge.

## What each test layer proves

| Layer | Location | Evidence and limits |
| --- | --- | --- |
| Backend pure rules and HTTP tests | `api/tests/` | Pytest, including failure injection at I/O boundaries; mocks do not establish database persistence. |
| Backend database acceptance | `api/tests/*acceptance.py` | Real Flask, PostgREST and disposable PostgreSQL, including concurrency and rollback. Without `POSTGREST_TEST_URL`, these tests skip and cannot establish a release pass. |
| SQL contracts | `supabase/tests/` | The harness bootstraps and replays migrations twice, then runs assertion scripts. A path in the checklist is an assertion reference; retain a successful harness exit and log separately. Never run this harness on shared Supabase. |
| Frontend unit tests | `frontend/src/**/*.test.ts` | Vitest/V8 covers all `src` TS/TSX files, including unimported UI. Test files and declaration files are excluded. Browser execution is not added to this denominator. |
| Combined frontend source coverage | `npm run test:coverage:combined` | Identical original-source Istanbul counters for units and the controlled browser suite; merged by source location with untouched files retained. Excludes server-render execution, not server-only files. |
| Controlled browser tests | `frontend/e2e/` | Real browser and production Next.js with prepared HTTP responses. Useful UI evidence; not browser-to-database evidence. |
| Integrated journeys | `frontend/integration/` | Real password sessions, Flask and disposable database. One event crosses all seven roles through Preparation. Real HTTP resource setup proves API behaviour, not every catalogue/booking form. Completion, change, rejection, expiry and temporary-unavailability branches are not all in this browser lane. |

SCRUM-161 raises the backend regression gate to 100% with branches enabled. Run the
complete suite against the disposable database: a unit-only run cannot satisfy this
gate. Frontend `src/lib` runtime code has a 100% statement/branch/function/line gate;
the whole-source report still includes all pages and components. V8’s branch/function
counts do not prove branches inside unexecuted UI files. Neither 100% numeric coverage
nor a passing mapped test automatically accepts a customer requirement. See
[SCRUM-161](../SCRUM-161.md) for measured scopes and review evidence.

## Run verification locally

Run from the repository root with the existing API virtual environment, frontend
dependencies and Docker available. Ports 55433, 5001, 3107 and 3108 must be free.
The integrated lane refuses to reuse existing API/frontend servers. The disposable
SQL harness seeds synthetic password accounts; these credentials are test data only.

```sh
mkdir -p /private/tmp/connectsphere-release-evidence
docker compose -p connectsphere-verification -f compose.acceptance.yml up -d --wait
docker compose -p connectsphere-verification -f compose.acceptance.yml exec -T db sh /sql/tests/run.sh > /private/tmp/connectsphere-release-evidence/sql.log 2>&1
python3 scripts/qa/report.py --validate
python3 -m unittest discover -s scripts/qa -p 'test_*.py' -v
```

Stop if the SQL command fails. In `api/`:

```sh
ruff check .
POSTGREST_TEST_URL=http://127.0.0.1:55433 .venv/bin/pytest -q --cov=app --cov-branch --cov-report=term-missing --cov-report=json:/private/tmp/connectsphere-release-evidence/backend.json --cov-report=xml:/private/tmp/connectsphere-release-evidence/backend-coverage.xml --cov-report=html:/private/tmp/connectsphere-release-evidence/backend-html --junitxml=/private/tmp/connectsphere-release-evidence/backend.xml
```

In `frontend/`, build with the same public API origin used by the integration test:

```sh
npm run lint
npm run test:coverage
NEXT_PUBLIC_API_URL=http://localhost:5001 npm run build
PLAYWRIGHT_PORT=3108 PLAYWRIGHT_JUNIT_OUTPUT_FILE=test-results/browser.xml npm run test:e2e -- --reporter=html,junit
npm run test:integrated
```

If a local Turbopack worker-port restriction prevents a build, save that failure and
use `npm run build -- --webpack` for local verification. Record it as a fallback;
CI's default production build still has to pass on the supported environment.
`QA_PYTHON` can select another Python executable with the API dependencies installed;
CI uses Python 3.12. The adapter allowlists only the disposable service at port 55433,
clears Supabase credential environment variables before importing the application,
and adds no fixture endpoints or session shortcuts.

After the runs, assemble the checklist from the repository root:

```sh
python3 scripts/qa/report.py \
  --backend-junit /private/tmp/connectsphere-release-evidence/backend.xml \
  --backend-coverage /private/tmp/connectsphere-release-evidence/backend.json \
  --frontend-junit frontend/test-results/unit.xml \
  --frontend-coverage frontend/coverage/coverage-summary.json \
  --browser-junit frontend/test-results/browser.xml \
  --integrated-junit frontend/test-results/integrated.xml \
  --output-dir /private/tmp/connectsphere-release-evidence/checklist
docker compose -p connectsphere-verification -f compose.acceptance.yml down -v
```

Failed/error cases take precedence over skipped cases; absent execution never becomes
Pass. The generator validates source references but cannot judge the quality of an
assertion or sign off a business policy. It returns a report even when evidence is
missing or tests fail so those outcomes remain reviewable; each test job remains its
own CI gate. Keep reports for the same source version together. The verification-source
SHA256 covers application/test/tooling code, mappings and test/CI configuration; the
reported Git SHA alone is a baseline when the working tree is dirty.

## CI evidence and human acceptance

CI retains backend JUnit and statement/branch JSON/XML/HTML, frontend unit JUnit and
V8 reports, controlled browser HTML/JUnit, and separate integrated JUnit/traces.
The final traceability job downloads them and produces a per-requirement report.
Missing upstream artifacts remain unexecuted in that report and do not override a
failed upstream job. Hosted CI has to run after an authorised push; local checks do
not establish a hosted CI result.

An owner still needs to reconcile section-specific clarifications, review the complete
requirement scenarios, accept any documented scope trade-offs, and rehearse the real
release. Scrum meeting recordings, authentic estimates/velocity, instructor access,
the C4 design and the eLearn submission remain separate assessment deliverables.
Do not invent those records or mark a manual Confluence case Pass from a related unit
test. Update the manifest when an approved rule changes, preserve historical results,
and rerun verification before replacing the saved checklist.

## Combined frontend coverage

From `frontend`, run `npm run test:coverage:combined` (set `PLAYWRIGHT_PORT` if 3000
is occupied). This runs collector checks, 148 existing units, a separate instrumented
production build, the complete controlled browser suite and a reload-capture probe.
It then writes `coverage-combined/combined/index.html`, `comparison.json`, per-file
JSON summaries and LCOV. The adjacent `unit/` and `browser/` reports use exactly the
same denominator, so their contribution can be compared without adding percentages.
CI uploads this folder alongside the unchanged Vitest/V8 unit report. The existing
release-evidence adapter continues to consume that V8 report; use the combined
artifact for frontend unit-plus-browser percentages.

The existing `npm run test:coverage` remains the V8 unit-only report and enforces
100% for `src/lib`. Its counting model differs from Istanbul's; do not compare its
5.78% whole-source figure directly with the combined percentage. Original source
hashes and counter-map checks prevent merging stale or incompatible evidence. A failed
command cannot publish a fresh combined report. Existing test bodies are unchanged;
41 browser spec imports now use the opt-in automatic fixture.

No shared database is needed: browser responses remain controlled fixtures. This report
measures frontend code execution, not backend enforcement, full end-to-end integration,
all possible inputs or acceptance of every requirement. Server-only source stays at zero
unless a unit executes it; the report does not capture server rendering. Normal builds
use `.next`; coverage builds use `.next-coverage`, with test instrumentation opt-in only.
See [D51](../DECISION_LOG.md) for review constraints and collection limits.

The collector follows [Playwright's automatic fixture lifecycle](https://playwright.dev/docs/test-fixtures)
and uses the [Istanbul instrumenter](https://github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-lib-instrument/api.md)
for both test layers. Coverage never replaces assertions or human review.

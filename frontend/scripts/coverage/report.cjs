const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createCoverageMap } = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const { root, dataDir, sources, digest } = require('./instrument.cjs');

function mergeChecked(map, baseline, snapshot) {
  for (const [file, value] of Object.entries(snapshot)) {
    assert.ok(baseline[file], `Unexpected source file: ${file}`);
    for (const field of ['statementMap', 'fnMap', 'branchMap']) {
      assert.deepEqual(value[field], baseline[file][field], `Incompatible ${field}: ${file}`);
    }
    map.addFileCoverage(value);
  }
}
function assertCompleteCoverage(summary) {
  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    const { covered, total } = summary[metric];
    assert.equal(covered, total, `Combined ${metric} coverage must be 100% (${covered}/${total})`);
  }
}
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function report() {
  const baseline = read(path.join(dataDir, 'baseline.json'));
  const hashes = read(path.join(dataDir, 'sources.json'));
  assert.deepEqual(sources(), Object.keys(hashes), 'Source inventory changed during coverage run');
  for (const [file, hash] of Object.entries(hashes)) {
    assert.equal(digest(fs.readFileSync(file, 'utf8')), hash, `Source changed during coverage run: ${file}`);
  }
  const unit = createCoverageMap(structuredClone(baseline)), browser = createCoverageMap(structuredClone(baseline));
  const unitFiles = fs.readdirSync(path.join(dataDir, 'unit')).filter(f => f.endsWith('.json'));
  const browserFiles = fs.readdirSync(path.join(dataDir, 'browser')).filter(f => f.endsWith('.json'));
  assert.ok(unitFiles.length && browserFiles.length, 'Both test suites must supply coverage');
  for (const name of unitFiles) mergeChecked(unit, baseline, read(path.join(dataDir, 'unit', name)));
  for (const name of browserFiles) {
    const run = read(path.join(dataDir, 'browser', name));
    assert.equal(run.status, 'passed', `Browser test did not pass: ${run.title}`);
    for (const snapshot of run.snapshots) mergeChecked(browser, baseline, snapshot.coverage);
  }
  assert.ok(browser.getCoverageSummary().statements.covered > 0, 'No instrumented browser code executed');
  const combined = createCoverageMap(JSON.parse(JSON.stringify(unit)));
  combined.merge(browser);
  const output = path.join(root, 'coverage-combined');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(path.join(dataDir, 'sources.json'), path.join(output, 'sources.json'));
  const comparison = {};
  for (const [name, map] of Object.entries({ unit, browser, combined })) {
    const context = libReport.createContext({ dir: path.join(output, name), coverageMap: map });
    for (const format of ['html', 'json', 'json-summary', 'lcovonly']) reports.create(format).execute(context);
    comparison[name] = map.getCoverageSummary().toJSON();
  }
  const result = { generatedAt: new Date().toISOString(), sourceFiles: Object.keys(baseline).length,
    browserTests: browserFiles.length, unitSnapshots: unitFiles.length,
    method: 'Same Istanbul source counters before TypeScript/JSX compilation; union of unit and browser execution. Includes untouched source files. Server-render execution is not collected.',
    comparison };
  fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(result, null, 2));
  console.table(Object.fromEntries(Object.entries(comparison).map(([name, metrics]) => [name,
    Object.fromEntries(['statements', 'branches', 'functions', 'lines'].map(key => [key, metrics[key].pct]))])));
  console.log(`Combined HTML: ${path.join(output, 'combined/index.html')}`);
  assertCompleteCoverage(comparison.combined);
  return result;
}
module.exports = { mergeChecked, assertCompleteCoverage, report };
if (require.main === module) report();

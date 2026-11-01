const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { instrument, eligible } = require('./instrument.cjs');
const { mergeChecked } = require('./report.cjs');
const path = require('node:path');
const file = path.resolve('src/example.ts');
const baseline = { [file]: instrument('export function choose(flag: boolean) { return flag ? 1 : 2; }', file).coverage };

test('unit and browser coverage form a union without contaminating either individual report', () => {
  const unit = createCoverageMap(structuredClone(baseline));
  const browser = createCoverageMap(structuredClone(baseline));
  const first = structuredClone(baseline), second = structuredClone(baseline);
  const branch = Object.keys(first[file].b)[0];
  first[file].b[branch] = [1, 0];
  second[file].b[branch] = [0, 1];
  mergeChecked(unit, baseline, first);
  mergeChecked(browser, baseline, second);
  const combined = createCoverageMap(JSON.parse(JSON.stringify(unit)));
  combined.merge(browser);
  assert.equal(unit.getCoverageSummary().branches.pct, 50);
  assert.equal(browser.getCoverageSummary().branches.pct, 50);
  assert.equal(combined.getCoverageSummary().branches.pct, 100);
  assert.deepEqual(baseline[file].b[branch], [0, 0]);
});

test('stale or incompatible source maps cannot silently inflate the report', () => {
  const map = createCoverageMap(structuredClone(baseline));
  const stale = structuredClone(baseline);
  stale[file].statementMap[0].start.line = 999;
  assert.throws(() => mergeChecked(map, baseline, stale), /Incompatible statementMap/);
  assert.throws(() => mergeChecked(map, baseline, { '/foreign.ts': stale[file] }), /Unexpected source/);
});

test('unexecuted runtime files stay in the denominator and only test/type declarations are omitted', () => {
  const map = createCoverageMap(structuredClone(baseline));
  assert.equal(map.getCoverageSummary().statements.pct, 0);
  assert.equal(eligible(path.resolve('src/app/page.tsx')), true);
  assert.equal(eligible(path.resolve('src/lib/sample.test.ts')), false);
  assert.equal(eligible(path.resolve('src/env.d.ts')), false);
  assert.equal(eligible(path.resolve('node_modules/example.ts')), false);
});

test('the combined gate requires every counter, even if a percentage rounds to 100', () => {
  const { assertCompleteCoverage } = require('./report.cjs');
  const complete = Object.fromEntries(['statements', 'branches', 'functions', 'lines']
    .map(metric => [metric, { covered: 100000, total: 100000, pct: 100 }]));
  assert.doesNotThrow(() => assertCompleteCoverage(complete));
  for (const metric of Object.keys(complete)) {
    const missing = structuredClone(complete);
    missing[metric].covered--;
    assert.throws(() => assertCompleteCoverage(missing), new RegExp(`Combined ${metric} coverage must be 100%`));
  }
});

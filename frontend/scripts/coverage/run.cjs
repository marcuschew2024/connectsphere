const { spawnSync } = require('node:child_process');
const { prepare, root } = require('./instrument.cjs');
const { report } = require('./report.cjs');
const env = { ...process.env, COMBINED_COVERAGE: '1' };
function run(args) {
  const result = spawnSync('npm', args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Coverage command failed: npm ${args.join(' ')} (${result.status})`);
}
prepare();
run(['run', 'test:coverage:tooling']);
run(['exec', '--', 'vitest', 'run', '--config=vitest.combined.config.ts']);
run(['run', 'build']);
run(['exec', '--', 'playwright', 'test', '--config=playwright.coverage.config.ts', '--reporter=line', '--output=test-results/combined-browser']);
report();

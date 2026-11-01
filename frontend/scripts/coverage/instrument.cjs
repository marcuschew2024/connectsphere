const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createInstrumenter } = require('istanbul-lib-instrument');
const root = path.resolve(__dirname, '../..');
const dataDir = path.join(root, '.coverage-data');
function eligible(file) {
  return file.startsWith(`${root}/src/`) && /\.tsx?$/.test(file) && !/\.(test\.[jt]sx?|d\.ts)$/.test(file);
}
function instrument(source, file) {
  const tool = createInstrumenter({ esModules: true, parserPlugins: ['typescript', 'jsx'],
    compact: false, produceSourceMap: true });
  const code = tool.instrumentSync(source, file);
  return { code, map: tool.lastSourceMap(), coverage: tool.lastFileCoverage() };
}
function sources(dir = path.join(root, 'src')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(file) : eligible(file) ? [file] : [];
  }).sort();
}
function digest(source) { return crypto.createHash('sha256').update(source).digest('hex'); }
function prepare() {
  fs.rmSync(path.join(root, 'coverage-combined'), { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dataDir, 'unit'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'browser'), { recursive: true });
  const baseline = {}, hashes = {};
  for (const file of sources()) {
    const source = fs.readFileSync(file, 'utf8');
    baseline[file] = instrument(source, file).coverage;
    hashes[file] = digest(source);
  }
  fs.writeFileSync(path.join(dataDir, 'baseline.json'), JSON.stringify(baseline));
  fs.writeFileSync(path.join(dataDir, 'sources.json'), JSON.stringify(hashes, null, 2));
}
module.exports = { root, dataDir, eligible, instrument, sources, digest, prepare };

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createInstrumenter } = require('istanbul-lib-instrument');
const root = path.resolve(__dirname, '../..');
const dataDir = path.join(root, '.coverage-data');
// Vite hands this hook forward-slash ids while path.join yields the platform separator,
// so compare on a normalised path or nothing is eligible on Windows.
const normalise = (file) => file.split(path.sep).join('/');
function eligible(file) {
  const id = normalise(file);
  return id.startsWith(`${normalise(root)}/src/`) && /\.tsx?$/.test(id) && !/\.(test\.[jt]sx?|d\.ts)$/.test(id);
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

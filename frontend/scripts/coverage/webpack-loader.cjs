const { instrument, normalise } = require('./instrument.cjs');
module.exports = function coverageLoader(source) {
  // resourcePath is platform-native; the baseline and the Vite-side snapshots are keyed by
  // POSIX paths, so normalise here or the two halves cannot be merged on Windows.
  const result = instrument(source, normalise(this.resourcePath));
  this.callback(null, result.code, result.map);
};

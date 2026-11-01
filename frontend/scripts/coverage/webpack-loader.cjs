const { instrument } = require('./instrument.cjs');
module.exports = function coverageLoader(source) {
  const result = instrument(source, this.resourcePath);
  this.callback(null, result.code, result.map);
};

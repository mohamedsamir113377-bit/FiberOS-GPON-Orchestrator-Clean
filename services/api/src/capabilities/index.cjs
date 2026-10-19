'use strict';
// Registry of the 11 capabilities formerly classified UNIMPLEMENTED.
const MODULES = {
  'architecture': require('./architecture.cjs'),
  'theory-guide': require('./theory-guide.cjs'),
  'ar-scanner': require('./ar-scanner.cjs'),
  'energy-analytics': require('./energy-analytics.cjs'),
  'cross-project': require('./cross-project.cjs'),
  'reputation-index': require('./reputation-index.cjs'),
  'business-weather': require('./business-weather.cjs'),
  'enterprise-tm': require('./enterprise-tm.cjs'),
  'constitution': require('./constitution.cjs'),
  'self-improve': require('./self-improve.cjs'),
  'load-test': require('./load-test.cjs'),
};
const IDS = Object.keys(MODULES).sort();
function get(id) { return Object.prototype.hasOwnProperty.call(MODULES, id) ? MODULES[id] : null; }
function describe() {
  return IDS.map((id) => ({ id, exported: Object.keys(MODULES[id]).filter((k) => typeof MODULES[id][k] === 'function').sort() }));
}
module.exports = { MODULES, IDS, get, describe };

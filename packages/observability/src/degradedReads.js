'use strict';

const { warn } = require('./logger');
// R4 fix (item 2 from the R3 review): dataDegraded was informational only —
// nothing counted it or raised attention when it happened, so a real DB
// problem could sit in the field unnoticed. This gives every enrichment
// read a shared counter and a single alert hook. It intentionally has no
// external dependency (no metrics backend, no webhook client) — wiring a
// specific observability vendor in is a deployment decision, not something
// to fabricate here. The default alert handler logs a WARN-level
// structured line; a real deployment can call setAlertHandler() once at
// startup to forward into whatever it actually uses (Datadog, Slack, etc).

const counts = new Map();
let alertHandler = defaultAlertHandler;

function defaultAlertHandler(event) {
  warn('degraded_read_alert', { severity: 'WARN', ...event });
}

function setAlertHandler(fn) {
  alertHandler = typeof fn === 'function' ? fn : defaultAlertHandler;
}

function recordDegraded(label, error) {
  const n = (counts.get(label) || 0) + 1;
  counts.set(label, n);
  alertHandler({ label, occurrences: n, error: String(error && error.message || error || '') });
  return n;
}

function getCount(label) {
  return counts.get(label) || 0;
}

function getAllCounts() {
  return Object.fromEntries(counts);
}

function resetForTest() {
  counts.clear();
  alertHandler = defaultAlertHandler;
}

module.exports = { recordDegraded, getCount, getAllCounts, setAlertHandler, resetForTest };

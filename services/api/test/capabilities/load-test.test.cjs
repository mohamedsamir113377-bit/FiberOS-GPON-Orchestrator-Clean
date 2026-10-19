'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { thresholdsFor, parseK6Summary, evaluate, PROFILES } = require('../../src/capabilities/load-test.cjs');

function summary(p95, p99, rate, vus) {
  return { metrics: {
    http_req_duration: { values: { 'p(95)': p95, 'p(99)': p99 } },
    http_req_failed: { values: { rate } },
    http_reqs: { values: { count: 1000 } },
    vus_max: { values: { value: vus } },
  }};
}
test('all four profiles exist with agreed thresholds', () => {
  assert.deepEqual(Object.keys(PROFILES).sort(), ['load', 'smoke', 'soak', 'stress']);
  assert.equal(thresholdsFor('load').p95, 500);
  assert.throws(() => thresholdsFor('nonsense'), TypeError);
});
test('a run inside the thresholds passes', () => {
  const r = evaluate('load', summary(220, 600, 0.001, 50));
  assert.equal(r.ok, true);
  assert.deepEqual(r.breaches, []);
});
test('a run breaching p95 or the error rate fails with the exact metric named', () => {
  const r = evaluate('smoke', summary(900, 3000, 0.05, 2));
  assert.equal(r.ok, false);
  assert.deepEqual(r.breaches.map((b) => b.metric), ['http_req_duration p(95)', 'http_req_duration p(99)', 'http_req_failed rate']);
  assert.equal(r.breaches[0].observed, 900);
});
test('malformed summaries are rejected rather than scored', () => {
  assert.throws(() => parseK6Summary({}), TypeError);
  assert.throws(() => parseK6Summary({ metrics: { http_req_duration: { values: {} }, http_req_failed: { values: {} } } }), TypeError);
});

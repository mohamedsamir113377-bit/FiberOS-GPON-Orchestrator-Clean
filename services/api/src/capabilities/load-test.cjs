'use strict';
const PROFILES = {
  smoke:  { vus: 2,   durationMs: 60000,      p95: 500,  p99: 1500, failedRate: 0.01 },
  load:   { vus: 50,  durationMs: 780000,     p95: 500,  p99: 1500, failedRate: 0.01 },
  stress: { vus: 400, durationMs: 840000,     p95: 900,  p99: 2500, failedRate: 0.02 },
  soak:   { vus: 50,  durationMs: 14700000,   p95: 600,  p99: 1800, failedRate: 0.01 },
};
function thresholdsFor(profile) {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, profile)) throw new TypeError('unknown profile: ' + profile + ' (expected ' + Object.keys(PROFILES).join('|') + ')');
  return { ...PROFILES[profile] };
}
// Reads a k6 --summary-export JSON document.
function parseK6Summary(summary) {
  if (!summary || typeof summary !== 'object' || !summary.metrics) throw new TypeError('not a k6 summary document');
  const dur = summary.metrics.http_req_duration;
  const failed = summary.metrics.http_req_failed;
  if (!dur || !dur.values || !failed || !failed.values) throw new TypeError('summary is missing http_req_duration / http_req_failed');
  const p95 = dur.values['p(95)'];
  const p99 = dur.values['p(99)'];
  const failedRate = failed.values.rate;
  if (![p95, p99, failedRate].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new TypeError('summary percentiles are not finite numbers');
  return { p95, p99, failedRate, requests: (summary.metrics.http_reqs && summary.metrics.http_reqs.values && summary.metrics.http_reqs.values.count) || null,
    vusMax: (summary.metrics.vus_max && summary.metrics.vus_max.values && summary.metrics.vus_max.values.value) || null };
}
function evaluate(profile, summary) {
  const t = thresholdsFor(profile);
  const m = parseK6Summary(summary);
  const breaches = [];
  if (m.p95 > t.p95) breaches.push({ metric: 'http_req_duration p(95)', observed: m.p95, limit: t.p95 });
  if (m.p99 > t.p99) breaches.push({ metric: 'http_req_duration p(99)', observed: m.p99, limit: t.p99 });
  if (m.failedRate > t.failedRate) breaches.push({ metric: 'http_req_failed rate', observed: m.failedRate, limit: t.failedRate });
  if (m.vusMax !== null && m.vusMax > t.vus) breaches.push({ metric: 'vus_max', observed: m.vusMax, limit: t.vus });
  return { profile, ok: breaches.length === 0, breaches, observed: m, thresholds: t };
}
module.exports = { PROFILES, thresholdsFor, parseK6Summary, evaluate };

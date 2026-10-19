// k6 run -e BASE_URL=https://staging.example.com -e PROFILE=load -e PATHS=/a,/b load/k6-load.js
// PROFILE: smoke | load | stress | soak. Run against STAGING, never production.
// AUTH_TOKEN optional (env only, never commit).
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('BASE_URL required');
const PATHS = (__ENV.PATHS || '/').split(',');
const headers = __ENV.AUTH_TOKEN ? { Authorization: `Bearer ${__ENV.AUTH_TOKEN}` } : {};

const profiles = {
  smoke:  { vus: 2, duration: '1m' },
  load:   { stages: [{ duration: '2m', target: 50 }, { duration: '10m', target: 50 }, { duration: '1m', target: 0 }] },
  stress: { stages: [{ duration: '2m', target: 100 }, { duration: '5m', target: 200 }, { duration: '5m', target: 400 }, { duration: '2m', target: 0 }] },
  soak:   { stages: [{ duration: '5m', target: 50 }, { duration: '4h', target: 50 }, { duration: '5m', target: 0 }] },
};

export const options = {
  ...profiles[__ENV.PROFILE || 'smoke'],
  // PROPOSED thresholds: agree them with the buyer before calling this a pass.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const p = PATHS[Math.floor(Math.random() * PATHS.length)];
  const r = http.get(`${BASE}${p}`, { headers, tags: { path: p } });
  check(r, { 'status 2xx': (x) => x.status >= 200 && x.status < 300 });
  sleep(1);
}

export function handleSummary(data) {
  return { [`load/results-${__ENV.PROFILE || 'smoke'}.json`]: JSON.stringify(data, null, 2) };
}

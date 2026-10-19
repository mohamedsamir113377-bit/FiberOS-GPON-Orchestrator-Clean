'use strict';

/**
 * Fleet routing and first-time-right (zero re-visit) planning.
 * Concept source (public): operations-management / supply-chain optimisation
 * literature (sequencing, capacity, service level, routing). Deterministic.
 */

function assertPoint(p, name) {
  if (!Array.isArray(p) || p.length !== 2) throw new Error('ROUTE_' + name + '_POINT_INVALID');
  const la = Number(p[0]), lo = Number(p[1]);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
    throw new Error('ROUTE_' + name + '_POINT_INVALID');
  }
  return [la, lo];
}
function haversineKm(a, b) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
const unit = (x, n) => {
  const v = Number(x);
  if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error('ROUTE_' + n + '_RANGE_INVALID');
  return v;
};

function firstTimeRightScore({ skillMatch, partsOnTruck, accessConfirmed, timeWindowFit, historicalSuccessRate }) {
  const w = { skill: 0.30, parts: 0.25, access: 0.20, window: 0.15, history: 0.10 };
  const score =
    w.skill * unit(skillMatch, 'skillMatch') +
    w.parts * unit(partsOnTruck, 'partsOnTruck') +
    w.access * unit(accessConfirmed, 'accessConfirmed') +
    w.window * unit(timeWindowFit, 'timeWindowFit') +
    w.history * unit(historicalSuccessRate, 'historicalSuccessRate');
  const band = score >= 0.85 ? 'ZERO_REVISIT_LIKELY' : score >= 0.6 ? 'MONITOR' : 'REVISIT_RISK';
  return Object.freeze({ score: Number(score.toFixed(6)), band, weights: Object.freeze(w) });
}

function feasibleVisit(visit, state) {
  const required = Array.isArray(visit.requiredSkills) ? visit.requiredSkills : [];
  const have = new Set(state.skills || []);
  const missingSkills = required.filter((s) => !have.has(s));
  const neededParts = Array.isArray(visit.parts) ? visit.parts : [];
  const inv = state.inventory || {};
  const missingParts = neededParts.filter((p) => (Number(inv[p]) || 0) <= 0);
  let windowOk = true;
  if (Array.isArray(visit.window) && visit.window.length === 2) {
    const ws = Number(visit.window[0]), we = Number(visit.window[1]);
    const eta = Number(state.etaMinutes);
    if (Number.isFinite(ws) && Number.isFinite(we) && Number.isFinite(eta)) windowOk = eta >= ws && eta <= we;
  }
  const feasible = missingSkills.length === 0 && missingParts.length === 0 && windowOk;
  return Object.freeze({
    feasible,
    missingSkills: Object.freeze(missingSkills),
    missingParts: Object.freeze(missingParts),
    windowOk
  });
}

function optimizeRoute({ depot, stops, maxStopsPerDay = 12 }) {
  const d = assertPoint(depot, 'DEPOT');
  const n = Math.trunc(maxStopsPerDay);
  if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error('ROUTE_MAX_STOPS_INVALID');
  const list = (stops || []).map((s, i) => ({
    id: s.id == null ? 'S' + i : String(s.id),
    point: assertPoint(s.point, 'STOP'),
    priority: Number(s.priority || 0)
  }));
  const remaining = list.slice();
  const order = [];
  let cur = d;
  while (remaining.length && order.length < n) {
    let best = -1, bestCost = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cost = haversineKm(cur, remaining[i].point) - remaining[i].priority * 0.5;
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    const chosen = remaining.splice(best, 1)[0];
    order.push(chosen);
    cur = chosen.point;
  }
  const seq = [d, ...order.map((o) => o.point), d];
  const total = (arr) => arr.slice(1).reduce((s, p, i) => s + haversineKm(arr[i], p), 0);
  let improved = true, guard = 0;
  while (improved && guard < 500) {
    improved = false; guard += 1;
    for (let i = 1; i < seq.length - 2; i++) {
      for (let j = i + 1; j < seq.length - 1; j++) {
        const cand = seq.slice(0, i).concat(seq.slice(i, j + 1).reverse(), seq.slice(j + 1));
        if (total(cand) + 1e-9 < total(seq)) { for (let k = 0; k < seq.length; k++) seq[k] = cand[k]; improved = true; }
      }
    }
  }
  return Object.freeze({
    stopOrder: Object.freeze(order.map((o) => o.id)),
    totalDistanceKm: Number(total(seq).toFixed(6)),
    unassigned: Object.freeze(remaining.map((o) => o.id))
  });
}

function zeroRevisitPlan({ visits, state }) {
  const planned = [], deferred = [];
  for (const v of visits || []) {
    const f = feasibleVisit(v, state);
    (f.feasible ? planned : deferred).push(Object.freeze({ id: v.id, ...f }));
  }
  return Object.freeze({ planned: Object.freeze(planned), deferred: Object.freeze(deferred), zeroRevisitReady: deferred.length === 0 });
}

module.exports = { haversineKm, firstTimeRightScore, feasibleVisit, optimizeRoute, zeroRevisitPlan };

'use strict';
// Cumulative meter readings in kWh. Deltas are derived; a decreasing counter is a meter reset, not a negative use.
function computeConsumption(readings, opts) {
  if (!Array.isArray(readings)) throw new TypeError('readings must be an array');
  const options = opts || {};
  let allowReset = options.allowReset !== false;
  const points = readings.map((r, i) => {
    if (!r || typeof r.kwh !== 'number' || !Number.isFinite(r.kwh)) throw new TypeError('reading #' + i + ' needs a finite numeric kwh');
    const ts = typeof r.ts === 'string' ? Date.parse(r.ts) : NaN;
    if (Number.isNaN(ts)) throw new TypeError('reading #' + i + ' needs an ISO-8601 ts');
    return { ts, kwh: r.kwh };
  }).sort((a, b) => a.ts - b.ts);
  const intervals = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].kwh - points[i - 1].kwh;
    if (delta < 0) {
      if (!allowReset) { intervals.push({ from: points[i - 1].ts, to: points[i].ts, kwh: null, kind: 'meter-reset' }); continue; }
      intervals.push({ from: points[i - 1].ts, to: points[i].ts, kwh: points[i].kwh, kind: 'meter-reset' });
      total += points[i].kwh;
      continue;
    }
    intervals.push({ from: points[i - 1].ts, to: points[i].ts, kwh: delta, kind: 'normal' });
    total += delta;
  }
  return { points: points.length, intervals, totalKwh: Number(total.toFixed(6)) };
}
// Missing-data handling: report gaps instead of silently inventing values.
function detectGaps(readings, expectedIntervalMs, toleranceFactor) {
  if (!(expectedIntervalMs > 0)) throw new TypeError('expectedIntervalMs must be > 0');
  const tol = typeof toleranceFactor === 'number' ? toleranceFactor : 1.5;
  const ts = readings.map((r) => Date.parse(r.ts)).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < ts.length; i++) {
    const span = ts[i] - ts[i - 1];
    if (span > expectedIntervalMs * tol) {
      gaps.push({ from: new Date(ts[i - 1]).toISOString(), to: new Date(ts[i]).toISOString(), missingIntervals: Math.round(span / expectedIntervalMs) - 1 });
    }
  }
  return { gaps, gapCount: gaps.length, complete: gaps.length === 0 };
}
function interpolateGaps(readings, expectedIntervalMs, maxGapMs) {
  const t = readings.map((r) => ({ ts: Date.parse(r.ts), kwh: r.kwh })).sort((a, b) => a.ts - b.ts);
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (i === 0) { out.push({ ...t[i], interpolated: false }); continue; }
    const span = t[i].ts - t[i - 1].ts;
    if (span > expectedIntervalMs * 1.5 && span <= maxGapMs) {
      const steps = Math.round(span / expectedIntervalMs);
      for (let s = 1; s < steps; s++) {
        const frac = s / steps;
        out.push({ ts: t[i - 1].ts + Math.round(span * frac), kwh: t[i - 1].kwh + (t[i].kwh - t[i - 1].kwh) * frac, interpolated: true });
      }
    }
    out.push({ ...t[i], interpolated: false });
  }
  return out;
}
function comparePeriods(previousKwh, currentKwh) {
  if (!Number.isFinite(previousKwh) || !Number.isFinite(currentKwh)) throw new TypeError('both periods must be finite numbers');
  const absolute = currentKwh - previousKwh;
  if (previousKwh === 0) return { previousKwh, currentKwh, absoluteKwh: absolute, percentChange: null, note: 'percent change undefined when base period is zero' };
  return { previousKwh, currentKwh, absoluteKwh: absolute, percentChange: Number(((absolute / previousKwh) * 100).toFixed(4)), note: null };
}
module.exports = { computeConsumption, detectGaps, interpolateGaps, comparePeriods };

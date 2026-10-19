/**
 * Reality Gate — pure Haversine distance check (pre-check + server reuse).
 * Authorization / ticket close still requires server policy + RLS.
 */
'use strict';
const { haversineMeters, isWithinGeofence } = require('./geo');


const EARTH_M = 6371000;

function toRad(d) { return (Number(d) * Math.PI) / 180; }

function distanceMeters(a, b) {
  const lat1 = Number(a && a.lat);
  const lon1 = Number(a && (a.lng != null ? a.lng : a.lon));
  const lat2 = Number(b && b.lat);
  const lon2 = Number(b && (b.lng != null ? b.lng : b.lon));
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
    return { ok: false, reason: 'INVALID_COORDINATES', meters: null };
  }
  if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90 ||
      lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180) {
    return { ok: false, reason: 'COORDINATES_OUT_OF_RANGE', meters: null };
  }
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return { ok: true, meters: EARTH_M * c, reason: null };
}

function evaluate(jobPoint, techPoint, maxMeters) {
  maxMeters = Number(maxMeters);
  if (!Number.isFinite(maxMeters) || maxMeters <= 0) maxMeters = 50;
  const d = distanceMeters(jobPoint, techPoint);
  if (!d.ok) {
    return {
      passed: false,
      errorCode: d.reason,
      distanceMeters: null,
      maxMeters: maxMeters,
      authority: 'PURE_FUNCTION'
    };
  }
  const passed = d.meters <= maxMeters;
  return {
    passed: passed,
    distanceMeters: Number(d.meters.toFixed(2)),
    maxMeters: maxMeters,
    errorCode: passed ? null : 'GEO_OUT_OF_RANGE',
    authority: 'PURE_FUNCTION'
  };
}

/** Alias used by API routes */
function check(a, b, maxMeters) {
  return evaluate(a, b, maxMeters);
}

module.exports = {
  EARTH_M,
  distanceMeters,
  evaluate,
  check
};

if (typeof window !== 'undefined') {
  window.FiberOSDomain = window.FiberOSDomain || {};
  window.FiberOSDomain.RealityGate = module.exports;
}

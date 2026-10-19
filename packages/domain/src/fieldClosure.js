/**
 * Field ticket closure policy — pure validation, no I/O.
 * Maps to server endpoint POST /v1/tickets/close-field
 */
'use strict';

const { canTransition, normalizeStatus } = require('./ticketStateMachine');
const { evaluate: realityEvaluate } = require('./realityGate');
const {
  isValidSource,
  isAuthoritativeFieldOrNms,
  canCloseWithSources
} = require('./opticalSource');

/** Rx operational window (dBm) — configurable via options */
const DEFAULT_RX_MIN = -28;
const DEFAULT_RX_MAX = -8;

/**
 * Default freshness ceiling applied when the caller doesn't specify one.
 * The caller (the API route) is expected to always pass a value derived
 * from server config — never from the request body — but a safe default
 * exists here too so this pure function is never accidentally permissive
 * on its own.
 */
const DEFAULT_PHOTO_MAX_AGE_SECONDS = 900; // 15 minutes

function validatePhoto(photo, opts) {
  opts = opts || {};
  if (!photo || typeof photo !== 'object') {
    return { ok: false, reason: 'PHOTO_REQUIRED' };
  }
  if (!photo.contentHash && !photo.storageRef && !photo.base64Length) {
    return { ok: false, reason: 'PHOTO_HASH_OR_REF_REQUIRED' };
  }
  if (photo.tamperSuspect === true) {
    return { ok: false, reason: 'PHOTO_TAMPER_SUSPECT' };
  }

  /*
   * SECURITY FIX: freshness used to be judged from `photo.ageSeconds` /
   * `photo.maxAgeSeconds`, both of which arrived from the client — so a
   * caller could simply assert "ageSeconds: 10" with no way for the server
   * to know that was true, and the check was skipped entirely if either
   * field was omitted.
   *
   * Now: the caller (route layer) must compute `serverComputedAgeSeconds`
   * itself, from its own clock against a `photo.capturedAt` timestamp, and
   * pass it in via `opts`. `maxAgeSeconds` always comes from server config
   * (via `opts`), never from the request body, and is always enforced
   * (falls back to DEFAULT_PHOTO_MAX_AGE_SECONDS rather than being skipped).
   *
   * This still does not prove the photo is authentic (a client can lie
   * about `capturedAt` itself) — it only removes the part of the trust gap
   * that let the client control both the measurement AND the yardstick.
   * Real provenance requires EXIF/device-attestation work that is not part
   * of this fix (see docs/adr/002-optical-source-mandatory.md follow-up).
   */
  const maxAgeSeconds = opts.maxAgeSeconds != null ? Number(opts.maxAgeSeconds) : DEFAULT_PHOTO_MAX_AGE_SECONDS;
  const ageSeconds = opts.serverComputedAgeSeconds;
  if (ageSeconds == null || !Number.isFinite(Number(ageSeconds))) {
    return { ok: false, reason: 'PHOTO_CAPTURE_TIME_REQUIRED' };
  }
  if (Number(ageSeconds) < 0) {
    return { ok: false, reason: 'PHOTO_CAPTURE_TIME_IN_FUTURE', ageSeconds: Number(ageSeconds) };
  }
  if (Number(ageSeconds) > maxAgeSeconds) {
    return { ok: false, reason: 'PHOTO_STALE', ageSeconds: Number(ageSeconds), maxAgeSeconds: maxAgeSeconds };
  }
  return { ok: true, ageSeconds: Number(ageSeconds), maxAgeSeconds: maxAgeSeconds };
}

function validateGps(jobGps, deviceGps, maxMeters) {
  if (!jobGps || !deviceGps) {
    return { ok: false, reason: 'GPS_POINTS_REQUIRED' };
  }
  return realityEvaluate(jobGps, deviceGps, maxMeters);
}

function validateRx(rxDbm, opts) {
  opts = opts || {};
  const min = opts.rxMin != null ? Number(opts.rxMin) : DEFAULT_RX_MIN;
  const max = opts.rxMax != null ? Number(opts.rxMax) : DEFAULT_RX_MAX;
  const rx = Number(rxDbm);
  if (!Number.isFinite(rx)) {
    return { ok: false, reason: 'RX_REQUIRED' };
  }
  if (rx < min || rx > max) {
    return { ok: false, reason: 'RX_OUT_OF_BAND', rxDbm: rx, min: min, max: max };
  }
  return { ok: true, rxDbm: rx, min: min, max: max };
}

/**
 * @param {object} input
 * @param {string} input.fromStatus  REQUIRED. Callers must supply the
 *   authoritative current status (the DB-locked value on the persisted
 *   path). This function no longer defaults a missing fromStatus to
 *   'in_progress' — that silent assumption was itself a trust-boundary gap.
 * @param {object} input.jobGps {lat,lng}
 * @param {object} input.deviceGps {lat,lng}
 * @param {object} input.photo
 * @param {number} [input.photoMaxAgeSeconds]  server-config value, not client-supplied
 * @param {number} [input.photoServerComputedAgeSeconds]  computed by the route from its own clock
 * @param {number} input.rxDbm
 * @param {string[]} input.opticalSources  field_reading|nms_poll|ai_simulated
 * @param {number} [input.maxMeters]  server-config value, not client-supplied
 * @param {object} [input.policy]
 */
function validateFieldClose(input) {
  input = input || {};
  const errors = [];

  if (!input.fromStatus) {
    errors.push({ code: 'FROM_STATUS_REQUIRED' });
  }
  const from = normalizeStatus(input.fromStatus || '');

  /* Must be able to move toward awaiting_evidence or manager_review — not direct completed unless policy allows manager path */
  const target = normalizeStatus(input.toStatus || 'awaiting_evidence');
  const edge = from ? canTransition(from, target) : { ok: false, reason: 'FROM_STATUS_REQUIRED', from: from, to: target };
  if (!edge.ok) {
    errors.push({ code: edge.reason, from: edge.from, to: edge.to, allowed: edge.allowed });
  }

  const geo = validateGps(input.jobGps, input.deviceGps, input.maxMeters || 50);
  if (!geo.passed) {
    errors.push({
      code: geo.errorCode || 'REALITY_GATE_FAILED',
      distanceMeters: geo.distanceMeters,
      maxMeters: geo.maxMeters
    });
  }

  const photo = validatePhoto(input.photo, {
    maxAgeSeconds: input.photoMaxAgeSeconds,
    serverComputedAgeSeconds: input.photoServerComputedAgeSeconds
  });
  if (!photo.ok) errors.push({ code: photo.reason, detail: photo });

  const rx = validateRx(input.rxDbm, input.policy);
  if (!rx.ok) errors.push({ code: rx.reason, detail: rx });

  let sources = input.opticalSources || [];
  if (!sources.length && input.opticalSource) sources = [input.opticalSource];
  sources = sources.map(String);

  for (const s of sources) {
    if (!isValidSource(s)) errors.push({ code: 'INVALID_OPTICAL_SOURCE', source: s });
  }
  const srcPol = canCloseWithSources(sources, {
    requireFieldOrNms: input.policy && input.policy.requireFieldOrNms !== false
  });
  if (!srcPol.ok) errors.push({ code: srcPol.reason, sources: sources });

  /* Reject close if only simulated */
  if (sources.length && sources.every(function (s) { return s === 'ai_simulated'; })) {
    errors.push({ code: 'SIMULATED_ONLY_NOT_ALLOWED_FOR_FIELD_CLOSE' });
  }

  return {
    ok: errors.length === 0,
    errors: errors,
    normalized: {
      fromStatus: from,
      toStatus: target,
      geo: geo,
      rx: rx.ok ? rx : null,
      opticalSources: sources,
      photoOk: photo.ok,
      photoAgeSeconds: photo.ageSeconds != null ? photo.ageSeconds : null
    }
  };
}

module.exports = {
  DEFAULT_RX_MIN,
  DEFAULT_RX_MAX,
  DEFAULT_PHOTO_MAX_AGE_SECONDS,
  validatePhoto,
  validateGps,
  validateRx,
  validateFieldClose
};

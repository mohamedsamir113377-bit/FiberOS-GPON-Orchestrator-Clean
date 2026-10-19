/**
 * Optical measurement source — aligned with DB CHECK constraint.
 */
'use strict';

const SOURCES = Object.freeze(['field_reading', 'nms_poll', 'ai_simulated']);

function isValidSource(s) {
  return SOURCES.indexOf(String(s || '')) !== -1;
}

function isAuthoritativeFieldOrNms(s) {
  return s === 'field_reading' || s === 'nms_poll';
}

function canCloseWithSources(sources, policy) {
  policy = policy || { requireFieldOrNms: true };
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return { ok: false, reason: 'NO_OPTICAL_EVIDENCE' };
  if (policy.requireFieldOrNms) {
    const ok = list.some(isAuthoritativeFieldOrNms);
    return ok
      ? { ok: true }
      : { ok: false, reason: 'ONLY_SIMULATED_OPTICAL', sources: list.slice() };
  }
  return { ok: true };
}

module.exports = { SOURCES, isValidSource, isAuthoritativeFieldOrNms, canCloseWithSources };

if (typeof window !== 'undefined') {
  window.FiberOSDomain = window.FiberOSDomain || {};
  window.FiberOSDomain.OpticalSource = {
    SOURCES, isValidSource, isAuthoritativeFieldOrNms, canCloseWithSources
  };
}

'use strict';

/**
 * The one adapter that ALWAYS works, for every vendor, forever: the
 * technician types the number they read off the meter's screen. Priority is
 * deliberately last (highest number) so any automated source is preferred
 * when one is actually available, but this is never removed and never fails.
 */
const manualEntryAdapter = {
  sourceId: 'MANUAL_ENTRY',
  priority: 100,

  canHandle(rawInput) {
    return rawInput && rawInput.inputType === 'manual' && typeof rawInput.rxPowerDbm === 'number';
  },

  extract(rawInput) {
    return {
      rxPowerDbm: rawInput.rxPowerDbm,
      confidenceTier: 'UNVERIFIED',
      sourceMeta: { enteredBy: rawInput.technicianId || null },
    };
  },
};

module.exports = { manualEntryAdapter };

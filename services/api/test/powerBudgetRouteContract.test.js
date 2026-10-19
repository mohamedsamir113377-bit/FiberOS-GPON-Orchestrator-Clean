'use strict';

/**
 * Contract tests for POST /v1/optics/power-budget engine path (P0-2/P0-3).
 * Exercises the same engines the route uses — no live HTTP, no invented DB.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOdnPowerBudget } = require('../../../packages/engineering/src/odnPowerBudget');
const { powerBudget } = require('../../../packages/domain/src/ftthRates');
const { requireVerifiedPrincipal } = require('../src/requireAuth');

/** Mirror of server decision mapping for power-budget responses. */
function mapPowerBudgetResponse(body = {}) {
  if (body.legacySimple === true) {
    const simple = powerBudget(body);
    return {
      statusCode: 200,
      payload: {
        ok: true,
        result: simple,
        engine: 'domain/ftthRates.powerBudget',
        engineVersion: 'legacy-simple',
        calculatedNotMeasured: true,
        authority: 'CALCULATED_NOT_MEASURED',
        decision: 'ADVISORY_ONLY'
      }
    };
  }
  const odn = evaluateOdnPowerBudget(body);
  const statusCode = odn.rejected || odn.blocked ? 422 : 200;
  return {
    statusCode,
    payload: {
      ok: odn.accepted === true,
      result: odn,
      engine: 'engineering/odnPowerBudget.evaluateOdnPowerBudget',
      engineVersion: odn.engineVersion,
      calculatedNotMeasured: true,
      authority: 'CALCULATED_NOT_MEASURED'
    }
  };
}

test('primary engine is odnPowerBudget not ftthRates', () => {
  const res = mapPowerBudgetResponse({
    odnClass: 'C',
    lengthKm: 20,
    fiberAttenuationDbPerKm: 0.4,
    splices: 15,
    spliceLossDb: 0.1,
    connectors: 4,
    connectorLossDb: 0.35,
    splitterLossDb: 17.1,
    designMarginDb: 1,
    maintenanceMarginDb: 1,
    availableBudgetDb: 30
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.match(res.payload.engine, /odnPowerBudget/);
  assert.equal(res.payload.result.status, 'ACCEPTED');
  assert.equal(res.payload.calculatedNotMeasured, true);
});

test('under-min without attenuator returns 422 and not ok', () => {
  const res = mapPowerBudgetResponse({
    odnClass: 'B+',
    lengthKm: 1,
    fiberAttenuationDbPerKm: 0.2,
    splices: 0,
    connectors: 0,
    splitterLossDb: 0,
    designMarginDb: 0,
    maintenanceMarginDb: 0
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.result.blocked, true);
  assert.equal(res.payload.result.status, 'BLOCKED_UNDER_CLASS_MIN');
  assert.equal(res.payload.result.accepted, false);
});

test('under-min with attenuator evidence returns 200 accepted', () => {
  const res = mapPowerBudgetResponse({
    odnClass: 'B+',
    lengthKm: 1,
    fiberAttenuationDbPerKm: 0.2,
    splices: 0,
    connectors: 0,
    splitterLossDb: 0,
    designMarginDb: 0,
    maintenanceMarginDb: 0,
    attenuatorDocumented: true
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.result.status, 'ACCEPTED_WITH_ATTENUATOR');
});

test('over-budget returns 422 rejected', () => {
  const res = mapPowerBudgetResponse({
    odnClass: 'B+',
    lengthKm: 20,
    fiberAttenuationDbPerKm: 0.4,
    splices: 15,
    spliceLossDb: 0.1,
    connectors: 4,
    connectorLossDb: 0.35,
    splitterLossDb: 17.1,
    designMarginDb: 1,
    maintenanceMarginDb: 1
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.result.rejected, true);
  assert.equal(res.payload.result.status, 'REJECTED_OVER_BUDGET');
});

test('legacySimple uses domain helper and is advisory only', () => {
  const res = mapPowerBudgetResponse({
    legacySimple: true,
    lengthKm: 5,
    wavelength: 1490,
    splitter: '1:32',
    splices: 2,
    connectors: 2
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.decision, 'ADVISORY_ONLY');
  assert.match(res.payload.engine, /ftthRates/);
  assert.equal(res.payload.result.note, 'CALCULATED_NOT_MEASURED');
});

test('legacySimple rejects unsupported wavelength (no silent 1490 fallback)', () => {
  assert.throws(
    () => mapPowerBudgetResponse({ legacySimple: true, lengthKm: 1, wavelength: 9999 }),
    /FTTH_WAVELENGTH_UNSUPPORTED/
  );
});

test('unauthenticated principal is rejected by requireVerifiedPrincipal', () => {
  const out = requireVerifiedPrincipal({ authenticated: false }, {});
  assert.equal(out.ok, false);
  assert.ok(out.status >= 401);
});

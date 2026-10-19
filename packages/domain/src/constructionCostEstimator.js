'use strict';

/**
 * Pure CapEx-style construction cost estimator.
 * Truth boundary:
 * - Uses only caller-supplied quantities and unit rates.
 * - Re-uses optical budget from ftthRates (CALCULATED_NOT_MEASURED).
 * - Never invents material prices or market rates.
 * - No invoice generation, no automatic billing.
 */

const { powerBudget } = require('./ftthRates');

/**
 * @param {object} input
 * @param {number} input.lengthKm
 * @param {number} [input.splices]
 * @param {number} [input.connectors]
 * @param {string[]} [input.splitters]   e.g. ['1:8','1:16']
 * @param {object} input.unitRates      buyer-supplied { perKm, perSplice, perConnector, perSplitterType: { '1:8': n, ... }, other }
 * @param {object} [input.optical]      passed to powerBudget
 * @returns {object} frozen cost breakdown + optical budget
 */
function estimateConstructionCost(input) {
  input = input || {};
  const rates = input.unitRates || {};
  if (typeof rates !== 'object') throw new TypeError('UNIT_RATES_REQUIRED');

  const lengthKm = Number(input.lengthKm || 0);
  const splices = Number(input.splices || 0);
  const connectors = Number(input.connectors || 0);
  const splitters = Array.isArray(input.splitters) ? input.splitters.map(String) : [];

  if (![lengthKm, splices, connectors].every(n => Number.isFinite(n) && n >= 0)) {
    throw new RangeError('QUANTITIES_MUST_BE_NON_NEGATIVE_FINITE');
  }

  const costKm = lengthKm * Number(rates.perKm || 0);
  const costSplices = splices * Number(rates.perSplice || 0);
  const costConnectors = connectors * Number(rates.perConnector || 0);

  let costSplitters = 0;
  const splitterDetail = {};
  const perType = rates.perSplitterType || {};
  splitters.forEach(s => {
    const unit = Number(perType[s] || 0);
    costSplitters += unit;
    splitterDetail[s] = (splitterDetail[s] || 0) + unit;
  });

  const other = Number(rates.other || 0);
  const total = costKm + costSplices + costConnectors + costSplitters + other;

  const optical = powerBudget({
    lengthKm,
    splices,
    connectors,
    splitters,
    ...(input.optical || {})
  });

  return Object.freeze({
    quantities: Object.freeze({ lengthKm, splices, connectors, splitters: splitters.slice() }),
    costs: Object.freeze({
      fiberKm: Number(costKm.toFixed(2)),
      splices: Number(costSplices.toFixed(2)),
      connectors: Number(costConnectors.toFixed(2)),
      splitters: Number(costSplitters.toFixed(2)),
      splitterDetail: Object.freeze({ ...splitterDetail }),
      other: Number(other.toFixed(2)),
      total: Number(total.toFixed(2))
    }),
    opticalBudget: optical,
    currency: rates.currency || null,
    note: 'ESTIMATE_FROM_SUPPLIED_RATES_AND_QUANTITIES_ONLY',
    advisory: true
  });
}

module.exports = { estimateConstructionCost };

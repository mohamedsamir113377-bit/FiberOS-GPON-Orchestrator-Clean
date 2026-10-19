'use strict';

/**
 * Link Budget vs Measured Comparison (Feature C)
 *
 * Truth boundary:
 * - Calculated side comes from ftthRates.powerBudget (CALCULATED_NOT_MEASURED).
 * - Measured side must be supplied by caller (OTDR resolver or manual entry).
 * - Returns margin and reason codes only. No pass/fail certification claim.
 */

const { powerBudget } = require('./ftthRates');

/**
 * @param {object} input
 * @param {object} input.design          passed to powerBudget
 * @param {number} [input.measuredRxDbm]
 * @param {number} [input.measuredTotalLossDb]
 * @param {number} [input.marginThresholdDb]  default 3
 */
function compareLinkBudget(input) {
  input = input || {};
  const calculated = powerBudget(input.design || {});
  const threshold = Number(input.marginThresholdDb);
  const marginThresholdDb = Number.isFinite(threshold) && threshold >= 0 ? threshold : 3;

  const measuredRx = input.measuredRxDbm != null ? Number(input.measuredRxDbm) : null;
  const measuredLoss = input.measuredTotalLossDb != null ? Number(input.measuredTotalLossDb) : null;

  const reasons = [];
  let marginDb = null;
  let comparisonBasis = null;

  if (Number.isFinite(measuredRx)) {
    marginDb = Number((measuredRx - calculated.rxDbm).toFixed(3));
    comparisonBasis = 'RX_DBM';
    if (marginDb < -marginThresholdDb) reasons.push('MEASURED_RX_BELOW_CALCULATED_MARGIN');
    else if (marginDb < 0) reasons.push('MEASURED_RX_SLIGHTLY_BELOW_CALCULATED');
    else reasons.push('MEASURED_RX_WITHIN_OR_ABOVE_CALCULATED');
  } else if (Number.isFinite(measuredLoss)) {
    marginDb = Number((calculated.totalLossDb - measuredLoss).toFixed(3));
    comparisonBasis = 'TOTAL_LOSS_DB';
    if (marginDb < -marginThresholdDb) reasons.push('MEASURED_LOSS_ABOVE_CALCULATED_MARGIN');
    else if (marginDb < 0) reasons.push('MEASURED_LOSS_SLIGHTLY_ABOVE_CALCULATED');
    else reasons.push('MEASURED_LOSS_WITHIN_OR_BELOW_CALCULATED');
  } else {
    reasons.push('NO_MEASURED_VALUE_SUPPLIED');
  }

  return Object.freeze({
    calculated,
    measured: Object.freeze({
      rxDbm: Number.isFinite(measuredRx) ? measuredRx : null,
      totalLossDb: Number.isFinite(measuredLoss) ? measuredLoss : null
    }),
    marginDb,
    marginThresholdDb,
    comparisonBasis,
    reasons: Object.freeze(reasons.slice()),
    note: 'COMPARISON_ONLY_CALCULATED_SIDE_IS_NOT_A_FIELD_MEASUREMENT'
  });
}

module.exports = { compareLinkBudget };

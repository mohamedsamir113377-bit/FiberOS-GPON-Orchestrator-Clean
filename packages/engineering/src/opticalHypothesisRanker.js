'use strict';

/**
 * Advisory optical hypothesis ranking (HV-style extension of bayesianDiagnosis).
 * Truth boundary:
 * - Pure function. Requires explicit hypotheses + priors + likelihoods.
 * - Does NOT pull live measurements, does NOT create work orders.
 * - Output is ranking + entropy only. Human confirmation required for any action.
 */

const { posterior, gaussianInformationFusion } = require('./bayesianDiagnosis');

const DEFAULT_HYPOTHESES = Object.freeze([
  'SHARP_BEND',
  'MOISTURE_INGRESS',
  'CONNECTOR_DEGRADATION',
  'NATURAL_AGING',
  'UNKNOWN'
]);

/**
 * Rank optical-fault hypotheses given calibrated likelihoods.
 * @param {object} input
 * @param {string[]} [input.hypotheses]
 * @param {number[]} input.priors          must sum conceptually to 1 (normalized internally)
 * @param {Array<{likelihoods: number[]}>} input.evidenceLikelihoods
 * @returns {object} frozen posterior ranking + entropy
 */
function rankOpticalHypotheses(input) {
  input = input || {};
  const hypotheses = Array.isArray(input.hypotheses) && input.hypotheses.length
    ? input.hypotheses.map(String)
    : DEFAULT_HYPOTHESES.slice();

  if (!Array.isArray(input.priors) || input.priors.length !== hypotheses.length) {
    throw new TypeError('PRIORS_MISMATCH');
  }
  if (!Array.isArray(input.evidenceLikelihoods)) {
    throw new TypeError('EVIDENCE_LIKELIHOODS_REQUIRED');
  }

  const result = posterior({
    hypotheses,
    priors: input.priors,
    evidenceLikelihoods: input.evidenceLikelihoods
  });

  return Object.freeze({
    ...result,
    advisory: true,
    note: 'ADVISORY_RANKING_ONLY_NO_AUTO_ACTION'
  });
}

/**
 * Fuse independent optical-loss observations into a mean/variance estimate.
 * Caller supplies already-recorded measurements.
 */
function fuseOpticalLossObservations(observations) {
  if (!Array.isArray(observations) || !observations.length) {
    throw new TypeError('OBSERVATIONS_REQUIRED');
  }
  return gaussianInformationFusion(observations);
}

module.exports = {
  DEFAULT_HYPOTHESES,
  rankOpticalHypotheses,
  fuseOpticalLossObservations
};

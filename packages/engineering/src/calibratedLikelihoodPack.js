'use strict';

/**
 * Calibrated Likelihood Pack (Feature B)
 *
 * Truth boundary:
 * - Packs are data, not hard-coded physics inside the math engine.
 * - Buyer / engineering authority supplies and versions the pack.
 * - Engine remains generic (bayesianDiagnosis.posterior).
 */

const { rankOpticalHypotheses } = require('./opticalHypothesisRanker');

/**
 * @typedef {object} LikelihoodPack
 * @property {string} packId
 * @property {string} version
 * @property {string[]} hypotheses
 * @property {number[]} priors
 * @property {function(object): Array<{likelihoods: number[]}>} buildEvidenceLikelihoods
 *   Receives observation { lossDb?, reflectanceDb?, ... } and returns evidenceLikelihoods array.
 */

function assertPack(pack) {
  if (!pack || typeof pack !== 'object') throw new TypeError('PACK_REQUIRED');
  if (!pack.packId || !pack.version) throw new TypeError('PACK_ID_AND_VERSION_REQUIRED');
  if (!Array.isArray(pack.hypotheses) || pack.hypotheses.length < 2) {
    throw new RangeError('HYPOTHESES_MIN_2');
  }
  if (!Array.isArray(pack.priors) || pack.priors.length !== pack.hypotheses.length) {
    throw new TypeError('PRIORS_MISMATCH');
  }
  if (typeof pack.buildEvidenceLikelihoods !== 'function') {
    throw new TypeError('BUILD_EVIDENCE_LIKELIHOODS_REQUIRED');
  }
  return pack;
}

/**
 * Run advisory diagnosis using a calibrated pack + observation.
 */
function diagnoseWithPack(pack, observation) {
  assertPack(pack);
  const evidenceLikelihoods = pack.buildEvidenceLikelihoods(observation || {});
  if (!Array.isArray(evidenceLikelihoods)) {
    throw new TypeError('EVIDENCE_LIKELIHOODS_MUST_BE_ARRAY');
  }
  const ranking = rankOpticalHypotheses({
    hypotheses: pack.hypotheses,
    priors: pack.priors,
    evidenceLikelihoods
  });
  return Object.freeze({
    ...ranking,
    packId: pack.packId,
    packVersion: pack.version,
    advisory: true,
    note: 'CALIBRATED_PACK_ADVISORY_ONLY'
  });
}

/**
 * Example pack factory (illustrative structure only).
 * Real operating probabilities must come from the buyer's data.
 */
function createExampleStructuralPack() {
  return Object.freeze({
    packId: 'example-structural-v0',
    version: '0.0.1-example',
    hypotheses: Object.freeze(['MACROBEND', 'DIRTY_CONNECTOR', 'BAD_SPLICE', 'UNKNOWN']),
    priors: Object.freeze([0.30, 0.30, 0.25, 0.15]),
    buildEvidenceLikelihoods(obs) {
      const loss = Number(obs.lossDb);
      const refl = Number(obs.reflectanceDb);
      // Placeholder structure — replace with calibrated values before production use.
      // Values below are illustrative only and marked as such.
      const row = (a, b, c, d) => ({ likelihoods: [a, b, c, d] });
      if (!Number.isFinite(loss)) return [row(0.25, 0.25, 0.25, 0.25)];
      // Extremely simple illustrative gates — NOT production physics.
      if (Number.isFinite(refl) && refl > -40 && loss >= 0.2) return [row(0.10, 0.70, 0.10, 0.10)];
      if (loss > 0.5 && (!Number.isFinite(refl) || refl < -50)) return [row(0.70, 0.10, 0.10, 0.10)];
      if (loss > 0.1 && loss <= 0.4) return [row(0.15, 0.15, 0.55, 0.15)];
      return [row(0.20, 0.20, 0.20, 0.40)];
    },
    note: 'EXAMPLE_PACK_NOT_FOR_PRODUCTION_WITHOUT_CALIBRATION'
  });
}

module.exports = {
  assertPack,
  diagnoseWithPack,
  createExampleStructuralPack
};

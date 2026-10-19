'use strict';

/**
 * Geometric plausibility checks (Feature E)
 *
 * Truth boundary:
 * - Pure JS checks on caller-supplied length + vertex count.
 * - Does not invent tables or run PostGIS itself.
 * - Intended as a pre-check before a future migration on real geometry columns.
 * - Thresholds are parameters, not universal physics constants.
 */

/**
 * @param {object} input
 * @param {number} input.lengthMeters
 * @param {number} input.vertexCount
 * @param {number} [input.maxStraightLengthMeters=5000]
 * @param {number} [input.minVerticesForLongPath=3]
 * @param {number} [input.minLengthMeters=1]
 */
function assessPathPlausibility(input) {
  input = input || {};
  const length = Number(input.lengthMeters);
  const vertices = Number(input.vertexCount);
  const maxStraight = Number(input.maxStraightLengthMeters);
  const minVerts = Number(input.minVerticesForLongPath);
  const minLen = Number(input.minLengthMeters);

  const maxStraightLengthMeters = Number.isFinite(maxStraight) && maxStraight > 0 ? maxStraight : 5000;
  const minVerticesForLongPath = Number.isFinite(minVerts) && minVerts >= 2 ? minVerts : 3;
  const minLengthMeters = Number.isFinite(minLen) && minLen >= 0 ? minLen : 1;

  const reasons = [];
  let plausible = true;

  if (!Number.isFinite(length) || !Number.isFinite(vertices)) {
    return Object.freeze({
      plausible: false,
      reasons: Object.freeze(['INVALID_NUMERIC_INPUT']),
      metrics: null
    });
  }

  if (length <= minLengthMeters) {
    plausible = false;
    reasons.push('LENGTH_TOO_SHORT_OR_DEGENERATE');
  }

  if (length > maxStraightLengthMeters && vertices < minVerticesForLongPath) {
    plausible = false;
    reasons.push('LONG_PATH_WITH_INSUFFICIENT_VERTICES');
  }

  if (vertices < 2) {
    plausible = false;
    reasons.push('INSUFFICIENT_VERTICES_FOR_LINESTRING');
  }

  if (plausible) reasons.push('PASSED_PLAUSIBILITY_GATES');

  return Object.freeze({
    plausible,
    reasons: Object.freeze(reasons.slice()),
    metrics: Object.freeze({
      lengthMeters: length,
      vertexCount: vertices,
      maxStraightLengthMeters,
      minVerticesForLongPath,
      minLengthMeters
    }),
    note: 'PURE_PRECHECK_ONLY_POSTGIS_REMAINS_AUTHORITATIVE_FOR_GEOMETRY'
  });
}

module.exports = { assessPathPlausibility };

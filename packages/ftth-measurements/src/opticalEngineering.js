'use strict';

/**
 * FiberOS optical engineering mathematics.
 *
 * Scope:
 * - Pure deterministic mathematics only. No I/O, no mocks, no sample telemetry.
 * - Inputs are explicit measured/declared quantities with SI units.
 * - Results are mathematical transformations; they are not evidence that a
 *   physical instrument was connected or that a trace was calibrated.
 *
 * OTDR convention used here:
 * - z is one-way fibre distance.
 * - t is round-trip flight time.
 * - n_g is the group refractive index at the measurement wavelength.
 * - d = c * t / (2 * n_g)
 * - alpha = 10*log10(P1/P2) / (2*delta-z) for a backscatter slope.
 *
 * Reflectance:
 * - R_dB = 10*log10(P_reflected/P_incident)
 * - This is the physical power-ratio definition. A calibrated OTDR's
 *   reported event reflectance may require instrument/reference corrections,
 *   so this function deliberately does not pretend to perform vendor-specific
 *   correction factors.
 *
 * Rx/link budget:
 * - P_rx[dBm] = P_tx[dBm] + gains[dB] - losses[dB]
 * - L[dB] = P_tx[dBm] - P_rx[dBm]
 * - Margin[dB] = P_rx[dBm] - sensitivity[dBm]
 *
 * No constants for fibre attenuation, splice loss, connector loss, splitter
 * loss, group index, or vendor correction are invented here; those values must
 * be supplied by the measurement/design authority.
 */

const SPEED_OF_LIGHT_M_S = 299792458;

function finiteNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const err = new TypeError(name + ' must be a finite number');
    err.code = 'INVALID_NUMERIC';
    throw err;
  }
  return n;
}

function positiveFinite(value, name) {
  const n = finiteNumber(value, name);
  if (!(n > 0)) {
    const err = new RangeError(name + ' must be > 0');
    err.code = 'NON_POSITIVE';
    throw err;
  }
  return n;
}

function nonNegativeFinite(value, name) {
  const n = finiteNumber(value, name);
  if (n < 0) {
    const err = new RangeError(name + ' must be >= 0');
    err.code = 'NEGATIVE_VALUE';
    throw err;
  }
  return n;
}


function dbFromPowerRatio(powerRatio) {
  const r = positiveFinite(powerRatio, 'powerRatio');
  return 10 * Math.log10(r);
}

function powerRatioFromDb(db) {
  const d = finiteNumber(db, 'db');
  return Math.pow(10, d / 10);
}

function mwFromDbm(dbm) {
  const d = finiteNumber(dbm, 'dbm');
  return Math.pow(10, d / 10);
}

function dbmFromMw(mw) {
  const p = positiveFinite(mw, 'mw');
  return 10 * Math.log10(p);
}

function dbmDifference(fromDbm, toDbm) {
  return finiteNumber(fromDbm, 'fromDbm') - finiteNumber(toDbm, 'toDbm');
}

function receivedPowerDbm(input) {
  input = input || {};
  const tx = finiteNumber(input.txPowerDbm, 'txPowerDbm');
  const losses = sumDecibels(input.lossesDb || [], 'lossesDb');
  const gains = sumDecibels(input.gainsDb || [], 'gainsDb');
  return tx + gains - losses;
}

function totalLossDb(input) {
  input = input || {};
  const tx = finiteNumber(input.txPowerDbm, 'txPowerDbm');
  const rx = finiteNumber(input.rxPowerDbm, 'rxPowerDbm');
  const losses = tx - rx;
  return losses;
}

function rxPowerMarginDb(rxPowerDbm, sensitivityDbm) {
  return finiteNumber(rxPowerDbm, 'rxPowerDbm') -
    finiteNumber(sensitivityDbm, 'sensitivityDbm');
}

function overloadHeadroomDb(rxPowerDbm, overloadDbm) {
  return finiteNumber(overloadDbm, 'overloadDbm') -
    finiteNumber(rxPowerDbm, 'rxPowerDbm');
}

function opticalBudget(input) {
  input = input || {};
  const tx = finiteNumber(input.txPowerDbm, 'txPowerDbm');
  const sensitivity = finiteNumber(input.sensitivityDbm, 'sensitivityDbm');
  const overload = finiteNumber(input.overloadDbm, 'overloadDbm');
  const losses = sumDecibels(input.lossesDb || [], 'lossesDb');
  const gains = sumDecibels(input.gainsDb || [], 'gainsDb');
  const predictedRx = tx + gains - losses;
  return Object.freeze({
    txPowerDbm: tx,
    totalLossDb: losses,
    totalGainDb: gains,
    predictedRxDbm: predictedRx,
    sensitivityMarginDb: predictedRx - sensitivity,
    overloadHeadroomDb: overload - predictedRx,
    withinReceiverWindow: predictedRx >= sensitivity && predictedRx <= overload
  });
}

function sumDecibels(values, name) {
  if (!Array.isArray(values)) {
    const err = new TypeError(name + ' must be an array');
    err.code = 'INVALID_DB_LIST';
    throw err;
  }
  return values.reduce(function (sum, value) {
    return sum + finiteNumber(value, name + '[]');
  }, 0);
}

function distanceFromRoundTripTimeSeconds(roundTripSeconds, groupIndex) {
  const t = nonNegativeFinite(roundTripSeconds, 'roundTripSeconds');
  const n = positiveFinite(groupIndex, 'groupIndex');
  return SPEED_OF_LIGHT_M_S * t / (2 * n);
}

function distanceFromRoundTripTimeNs(roundTripNs, groupIndex) {
  return distanceFromRoundTripTimeSeconds(
    finiteNumber(roundTripNs, 'roundTripNs') * 1e-9,
    groupIndex
  );
}

function roundTripTimeSecondsFromDistance(distanceMeters, groupIndex) {
  const d = nonNegativeFinite(distanceMeters, 'distanceMeters');
  const n = positiveFinite(groupIndex, 'groupIndex');
  return (2 * n * d) / SPEED_OF_LIGHT_M_S;
}

function roundTripTimeNsFromDistance(distanceMeters, groupIndex) {
  return roundTripTimeSecondsFromDistance(distanceMeters, groupIndex) * 1e9;
}

/**
 * Idealized pulse-width-limited one-way spatial extent in fibre.
 * Instrument dead zones and implementation details are not modelled.
 */
function pulseWidthSpatialExtentMeters(pulseWidthSeconds, groupIndex) {
  const tau = positiveFinite(pulseWidthSeconds, 'pulseWidthSeconds');
  const n = positiveFinite(groupIndex, 'groupIndex');
  return SPEED_OF_LIGHT_M_S * tau / (2 * n);
}

function pulseWidthSpatialExtentMetersFromNs(pulseWidthNs, groupIndex) {
  return pulseWidthSpatialExtentMeters(
    finiteNumber(pulseWidthNs, 'pulseWidthNs') * 1e-9,
    groupIndex
  );
}

/**
 * Backscatter slope attenuation from two OTDR levels.
 *
 * p1 and p2 are backscatter levels in dBm measured at z1 and z2.
 * z1 < z2. The factor 2 accounts for the round trip.
 *
 * A negative result is retained as a signed mathematical result and marked
 * with a warning rather than silently converting it to a positive loss.
 */
function attenuationDbPerKmFromBackscatterPoints(point1, point2) {
  const a = point1 || {};
  const b = point2 || {};
  const z1 = finiteNumber(a.distanceMeters, 'point1.distanceMeters');
  const z2 = finiteNumber(b.distanceMeters, 'point2.distanceMeters');
  if (!(z2 > z1)) {
    const err = new RangeError('point2.distanceMeters must be greater than point1.distanceMeters');
    err.code = 'INVALID_OTDR_DISTANCE_ORDER';
    throw err;
  }
  const p1 = finiteNumber(a.powerDbm, 'point1.powerDbm');
  const p2 = finiteNumber(b.powerDbm, 'point2.powerDbm');
  const deltaMeters = z2 - z1;
  const attenuationDbPerKm = (p1 - p2) * 1000 / (2 * deltaMeters);
  return Object.freeze({
    attenuationDbPerKm,
    distanceSpanMeters: deltaMeters,
    roundTripDistanceMeters: 2 * deltaMeters,
    signed: true,
    physicallyNonNegative: attenuationDbPerKm >= 0,
    warning: attenuationDbPerKm < 0
      ? 'NEGATIVE_BACKSCATTER_SLOPE_REQUIRES_MEASUREMENT_REVIEW'
      : null
  });
}

function eventLossDb(powerBeforeDbm, powerAfterDbm) {
  return finiteNumber(powerBeforeDbm, 'powerBeforeDbm') -
    finiteNumber(powerAfterDbm, 'powerAfterDbm');
}

function distanceUncertaintyFromRoundTripTime({
  roundTripSeconds,
  groupIndex,
  roundTripStdSeconds = 0,
  groupIndexStd = 0
} = {}) {
  const t = nonNegativeFinite(roundTripSeconds, 'roundTripSeconds');
  const n = positiveFinite(groupIndex, 'groupIndex');
  const st = nonNegativeFinite(roundTripStdSeconds, 'roundTripStdSeconds');
  const sn = nonNegativeFinite(groupIndexStd, 'groupIndexStd');
  const distanceMeters = distanceFromRoundTripTimeSeconds(t, n);
  const dDt = SPEED_OF_LIGHT_M_S / (2 * n);
  const dDn = -(SPEED_OF_LIGHT_M_S * t) / (2 * n * n);
  const variance = dDt * dDt * st * st + dDn * dDn * sn * sn;
  return Object.freeze({
    distanceMeters,
    stdDistanceMeters: Math.sqrt(variance),
    formula: 'd = c*t/(2*n_g); Var(d) = (∂d/∂t)^2 Var(t) + (∂d/∂n_g)^2 Var(n_g)',
    covarianceAssumed: 'zero between t and n_g'
  });
}

function attenuationUncertaintyFromBackscatterPoints(point1, point2) {
  const result = attenuationDbPerKmFromBackscatterPoints(point1, point2);
  const p1 = point1 || {};
  const p2 = point2 || {};
  const z1 = finiteNumber(p1.distanceMeters, 'point1.distanceMeters');
  const z2 = finiteNumber(p2.distanceMeters, 'point2.distanceMeters');
  const dp = finiteNumber(p1.powerDbm, 'point1.powerDbm') -
    finiteNumber(p2.powerDbm, 'point2.powerDbm');
  const deltaZ = z2 - z1;
  const sigmaP1 = nonNegativeFinite(p1.powerStdDb || 0, 'point1.powerStdDb');
  const sigmaP2 = nonNegativeFinite(p2.powerStdDb || 0, 'point2.powerStdDb');
  const sigmaZ1 = nonNegativeFinite(p1.distanceStdMeters || 0, 'point1.distanceStdMeters');
  const sigmaZ2 = nonNegativeFinite(p2.distanceStdMeters || 0, 'point2.distanceStdMeters');
  const varianceDp = sigmaP1 * sigmaP1 + sigmaP2 * sigmaP2;
  const varianceDeltaZ = sigmaZ1 * sigmaZ1 + sigmaZ2 * sigmaZ2;
  const dAlphaDp = 1000 / (2 * deltaZ);
  const dAlphaDz = -1000 * dp / (2 * deltaZ * deltaZ);
  const variance = dAlphaDp * dAlphaDp * varianceDp +
    dAlphaDz * dAlphaDz * varianceDeltaZ;
  return Object.freeze({
    ...result,
    stdAttenuationDbPerKm: Math.sqrt(variance),
    varianceDb2PerKm2: variance,
    formula: 'alpha = 10*log10(P1/P2)/(2*Δz); first-order variance from independent level and distance uncertainties',
    covarianceAssumed: 'zero between endpoint powers and positions'
  });
}

function reflectanceUncertaintyFromDbm({
  reflectedDbm,
  incidentDbm,
  reflectedStdDb = 0,
  incidentStdDb = 0
} = {}) {
  const reflected = finiteNumber(reflectedDbm, 'reflectedDbm');
  const incident = finiteNumber(incidentDbm, 'incidentDbm');
  const sr = nonNegativeFinite(reflectedStdDb, 'reflectedStdDb');
  const si = nonNegativeFinite(incidentStdDb, 'incidentStdDb');
  const valueDb = reflected - incident;
  return Object.freeze({
    reflectanceDb: valueDb,
    stdReflectanceDb: Math.sqrt(sr * sr + si * si),
    formula: 'R_dB = P_reflected(dBm) - P_incident(dBm)',
    covarianceAssumed: 'zero between reflected and incident level errors'
  });
}

/**
 * Ordinary least-squares fit of OTDR backscatter level versus one-way distance.
 *
 * y(z) = intercept + slope*z
 * attenuation = -slope * 1000 / 2  [dB/km]
 *
 * This operates on already-decoded numeric trace points. It does not parse
 * vendor SOR bytes and it does not perform OTDR event/dead-zone correction.
 */
function fitBackscatterTrace(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new TypeError('points must contain at least two observations');
  }
  const data = points.map((point, i) => ({
    z: finiteNumber(point && point.distanceMeters, 'points[' + i + '].distanceMeters'),
    y: finiteNumber(point && point.powerDbm, 'points[' + i + '].powerDbm')
  })).sort((a, b) => a.z - b.z);
  for (let i = 1; i < data.length; i++) {
    if (!(data[i].z > data[i - 1].z)) {
      throw new RangeError('distanceMeters must be strictly increasing without duplicates');
    }
  }
  const n = data.length;
  const meanZ = data.reduce((s, p) => s + p.z, 0) / n;
  const meanY = data.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (const p of data) {
    const dz = p.z - meanZ;
    const dy = p.y - meanY;
    sxx += dz * dz;
    sxy += dz * dy;
    sst += dy * dy;
  }
  if (!(sxx > 0)) throw new RangeError('distance span must be non-zero');
  const slopeDbPerM = sxy / sxx;
  const interceptDbm = meanY - slopeDbPerM * meanZ;
  let sse = 0;
  for (const p of data) {
    const residual = p.y - (interceptDbm + slopeDbPerM * p.z);
    sse += residual * residual;
  }
  const attenuationDbPerKm = -slopeDbPerM * 500;
  const rSquared = sst > 0 ? 1 - sse / sst : null;
  const dof = n - 2;
  const residualVarianceDb2 = dof > 0 ? sse / dof : null;
  const slopeStdDbPerM =
    residualVarianceDb2 == null ? null : Math.sqrt(residualVarianceDb2 / sxx);
  const attenuationStdDbPerKm =
    slopeStdDbPerM == null ? null : slopeStdDbPerM * 500;
  return Object.freeze({
    count: n,
    distanceStartMeters: data[0].z,
    distanceEndMeters: data[n - 1].z,
    slopeDbPerM,
    interceptDbm,
    attenuationDbPerKm,
    attenuationStdDbPerKm,
    residualSumSquaresDb2: sse,
    residualVarianceDb2,
    rSquared,
    dof,
    physicallyNonNegative: attenuationDbPerKm >= 0,
    warning: attenuationDbPerKm < 0
      ? 'NEGATIVE_FITTED_BACKSCATTER_SLOPE_REQUIRES_MEASUREMENT_REVIEW'
      : null,
    formula: 'y = a + b*z; alpha = -500*b [dB/km]'
  });
}

function reflectanceDbFromPowerRatio(reflectedPower, incidentPower) {
  const reflected = positiveFinite(reflectedPower, 'reflectedPower');
  const incident = positiveFinite(incidentPower, 'incidentPower');
  if (!(reflected <= incident)) {
    const err = new RangeError('reflectedPower must be <= incidentPower for passive-event reflectance');
    err.code = 'REFLECTED_POWER_EXCEEDS_INCIDENT';
    throw err;
  }
  return 10 * Math.log10(reflected / incident);
}

function reflectanceDbFromDbm(reflectedDbm, incidentDbm) {
  return finiteNumber(reflectedDbm, 'reflectedDbm') -
    finiteNumber(incidentDbm, 'incidentDbm');
}

function opticalLossDbFromPowerMeasurements(input) {
  input = input || {};
  const tx = positiveFinite(input.transmittedBeforeMw, 'transmittedBeforeMw');
  const rx = finiteNumber(input.transmittedAfterMw, 'transmittedAfterMw');
  if (!(rx > 0)) {
    const err = new RangeError('transmittedAfterMw must be > 0');
    err.code = 'INVALID_TRANSMITTED_POWER';
    throw err;
  }
  return 10 * Math.log10(tx / rx);
}


module.exports = Object.freeze({
  SPEED_OF_LIGHT_M_S,
  dbFromPowerRatio,
  powerRatioFromDb,
  mwFromDbm,
  dbmFromMw,
  dbmDifference,
  receivedPowerDbm,
  totalLossDb,
  rxPowerMarginDb,
  overloadHeadroomDb,
  opticalBudget,
  distanceFromRoundTripTimeSeconds,
  distanceFromRoundTripTimeNs,
  roundTripTimeSecondsFromDistance,
  roundTripTimeNsFromDistance,
  pulseWidthSpatialExtentMeters,
  pulseWidthSpatialExtentMetersFromNs,
  attenuationDbPerKmFromBackscatterPoints,
  eventLossDb,
  reflectanceDbFromPowerRatio,
  reflectanceDbFromDbm,
  distanceUncertaintyFromRoundTripTime,
  attenuationUncertaintyFromBackscatterPoints,
  reflectanceUncertaintyFromDbm,
  fitBackscatterTrace,
  opticalLossDbFromPowerMeasurements
});

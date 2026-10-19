'use strict';

/*
 * Reliability / predictive-maintenance primitives.
 * No vendor constants or invented field coefficients are embedded here.
 * All fitted quantities must come from supplied observations.
 */

function finite(x, name) {
  const v = Number(x);
  if (!Number.isFinite(v)) throw new TypeError(`${name} must be finite`);
  return v;
}

function positive(x, name) {
  const v = finite(x, name);
  if (v <= 0) throw new RangeError(`${name} must be > 0`);
  return v;
}

function nonneg(x, name) {
  const v = finite(x, name);
  if (v < 0) throw new RangeError(`${name} must be >= 0`);
  return v;
}

function observations(xs) {
  if (!Array.isArray(xs) || xs.length < 3) {
    throw new RangeError('at least 3 observations are required');
  }
  return xs
    .map((o, i) => ({
      time: positive(o.time, `observations[${i}].time`),
      value: finite(o.value, `observations[${i}].value`)
    }))
    .sort((a, b) => a.time - b.time);
}

function olsTrend(input) {
  const data = observations(input.observations);
  const n = data.length;
  const xbar = data.reduce((sum, o) => sum + o.time, 0) / n;
  const ybar = data.reduce((sum, o) => sum + o.value, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (const o of data) {
    const dx = o.time - xbar;
    const dy = o.value - ybar;
    sxx += dx * dx;
    sxy += dx * dy;
  }

  if (!(sxx > 0)) throw new RangeError('observation times must vary');

  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  let sse = 0;
  for (const o of data) {
    const error = o.value - (intercept + slope * o.time);
    sse += error * error;
  }

  const dof = n - 2;
  const residualVariance = dof > 0 ? sse / dof : NaN;
  const slopeSE = dof > 0 ? Math.sqrt(residualVariance / sxx) : NaN;
  const interceptSE = dof > 0
    ? Math.sqrt(residualVariance * (1 / n + (xbar * xbar) / sxx))
    : NaN;
  const r2 = sxx > 0 ? (sxy * sxy) / (sxx * sse + sxy * sxy) : NaN;

  return Object.freeze({
    n,
    slope,
    intercept,
    residualVariance,
    sse,
    degreesOfFreedom: dof,
    slopeStandardError: slopeSE,
    interceptStandardError: interceptSE,
    rSquared: r2,
    model: 'ordinary least squares linear degradation trend',
    assumptions: [
      'time and response are correctly measured',
      'linear trend is an adequate local approximation',
      'residuals are independent with constant variance for standard-error interpretation'
    ]
  });
}

function forecastCrossing({ trend, threshold, direction = 'down', minFutureTime = null }) {
  if (!trend || !Number.isFinite(trend.slope) || !Number.isFinite(trend.intercept)) {
    throw new TypeError('valid trend required');
  }

  const th = finite(threshold, 'threshold');
  if (direction !== 'down' && direction !== 'up') {
    throw new RangeError('direction must be down or up');
  }

  if (
    (direction === 'down' && trend.slope >= 0) ||
    (direction === 'up' && trend.slope <= 0)
  ) {
    return Object.freeze({
      crossingTime: null,
      reachable: false,
      reason: 'trend does not move toward threshold'
    });
  }

  let time = (th - trend.intercept) / trend.slope;
  if (minFutureTime != null) {
    time = Math.max(time, finite(minFutureTime, 'minFutureTime'));
  }

  return Object.freeze({
    crossingTime: time,
    reachable: Number.isFinite(time) && time > 0,
    threshold: th,
    direction
  });
}

/*
 * Piecewise-constant competing-risks model with Gamma(shape, rate) priors.
 * Exposure is time-at-risk. For cause j:
 * lambda_j | data ~ Gamma(a+d_j, b+T_j).
 */
function competingRisks({
  causes,
  priorShape = 1,
  priorRate = 0,
  events,
  exposure
}) {
  if (!Array.isArray(causes) || !causes.length) {
    throw new TypeError('causes required');
  }

  const a = positive(priorShape, 'priorShape');
  const b = nonneg(priorRate, 'priorRate');
  if (!(b > 0)) {
    throw new RangeError('priorRate must be > 0 to define a proper Gamma prior');
  }

  const ev = events || {};
  const ex = positive(exposure, 'exposure');

  const rows = causes.map((cause) => {
    const id = String(cause);
    const d = nonneg(ev[cause] ?? 0, `events.${cause}`);
    const shape = a + d;
    const rate = b + ex;
    const meanHazard = shape / rate;
    return {
      cause: id,
      events: d,
      posteriorShape: shape,
      posteriorRate: rate,
      posteriorMeanHazard: meanHazard
    };
  });

  const total = rows.reduce((sum, row) => sum + row.posteriorMeanHazard, 0);

  return Object.freeze({
    exposure: ex,
    causes: rows,
    totalMeanHazard: total,
    model: 'independent Gamma-Poisson / piecewise-constant cause-specific hazard',
    assumptions: [
      'constant cause-specific hazard over the declared exposure interval',
      'causes are conditionally independent given their hazards',
      'priorShape/priorRate are externally chosen and documented; no defaults are claimed as field truth'
    ]
  });
}

function posteriorReliabilityAt({ causes, time }) {
  const t = positive(time, 'time');
  if (!Array.isArray(causes) || !causes.length) {
    throw new TypeError('causes required');
  }

  let survival = 1;
  for (const cause of causes) {
    const a = positive(cause.posteriorShape, `${cause.cause}.posteriorShape`);
    const b = positive(cause.posteriorRate, `${cause.cause}.posteriorRate`);
    survival *= Math.pow(b / (b + t), a);
  }

  return Object.freeze({
    time: t,
    reliability: survival,
    failureProbability: 1 - survival,
    model: 'posterior predictive reliability under independent Gamma hazards'
  });
}

function decisionThreshold({
  failureProbability,
  actionCost,
  expectedFailureImpact,
  preventiveCost
}) {
  const p = finite(failureProbability, 'failureProbability');
  if (p < 0 || p > 1) {
    throw new RangeError('failureProbability must be in [0,1]');
  }

  const impact = nonneg(expectedFailureImpact, 'expectedFailureImpact');
  const cost = nonneg(actionCost, 'actionCost');
  const pcost = nonneg(preventiveCost, 'preventiveCost');
  const expectedLoss = p * impact;

  return Object.freeze({
    failureProbability: p,
    expectedFailureLoss: expectedLoss,
    preventiveCost: pcost,
    actionCost: cost,
    netPreventiveValue: expectedLoss - (pcost + cost),
    recommendPreventive: expectedLoss > (pcost + cost),
    formula: 'EV_preventive = P(failure)*impact - preventiveCost - actionCost'
  });
}

function parsePlanningDate(value) {
  const date = value == null ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('planningTimestamp must be a valid date');
  }
  return date;
}

function buildPreventiveMaintenanceSchedule({
  candidates,
  planningHorizon,
  planningTimestamp
} = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new RangeError('maintenance candidates are required');
  }

  const horizon = positive(planningHorizon, 'planningHorizon');
  const now = parsePlanningDate(planningTimestamp);

  const schedule = candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new TypeError(`candidates[${index}] must be an object`);
    }

    const assetId = String(candidate.assetId ?? '').trim();
    if (!assetId) throw new TypeError(`candidates[${index}].assetId is required`);

    const causes = Array.isArray(candidate.causes) ? candidate.causes : [];
    if (!causes.length) throw new TypeError(`candidates[${index}].causes are required`);

    const posterior = competingRisks({
      causes,
      priorShape: candidate.priorShape,
      priorRate: candidate.priorRate,
      events: candidate.events,
      exposure: candidate.exposure
    });

    const reliability = posteriorReliabilityAt({
      causes: posterior.causes,
      time: horizon
    });

    const decision = decisionThreshold({
      failureProbability: reliability.failureProbability,
      expectedFailureImpact: candidate.expectedFailureImpact,
      preventiveCost: candidate.preventiveCost,
      actionCost: candidate.actionCost
    });

    const leadTime = nonneg(candidate.leadTime ?? 0, `candidates[${index}].leadTime`);
    const scheduleTime = Math.max(0, horizon - leadTime);
    const dueAt = new Date(now.getTime() + scheduleTime * 24 * 60 * 60 * 1000);

    return Object.freeze({
      assetId,
      status: decision.recommendPreventive ? 'PLAN' : 'MONITOR',
      dueAt: decision.recommendPreventive ? dueAt.toISOString() : null,
      planningHorizon: horizon,
      leadTime,
      posterior: {
        causes: posterior.causes,
        totalMeanHazard: posterior.totalMeanHazard
      },
      risk: reliability,
      decision
    });
  });

  schedule.sort((a, b) => {
    const statusDelta = (a.status === 'PLAN' ? 0 : 1) - (b.status === 'PLAN' ? 0 : 1);
    if (statusDelta !== 0) return statusDelta;
    if (b.decision.netPreventiveValue !== a.decision.netPreventiveValue) {
      return b.decision.netPreventiveValue - a.decision.netPreventiveValue;
    }
    if (b.risk.failureProbability !== a.risk.failureProbability) {
      return b.risk.failureProbability - a.risk.failureProbability;
    }
    return a.assetId.localeCompare(b.assetId);
  });

  return Object.freeze({
    schema: 'fiberos.preventive-maintenance.v1',
    planningTimestamp: now.toISOString(),
    planningHorizon: horizon,
    schedule,
    plannedCount: schedule.filter((row) => row.status === 'PLAN').length,
    autonomousExecution: false,
    databaseWrites: 0,
    authority: 'DETERMINISTIC_RISK_BASED_PREVENTIVE_PLANNING',
    limitations: [
      'The planner consumes supplied failure observations and explicit economic costs.',
      'It creates a schedule recommendation only; it does not create work orders or mutate network state.',
      'Buyer production integration and historical-data quality remain separate evidence requirements.'
    ]
  });
}

module.exports = Object.freeze({
  olsTrend,
  forecastCrossing,
  competingRisks,
  posteriorReliabilityAt,
  decisionThreshold,
  buildPreventiveMaintenanceSchedule
});

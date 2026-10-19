'use strict';

const { createSeededRng } = require('./reproducibility');

const EPS = Number.EPSILON;
const Z95 = 1.959963984540054;

function finite(x, name) {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new TypeError(`${name} must be finite`);
  return n;
}
function nonNegative(x, name) {
  const n = finite(x, name);
  if (n < 0) throw new RangeError(`${name} must be >= 0`);
  return n;
}
function positive(x, name) {
  const n = finite(x, name);
  if (!(n > 0)) throw new RangeError(`${name} must be > 0`);
  return n;
}
function assertArray(a, name) {
  if (!Array.isArray(a) || a.length === 0) throw new TypeError(`${name} must be a non-empty array`);
  return a;
}

// Kahan/Neumaier-style compensated summation. This is intentionally independent
// from production engineering solvers so it can act as a numerical cross-check.
function compensatedSum(values) {
  assertArray(values, 'values');
  // Neumaier compensation: robust when a small term is added to a much larger partial sum.
  let sum = 0;
  let correction = 0;
  for (let i = 0; i < values.length; i++) {
    const x = finite(values[i], `values[${i}]`);
    const t = sum + x;
    if (Math.abs(sum) >= Math.abs(x)) correction += (sum - t) + x;
    else correction += (x - t) + sum;
    sum = t;
  }
  return sum + correction;
}

function naiveSum(values) {
  assertArray(values, 'values');
  return values.reduce((s, v, i) => s + finite(v, `values[${i}]`), 0);
}

function cancellationIndex(values) {
  const vals = assertArray(values, 'values').map((v, i) => finite(v, `values[${i}]`));
  const numerator = compensatedSum(vals.map(Math.abs));
  const denominator = Math.abs(compensatedSum(vals));
  return denominator === 0 ? (numerator === 0 ? 0 : Infinity) : numerator / denominator;
}

function matrixOneNorm(A) {
  if (!Array.isArray(A) || !A.length || A.some(r => !Array.isArray(r) || r.length !== A.length)) throw new TypeError('matrix must be square');
  return Math.max(...A.map((_, j) => compensatedSum(A.map((r, i) => Math.abs(finite(r[j], `matrix[${i}][${j}]`))))));
}

function conditionNumberOneNorm(A) {
  const normA = matrixOneNorm(A);
  if (normA === 0) return 0;
  const n = A.length;
  const aug = A.map((r, i) => r.map((v,j)=>finite(v,`matrix[${i}][${j}]`)).concat(Array.from({length:n},(_,k)=>k===i?1:0)));
  for(let c=0;c<n;c++){
    let pivot=c; for(let r=c+1;r<n;r++) if(Math.abs(aug[r][c])>Math.abs(aug[pivot][c])) pivot=r;
    if(Math.abs(aug[pivot][c])<=Number.EPSILON*Math.max(1,normA)) return Infinity;
    [aug[c],aug[pivot]]=[aug[pivot],aug[c]];
    const q=aug[c][c]; for(let j=0;j<2*n;j++) aug[c][j]/=q;
    for(let r=0;r<n;r++) if(r!==c){const f=aug[r][c]; if(f!==0) for(let j=0;j<2*n;j++) aug[r][j]-=f*aug[c][j];}
  }
  const inv=aug.map(r=>r.slice(n));
  return normA*matrixOneNorm(inv);
}

function relativeError(actual, reference) {
  const a = finite(actual, 'actual');
  const r = finite(reference, 'reference');
  return Math.abs(a - r) / Math.max(Math.abs(r), Number.MIN_VALUE);
}

function interval(value, radius = 0) {
  const v = finite(value, 'value');
  const r = nonNegative(radius, 'radius');
  return Object.freeze({ lower: v - r, upper: v + r });
}
function assertInterval(i, name = 'interval') {
  if (!i || !Number.isFinite(i.lower) || !Number.isFinite(i.upper) || i.lower > i.upper) throw new TypeError(`${name} invalid`);
  return i;
}
function intervalAdd(a, b) {
  assertInterval(a, 'a'); assertInterval(b, 'b');
  return { lower: a.lower + b.lower, upper: a.upper + b.upper };
}
function intervalSubtract(a, b) {
  assertInterval(a, 'a'); assertInterval(b, 'b');
  return { lower: a.lower - b.upper, upper: a.upper - b.lower };
}
function intervalMultiply(a, b) {
  assertInterval(a, 'a'); assertInterval(b, 'b');
  const p = [a.lower * b.lower, a.lower * b.upper, a.upper * b.lower, a.upper * b.upper];
  return { lower: Math.min(...p), upper: Math.max(...p) };
}
function intervalSum(values) {
  assertArray(values, 'values');
  return values.map((x, i) => assertInterval(x, `values[${i}]`)).reduce(intervalAdd);
}

function opticalLinkInterval({txDbm, receiverSensitivityDbm, segments}) {
  const tx = finite(txDbm, 'txDbm');
  const sens = finite(receiverSensitivityDbm, 'receiverSensitivityDbm');
  if (!Array.isArray(segments) || !segments.length) throw new TypeError('segments required');
  let total = { lower: 0, upper: 0 };
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i] || {};
    const length = nonNegative(s.lengthKm ?? 0, `segments[${i}].lengthKm`);
    const alpha = nonNegative(s.attenuationDbPerKm ?? 0, `segments[${i}].attenuationDbPerKm`);
    const lengthBound = nonNegative(s.lengthBoundKm ?? 0, `segments[${i}].lengthBoundKm`);
    const alphaBound = nonNegative(s.attenuationBoundDbPerKm ?? 0, `segments[${i}].attenuationBoundDbPerKm`);
    const fixed = nonNegative(s.lossDb ?? 0, `segments[${i}].lossDb`);
    const fixedBound = nonNegative(s.lossBoundDb ?? 0, `segments[${i}].lossBoundDb`);
    // Explicit bounded uncertainty only. Standard deviations are deliberately not treated as hard bounds.
    const fiber = intervalMultiply(interval(length, lengthBound), interval(alpha, alphaBound));
    const fixedI = interval(fixed, fixedBound);
    total = intervalAdd(total, intervalAdd(fiber, fixedI));
  }
  const rx = intervalSubtract(interval(tx, 0), total);
  const margin = intervalSubtract(rx, interval(sens, 0));
  return Object.freeze({ totalLossDb: total, rxDbm: rx, marginDb: margin });
}

function jacobianFiniteDifference(f, x, { relativeStep = Math.cbrt(EPS), absoluteStep = 1e-8 } = {}) {
  if (typeof f !== 'function') throw new TypeError('f must be a function');
  assertArray(x, 'x');
  const base = x.map((v, i) => finite(v, `x[${i}]`));
  const y0 = f(base.slice());
  const y = Array.isArray(y0) ? y0.map((v, i) => finite(v, `f(x)[${i}]`)) : [finite(y0, 'f(x)')];
  const J = Array.from({ length: y.length }, () => Array(base.length).fill(0));
  for (let j = 0; j < base.length; j++) {
    const h = Math.max(absoluteStep, Math.abs(base[j]) * relativeStep);
    const xp = base.slice(); const xm = base.slice();
    xp[j] += h; xm[j] -= h;
    const yp0 = f(xp); const ym0 = f(xm);
    const yp = Array.isArray(yp0) ? yp0 : [yp0];
    const ym = Array.isArray(ym0) ? ym0 : [ym0];
    if (yp.length !== y.length || ym.length !== y.length) throw new Error('f output dimension changed during finite difference');
    for (let i = 0; i < y.length; i++) J[i][j] = (finite(yp[i], `f+(${i})`) - finite(ym[i], `f-(${i})`)) / (2 * h);
  }
  return J;
}

function covariancePSD(A, tolerance = 1e-12) {
  if (!Array.isArray(A) || !A.length || A.some(r => !Array.isArray(r) || r.length !== A.length)) throw new TypeError('covariance must be square');
  const n = A.length;
  const S = A.map((r, i) => r.map((v, j) => {
    const x = finite(v, `covariance[${i}][${j}]`);
    const y = finite(A[j][i], `covariance[${j}][${i}]`);
    if (Math.abs(x - y) > tolerance * Math.max(1, Math.abs(x), Math.abs(y))) throw new RangeError('covariance must be symmetric');
    return (x + y) / 2;
  }));
  const L = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = S[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        const scale = Math.max(1, Math.abs(S[i][i]));
        if (sum < -tolerance * scale) throw new RangeError('covariance must be positive semidefinite');
        L[i][j] = Math.sqrt(Math.max(0, sum));
      } else if (L[j][j] > Math.sqrt(Number.MIN_VALUE)) {
        L[i][j] = sum / L[j][j];
      } else if (Math.abs(sum) > tolerance) {
        throw new RangeError('covariance is numerically inconsistent');
      }
    }
  }
  return Object.freeze({matrix: S, factor: L});
}

function propagateGaussian({mean, gradient, covariance, z = Z95}) {
  const m = finite(mean, 'mean');
  assertArray(gradient, 'gradient');
  if (!Array.isArray(covariance) || covariance.length !== gradient.length) throw new TypeError('gradient/covariance dimension mismatch');
  const { matrix } = covariancePSD(covariance);
  let variance = 0;
  for (let i = 0; i < gradient.length; i++) {
    const gi = finite(gradient[i], `gradient[${i}]`);
    for (let j = 0; j < gradient.length; j++) variance += gi * matrix[i][j] * finite(gradient[j], `gradient[${j}]`);
  }
  if (variance < -1e-12) throw new RangeError('propagated variance negative');
  variance = Math.max(0, variance);
  const sigma = Math.sqrt(variance);
  const z95 = positive(z, 'z');
  return Object.freeze({mean: m, variance, std: sigma, lower: m - z95 * sigma, upper: m + z95 * sigma});
}

function randomNormal(rng) {
  const u1 = Math.max(Number.MIN_VALUE, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function choleskyForSampling(A) {
  return covariancePSD(A).factor;
}

function monteCarloGaussian({mean, covariance, samples = 10000, seed = 1, transform = x => x}) {
  assertArray(mean, 'mean');
  const n = mean.length;
  const cov = covariancePSD(covariance);
  if (cov.matrix.length !== n) throw new TypeError('mean/covariance dimension mismatch');
  const count = Number(samples);
  if (!Number.isInteger(count) || count < 2 || count > 1000000) throw new RangeError('samples must be an integer in [2,1000000]');
  if (!Number.isInteger(seed) || seed < 0) throw new RangeError('seed must be a non-negative integer');
  if (typeof transform !== 'function') throw new TypeError('transform must be a function');
  const rng = createSeededRng(seed);
  const L = cov.factor;
  const values = [];
  for (let s = 0; s < count; s++) {
    const z = Array.from({length:n}, () => randomNormal(rng));
    const x = mean.map((m, i) => {
      let delta = 0;
      for (let j = 0; j <= i; j++) delta += L[i][j] * z[j];
      return finite(m, `mean[${i}]`) + delta;
    });
    values.push(finite(transform(x), `transform(${s})`));
  }
  const meanEstimate = compensatedSum(values) / count;
  let m2 = 0;
  let c = 0;
  for (const v of values) {
    const term = (v - meanEstimate) ** 2 - c;
    const t = m2 + term;
    c = (t - m2) - term;
    m2 = t;
  }
  const variance = m2 / (count - 1);
  return Object.freeze({samples: count, seed, mean: meanEstimate, variance, std: Math.sqrt(Math.max(0, variance)), min: Math.min(...values), max: Math.max(...values)});
}

function dimension(signature) {
  if (!signature || typeof signature !== 'object') throw new TypeError('dimension signature required');
  const allowed = ['L','P','T','N'];
  const out = {};
  for (const k of allowed) {
    const v = signature[k] == null ? 0 : Number(signature[k]);
    if (!Number.isInteger(v)) throw new TypeError(`dimension.${k} must be an integer`);
    out[k] = v;
  }
  return Object.freeze(out);
}
function sameDimension(a, b) {
  const x = dimension(a), y = dimension(b);
  return ['L','P','T','N'].every(k => x[k] === y[k]);
}
function addDimensions(a, b) { if (!sameDimension(a,b)) throw new RangeError('dimension mismatch for addition'); return dimension(a); }
function multiplyDimensions(a, b) { const x=dimension(a),y=dimension(b); return dimension({L:x.L+y.L,P:x.P+y.P,T:x.T+y.T,N:x.N+y.N}); }

module.exports = Object.freeze({
  compensatedSum,
  naiveSum,
  cancellationIndex,
  relativeError,
  matrixOneNorm,
  conditionNumberOneNorm,
  interval,
  intervalAdd,
  intervalSubtract,
  intervalMultiply,
  intervalSum,
  opticalLinkInterval,
  jacobianFiniteDifference,
  covariancePSD,
  propagateGaussian,
  monteCarloGaussian,
  dimension,
  sameDimension,
  addDimensions,
  multiplyDimensions,
  Z95
});

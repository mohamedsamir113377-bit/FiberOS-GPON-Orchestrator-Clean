'use strict';

// Engineering rule: no empirical coefficient is silently invented here.
// All non-universal quantities (fiber attenuation, splice/connector loss,
// splitter excess loss, uncertainty, etc.) must be supplied by the caller.

const EPS = 1e-12;

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
function optionalNonNegative(value, name, fallback=0) {
  return value == null ? fallback : nonNegative(value, name);
}
function nonNegativeInteger(value, name) {
  const n = nonNegative(value, name);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${name} must be a non-negative safe integer`);
  return n;
}
function normalCdf(z) {
  // Abramowitz-Stegun 7.1.26, max error ~7.5e-8.
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429;
  const erf = sign * (1 - (((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x)));
  return 0.5 * (1 + erf);
}
function splitterIdealLoss(ratio) {
  const n = nonNegative(ratio, 'splitRatio');
  if (!Number.isInteger(n) || n < 1) throw new RangeError('splitRatio must be a positive integer');
  return n === 1 ? 0 : 10 * Math.log10(n);
}

/**
 * Full dB link budget. Every loss term is explicitly observable.
 * L_total = alpha*length + sum(splices) + sum(connectors) + splitter + explicit terms.
 * Uncertainty is propagated by RSS when standard deviations are supplied.
 */
function linkBudget(p) {
  p = p || {};
  const tx = finite(p.txDbm, 'txDbm');
  const sensitivity = finite(p.receiverSensitivityDbm, 'receiverSensitivityDbm');
  const lengthKm = optionalNonNegative(p.lengthKm, 'lengthKm');
  const alpha = nonNegative(p.fiberAttenuationDbPerKm, 'fiberAttenuationDbPerKm');
  const spliceLossDb = optionalNonNegative(p.spliceLossDb, 'spliceLossDb');
  const connectorLossDb = optionalNonNegative(p.connectorLossDb, 'connectorLossDb');
  const splices = p.splices == null ? 0 : nonNegativeInteger(p.splices, 'splices');
  const connectors = p.connectors == null ? 0 : nonNegativeInteger(p.connectors, 'connectors');
  const splitRatio = p.splitRatio == null ? 1 : nonNegative(p.splitRatio, 'splitRatio');
  const splitterExcessDb = optionalNonNegative(p.splitterExcessDb, 'splitterExcessDb');
  const explicitDb = optionalNonNegative(p.explicitLossDb, 'explicitLossDb');
  const designMarginDb = optionalNonNegative(p.designMarginDb, 'designMarginDb');

  const fiberDb = lengthKm * alpha;
  const spliceDb = splices * spliceLossDb;
  const connectorDb = connectors * connectorLossDb;
  const splitterIdealDb = splitterIdealLoss(splitRatio);
  const splitterDb = splitterIdealDb + splitterExcessDb;
  const totalDb = fiberDb + spliceDb + connectorDb + splitterDb + explicitDb;
  const rxDbm = tx - totalDb;
  const rawMarginDb = rxDbm - sensitivity;
  const engineeringMarginDb = rawMarginDb - designMarginDb;

  const stdTerms = [];
  if (p.fiberAttenuationStdDbPerKm != null) stdTerms.push(lengthKm * finite(p.fiberAttenuationStdDbPerKm, 'fiberAttenuationStdDbPerKm'));
  if (p.spliceLossStdDb != null) stdTerms.push(Math.sqrt(splices) * finite(p.spliceLossStdDb, 'spliceLossStdDb'));
  if (p.connectorLossStdDb != null) stdTerms.push(Math.sqrt(connectors) * finite(p.connectorLossStdDb, 'connectorLossStdDb'));
  if (p.splitterExcessStdDb != null) stdTerms.push(finite(p.splitterExcessStdDb, 'splitterExcessStdDb'));
  if (p.explicitLossStdDb != null) stdTerms.push(finite(p.explicitLossStdDb, 'explicitLossStdDb'));
  if (p.txStdDb != null) stdTerms.push(finite(p.txStdDb, 'txStdDb'));
  if (p.sensitivityStdDb != null) stdTerms.push(finite(p.sensitivityStdDb, 'sensitivityStdDb'));
  const sigmaDb = Math.sqrt(stdTerms.reduce((s, v) => s + v*v, 0));
  const z = sigmaDb > EPS ? engineeringMarginDb / sigmaDb : (engineeringMarginDb >= 0 ? Infinity : -Infinity);
  const probabilityMarginPositive = sigmaDb > EPS ? normalCdf(z) : (engineeringMarginDb >= 0 ? 1 : 0);

  return Object.freeze({
    fiberDb, spliceDb, connectorDb, splitterIdealDb, splitterExcessDb, splitterDb, explicitDb,
    totalDb, rxDbm, rawMarginDb, designMarginDb, engineeringMarginDb,
    uncertaintyStdDb: sigmaDb, zMargin: z, probabilityMarginPositive,
    feasible: engineeringMarginDb >= 0,
    uncertaintySpecified: stdTerms.length > 0
  });
}

function uncertaintyFromIndependentStd(stds) {
  if (!Array.isArray(stds)) throw new TypeError('stds must be an array');
  const variance = stds.map((v,i)=>finite(v,`stds[${i}]`)).reduce((s,v)=>s+v*v,0);
  return Math.sqrt(variance);
}

function residualAnalysis({measuredDbm, expectedDbm, measurementStdDb=0, modelStdDb=0}) {
  const measured = finite(measuredDbm,'measuredDbm');
  const expected = finite(expectedDbm,'expectedDbm');
  const sigma = Math.sqrt(Math.max(0, finite(measurementStdDb,'measurementStdDb'))**2 + Math.max(0, finite(modelStdDb,'modelStdDb'))**2);
  const residual = measured - expected;
  const z = sigma > EPS ? residual / sigma : (residual === 0 ? 0 : residual > 0 ? Infinity : -Infinity);
  const twoSidedP = sigma > EPS ? 2 * (1 - normalCdf(Math.abs(z))) : (residual === 0 ? 1 : 0);
  return Object.freeze({residualDb: residual, sigmaDb: sigma, zScore:z, twoSidedP, statisticallyUnexpected: Math.abs(z) >= 3});
}

module.exports = { linkBudget, splitterIdealLoss, uncertaintyFromIndependentStd, residualAnalysis, normalCdf };

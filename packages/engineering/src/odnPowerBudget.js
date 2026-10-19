'use strict';

/**
 * ODN Optical Power Budget engine — values attributed to ITU-T Manual 2009
 * (Optical fibres, cables and systems) as extracted in the FTTH Deep Specs Gap Report.
 *
 * No silent invention of coefficients: caller supplies measured/declared path terms.
 * Classes A/B/C/B+/C+ ranges are fixed from the reference table (manual p.262–264).
 */

const ODN_CLASSES = Object.freeze({
  A: Object.freeze({
    code: 'A',
    minDb: 5,
    maxDb: 20,
    fecRequiredDownstream: false,
    source: 'ITU-T Manual 2009 Optical fibres, cables and systems, Class A',
    pageRef: 'p.262-264'
  }),
  B: Object.freeze({
    code: 'B',
    minDb: 10,
    maxDb: 25,
    fecRequiredDownstream: false,
    source: 'ITU-T Manual 2009, Class B',
    pageRef: 'p.262-264'
  }),
  C: Object.freeze({
    code: 'C',
    minDb: 15,
    maxDb: 30,
    fecRequiredDownstream: false,
    source: 'ITU-T Manual 2009, Class C',
    pageRef: 'p.262-264'
  }),
  'B+': Object.freeze({
    code: 'B+',
    minDb: 13,
    maxDb: 28,
    fecRequiredDownstream: true,
    source: 'ITU-T Manual 2009 / G.984.2 Class B+ (FEC required downstream)',
    pageRef: 'p.262; G.984.2'
  }),
  'C+': Object.freeze({
    code: 'C+',
    minDb: 17,
    maxDb: 32,
    fecRequiredDownstream: false,
    source: 'ITU-T Manual 2009 Class C+ (supports split up to 1:128 with capable OLT/SOA)',
    pageRef: 'p.262-264'
  })
});

/** Practical defaults cited in the gap report — optional only when caller omits. */
const REFERENCE_DEFAULTS = Object.freeze({
  spliceLossDb: 0.1,
  connectorLossDb: 0.35,
  fiberAttenuationDbPerKmAt1550: 0.275,
  splitter1to32Db: 17.1,
  designMarginDbPerKm: 0.05,
  maintenanceMarginDb: 1.0,
  source: 'ITU-T Manual 2009 example table 9-9 p.264 and typical splice/connector practice'
});

function finite(x, name) {
  const n = Number(x);
  if (!Number.isFinite(n)) {
    const e = new Error('ODN_BUDGET_' + name.toUpperCase() + '_INVALID');
    e.code = 'ODN_BUDGET_' + name.toUpperCase() + '_INVALID';
    throw e;
  }
  return n;
}

function nonNeg(x, name) {
  const n = finite(x, name);
  if (n < 0) {
    const e = new Error('ODN_BUDGET_' + name.toUpperCase() + '_NEGATIVE');
    e.code = 'ODN_BUDGET_' + name.toUpperCase() + '_NEGATIVE';
    throw e;
  }
  return n;
}

function resolveClass(classCode) {
  const key = String(classCode || '').trim().toUpperCase().replace('PLUS', '+');
  const normalized = key === 'BPLUS' ? 'B+' : key === 'CPLUS' ? 'C+' : key;
  const cls = ODN_CLASSES[normalized];
  if (!cls) {
    const e = new Error('ODN_BUDGET_CLASS_UNKNOWN');
    e.code = 'ODN_BUDGET_CLASS_UNKNOWN';
    e.statusCode = 400;
    throw e;
  }
  return cls;
}

/**
 * Compute path attenuation from explicit terms (no invented coefficients).
 */
function computePathLossDb(input = {}) {
  const lengthKm = nonNeg(input.lengthKm == null ? 0 : input.lengthKm, 'lengthKm');
  const alpha = nonNeg(
    input.fiberAttenuationDbPerKm == null
      ? REFERENCE_DEFAULTS.fiberAttenuationDbPerKmAt1550
      : input.fiberAttenuationDbPerKm,
    'fiberAttenuationDbPerKm'
  );
  const splices = nonNeg(input.splices == null ? 0 : input.splices, 'splices');
  const spliceLossDb = nonNeg(
    input.spliceLossDb == null ? REFERENCE_DEFAULTS.spliceLossDb : input.spliceLossDb,
    'spliceLossDb'
  );
  const connectors = nonNeg(input.connectors == null ? 0 : input.connectors, 'connectors');
  const connectorLossDb = nonNeg(
    input.connectorLossDb == null ? REFERENCE_DEFAULTS.connectorLossDb : input.connectorLossDb,
    'connectorLossDb'
  );
  const splitterLossDb = nonNeg(
    input.splitterLossDb == null ? 0 : input.splitterLossDb,
    'splitterLossDb'
  );
  const explicitLossDb = nonNeg(input.explicitLossDb == null ? 0 : input.explicitLossDb, 'explicitLossDb');
  const designMarginDb =
    input.designMarginDb != null
      ? nonNeg(input.designMarginDb, 'designMarginDb')
      : nonNeg(lengthKm * REFERENCE_DEFAULTS.designMarginDbPerKm, 'designMarginDb');
  const maintenanceMarginDb = nonNeg(
    input.maintenanceMarginDb == null ? REFERENCE_DEFAULTS.maintenanceMarginDb : input.maintenanceMarginDb,
    'maintenanceMarginDb'
  );

  const fiberDb = lengthKm * alpha;
  const spliceDb = splices * spliceLossDb;
  const connectorDb = connectors * connectorLossDb;
  const pathLossDb = fiberDb + spliceDb + connectorDb + splitterLossDb + explicitLossDb;
  const totalWithMarginsDb = pathLossDb + designMarginDb + maintenanceMarginDb;

  return Object.freeze({
    fiberDb,
    spliceDb,
    connectorDb,
    splitterLossDb,
    explicitLossDb,
    designMarginDb,
    maintenanceMarginDb,
    pathLossDb,
    totalWithMarginsDb,
    defaultsUsed: Object.freeze({
      fiberAttenuationDbPerKm: input.fiberAttenuationDbPerKm == null,
      spliceLossDb: input.spliceLossDb == null,
      connectorLossDb: input.connectorLossDb == null,
      designMarginDb: input.designMarginDb == null,
      maintenanceMarginDb: input.maintenanceMarginDb == null
    }),
    referenceDefaultsSource: REFERENCE_DEFAULTS.source
  });
}

/**
 * Evaluate ODN budget against a class window.
 * Rejects when totalWithMarginsDb > class.maxDb (or optional availableBudgetDb).
 */
function evaluateOdnPowerBudget(input = {}) {
  const cls = resolveClass(input.odnClass || input.classCode || 'B+');
  const path = computePathLossDb(input);

  const txDbm = input.txDbm == null ? null : finite(input.txDbm, 'txDbm');
  const sensitivityDbm =
    input.receiverSensitivityDbm == null ? null : finite(input.receiverSensitivityDbm, 'receiverSensitivityDbm');

  let availableBudgetDb = null;
  if (txDbm != null && sensitivityDbm != null) {
    availableBudgetDb = txDbm - sensitivityDbm;
  }
  if (input.availableBudgetDb != null) {
    availableBudgetDb = finite(input.availableBudgetDb, 'availableBudgetDb');
  }

  if (availableBudgetDb != null && availableBudgetDb <= 0) {
    const e = new Error('ODN_BUDGET_NON_POSITIVE_AVAILABLE');
    e.code = 'ODN_BUDGET_NON_POSITIVE_AVAILABLE';
    e.statusCode = 422;
    throw e;
  }

  const limitDb = availableBudgetDb != null ? Math.min(availableBudgetDb, cls.maxDb) : cls.maxDb;
  const overBudget = path.totalWithMarginsDb > limitDb;
  const underMin = path.totalWithMarginsDb < cls.minDb;

  const attenuatorDocumented = input.attenuatorDocumented === true;
  let status;
  if (overBudget) status = 'REJECTED_OVER_BUDGET';
  else if (underMin && !attenuatorDocumented) status = 'BLOCKED_UNDER_CLASS_MIN';
  else if (underMin && attenuatorDocumented) status = 'ACCEPTED_WITH_ATTENUATOR';
  else status = 'ACCEPTED';

  const accepted = status === 'ACCEPTED' || status === 'ACCEPTED_WITH_ATTENUATOR';
  const blocked = status === 'BLOCKED_UNDER_CLASS_MIN';
  const rejected = overBudget;

  return Object.freeze({
    status,
    decision: status,
    accepted,
    blocked,
    rejected,
    underClassMinimum: underMin,
    attenuatorDocumented,
    odnClass: cls,
    path,
    limitDb,
    minimumPermittedLossDb: cls.minDb,
    maximumPermittedLossDb: cls.maxDb,
    availableBudgetDb,
    headroomDb: limitDb - path.totalWithMarginsDb,
    fecRequiredDownstream: cls.fecRequiredDownstream,
    engineVersion: 'odnPowerBudget/2026.10.09-p0',
    calculatedNotMeasured: true,
    truthBoundary:
      'SOURCE_BUDGET_EVALUATION_ONLY; LIVE_OLT_ONT_POWER_AND_FIELD_MEASUREMENT_REMAIN_RUNTIME_DEPENDENCIES',
    syntheticData: false
  });
}

/** Example from Manual table 9-9 p.264 — used only in unit tests as a golden vector. */
function referenceGponExample20km() {
  return evaluateOdnPowerBudget({
    odnClass: 'C',
    lengthKm: 20,
    fiberAttenuationDbPerKm: 0.4,
    splices: 15,
    spliceLossDb: 0.1,
    connectors: 4,
    connectorLossDb: 0.35,
    splitterLossDb: 17.1,
    designMarginDb: 1.0,
    maintenanceMarginDb: 1.0,
    availableBudgetDb: 30
  });
}

module.exports = {
  ODN_CLASSES,
  REFERENCE_DEFAULTS,
  resolveClass,
  computePathLossDb,
  evaluateOdnPowerBudget,
  referenceGponExample20km
};

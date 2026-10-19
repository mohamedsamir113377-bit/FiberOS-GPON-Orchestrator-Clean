'use strict';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function text(value, name) {
  const out = String(value ?? '').trim();
  if (!out) throw Object.assign(new TypeError(name + '_REQUIRED'), { code: name + '_REQUIRED' });
  if (out.length > 256) throw Object.assign(new RangeError(name + '_TOO_LONG'), { code: name + '_TOO_LONG' });
  return out;
}

function nonNegative(value, name) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0) throw Object.assign(new TypeError(name + '_INVALID'), { code: name + '_INVALID' });
  return out;
}

function positive(value, name) {
  const out = nonNegative(value, name);
  if (out <= 0) throw Object.assign(new RangeError(name + '_MUST_BE_POSITIVE'), { code: name + '_MUST_BE_POSITIVE' });
  return out;
}

function provenance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new TypeError('PROVENANCE_REQUIRED'), { code: 'PROVENANCE_REQUIRED' });
  }
  return Object.freeze({ ...value });
}

function validity(value, name) {
  if (value == null || value === '') return null;
  const out = String(value).trim();
  if (!ISO_RE.test(out) || Number.isNaN(new Date(out).getTime())) {
    throw Object.assign(new TypeError(name + '_INVALID'), { code: name + '_INVALID' });
  }
  return out;
}

function normalizeProfile(input) {
  const p = input || {};
  const modelKey = text(p.modelKey || 'commercial.cost', 'modelKey');
  if (modelKey !== 'commercial.cost') {
    throw Object.assign(new RangeError('COST_MODEL_KEY_INVALID'), { code: 'COST_MODEL_KEY_INVALID' });
  }
  const workType = text(p.workType, 'workType').toLowerCase();
  const unit = text(p.unit, 'unit');
  const currency = text(p.currency, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw Object.assign(new TypeError('CURRENCY_INVALID'), { code: 'CURRENCY_INVALID' });
  const modelVersion = text(p.modelVersion, 'modelVersion');
  const profileKey = text(p.profileKey || ('unit_rate:' + workType + ':' + unit + ':' + currency), 'profileKey');
  const valueMinor = nonNegative(p.valueMinor, 'valueMinor');
  const stdUncertainty = p.stdUncertainty == null ? null : positive(p.stdUncertainty, 'stdUncertainty');
  const validFrom = validity(p.validFrom, 'validFrom');
  const validTo = validity(p.validTo, 'validTo');
  if (validFrom && validTo && new Date(validFrom) >= new Date(validTo)) {
    throw Object.assign(new RangeError('VALIDITY_WINDOW_INVALID'), { code: 'VALIDITY_WINDOW_INVALID' });
  }
  const out = {
    modelKey,
    modelVersion,
    workType,
    unit,
    currency,
    profileKey,
    valueMinor,
    stdUncertainty,
    validMin: p.validMin == null ? null : nonNegative(p.validMin, 'validMin'),
    validMax: p.validMax == null ? null : nonNegative(p.validMax, 'validMax'),
    validFrom,
    validTo,
    sourceRef: text(p.sourceRef, 'sourceRef'),
    provenance: provenance(p.provenance)
  };
  if (out.validMin != null && out.validMax != null && out.validMin > out.validMax) {
    throw Object.assign(new RangeError('VALID_RANGE_INVALID'), { code: 'VALID_RANGE_INVALID' });
  }
  if (out.validMin != null && valueMinor < out.validMin) throw Object.assign(new RangeError('VALUE_BELOW_VALID_RANGE'), { code: 'VALUE_BELOW_VALID_RANGE' });
  if (out.validMax != null && valueMinor > out.validMax) throw Object.assign(new RangeError('VALUE_ABOVE_VALID_RANGE'), { code: 'VALUE_ABOVE_VALID_RANGE' });
  return Object.freeze(out);
}

function weightedObservedRate(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let quantity = 0;
  let amountMinor = 0;
  let observations = 0;
  for (const row of list) {
    const q = positive(row.quantity, 'quantity');
    const rate = nonNegative(row.rateMinor ?? row.rate_minor, 'rateMinor');
    quantity += q;
    amountMinor += q * rate;
    observations += 1;
  }
  if (quantity <= 0) return Object.freeze({ dataAvailable: false, quantity: 0, amountMinor: 0, weightedRateMinor: null, observations: 0 });
  return Object.freeze({
    dataAvailable: true,
    quantity,
    amountMinor,
    weightedRateMinor: amountMinor / quantity,
    observations
  });
}

function compareToObserved(profile, observed) {
  const actual = observed && observed.weightedRateMinor != null ? Number(observed.weightedRateMinor) : null;
  const approved = profile && profile.valueMinor != null ? Number(profile.valueMinor) : null;
  if (!Number.isFinite(actual) || !Number.isFinite(approved)) {
    return Object.freeze({ dataAvailable: Boolean(observed && observed.dataAvailable), deltaMinor: null, deltaPct: null });
  }
  const deltaMinor = approved - actual;
  return Object.freeze({
    dataAvailable: true,
    deltaMinor,
    deltaPct: actual === 0 ? (approved === 0 ? 0 : null) : (deltaMinor / actual) * 100
  });
}

module.exports = Object.freeze({ normalizeProfile, weightedObservedRate, compareToObserved });

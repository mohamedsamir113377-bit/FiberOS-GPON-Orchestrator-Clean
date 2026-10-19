'use strict';

/**
 * PON generation & optical-standard extension (GPON → XG(S)-PON → 50G-PON).
 * Concept sources (public): ITU-T G.984, G.987, G.9807.1, G.9804, G.657 (08/2024).
 * Catalog is versioned; values are not a substitute for operator-approved profiles.
 */

const CATALOG_VERSION = '2026.10.09-p0-g657-units';

const PON_GENERATIONS = Object.freeze({
  'G.984': Object.freeze({
    code: 'G.984', name: 'GPON', downstreamGbps: 2.48832, upstreamGbps: 1.24416,
    splitRatios: Object.freeze([32, 64, 128]), reachKm: 20,
    recommendation: 'G.984', editionNote: 'Family — use operator profile for amendment',
    source: 'ITU-T G.984.x'
  }),
  'G.987': Object.freeze({
    code: 'G.987', name: 'XG-PON1', downstreamGbps: 9.95328, upstreamGbps: 2.48832,
    splitRatios: Object.freeze([64, 128, 256]), reachKm: 20,
    recommendation: 'G.987.2', editionNote: '02/2023 + Amd1 06/2023 baseline reference',
    source: 'ITU-T G.987.x'
  }),
  'G.9807.1': Object.freeze({
    code: 'G.9807.1', name: 'XGS-PON', downstreamGbps: 9.95328, upstreamGbps: 9.95328,
    splitRatios: Object.freeze([64, 128, 256]), reachKm: 20,
    recommendation: 'G.9807.1', editionNote: '02/2023 + Amd1 05/2025 baseline reference',
    source: 'ITU-T G.9807.1'
  }),
  'G.9804': Object.freeze({
    code: 'G.9804', name: '50G-PON', downstreamGbps: 49.7664, upstreamGbps: 24.8832,
    splitRatios: Object.freeze([64, 128, 256]), reachKm: 20,
    recommendation: 'G.9804.3', editionNote: 'Family — verify Amendment 3 (02/2026) options with operator profile',
    source: 'ITU-T G.9804.x'
  })
});

// Power-budget classes (dB channel insertion loss windows) — generation-scoped.
const POWER_BUDGET_CLASSES = Object.freeze({
  'G.984': Object.freeze({
    'B+': Object.freeze({ minDb: 13, maxDb: 28 }),
    'C+': Object.freeze({ minDb: 17, maxDb: 32 })
  }),
  'G.987': Object.freeze({
    N1: Object.freeze({ minDb: 14, maxDb: 29 }),
    N2: Object.freeze({ minDb: 16, maxDb: 31 }),
    E1: Object.freeze({ minDb: 18, maxDb: 33 }),
    E2: Object.freeze({ minDb: 20, maxDb: 35 })
  }),
  'G.9807.1': Object.freeze({
    'B+': Object.freeze({ minDb: 13, maxDb: 28 }),
    'C+': Object.freeze({ minDb: 17, maxDb: 32 }),
    N1: Object.freeze({ minDb: 14, maxDb: 29 }),
    N2: Object.freeze({ minDb: 16, maxDb: 31 }),
    E1: Object.freeze({ minDb: 18, maxDb: 33 }),
    E2: Object.freeze({ minDb: 20, maxDb: 35 })
  }),
  'G.9804': Object.freeze({
    N1: Object.freeze({ minDb: 14, maxDb: 29 }),
    N2: Object.freeze({ minDb: 16, maxDb: 31 }),
    E1: Object.freeze({ minDb: 18, maxDb: 33 }),
    E2: Object.freeze({ minDb: 20, maxDb: 35 })
  })
});

/**
 * G.657 catalog — SEPARATE physical minimum design radius (mm) from
 * macrobend loss (dB) at stated test radii. Prior bug stored dB values
 * in fields named as if they were radii.
 *
 * minimumDesignRadiusMm: conservative design floor used by install checks.
 * macrobendLossDb: nominal max loss at the named test radius (public table order).
 * Verify against operator-approved G.657 (08/2024) profile before field acceptance.
 */
const G657_FIBRE_CLASSES = Object.freeze({
  'G.657.A1': Object.freeze({
    category: 'A1',
    minimumDesignRadiusMm: 10,
    macrobendLossDb: Object.freeze({ at15mm: 0.25, at10mm: null }),
    source: 'ITU-T G.657 (units corrected 2026-10-09)',
    truthBoundary: 'CATALOG_REFERENCE_ONLY; CONFIRM_OPERATOR_PROFILE'
  }),
  'G.657.A2': Object.freeze({
    category: 'A2',
    minimumDesignRadiusMm: 7.5,
    macrobendLossDb: Object.freeze({ at15mm: 0.03, at10mm: 0.1 }),
    source: 'ITU-T G.657 (units corrected 2026-10-09)',
    truthBoundary: 'CATALOG_REFERENCE_ONLY; CONFIRM_OPERATOR_PROFILE'
  }),
  'G.657.B2': Object.freeze({
    category: 'B2',
    minimumDesignRadiusMm: 7.5,
    macrobendLossDb: Object.freeze({ at15mm: 0.03, at10mm: 0.1 }),
    source: 'ITU-T G.657 (units corrected 2026-10-09)',
    truthBoundary: 'CATALOG_REFERENCE_ONLY; CONFIRM_OPERATOR_PROFILE'
  }),
  'G.657.B3': Object.freeze({
    category: 'B3',
    minimumDesignRadiusMm: 5,
    macrobendLossDb: Object.freeze({ at15mm: 0.03, at10mm: 0.1 }),
    source: 'ITU-T G.657 (units corrected 2026-10-09)',
    truthBoundary: 'CATALOG_REFERENCE_ONLY; CONFIRM_OPERATOR_PROFILE'
  })
});

/** @deprecated name retained for compatibility — use G657_FIBRE_CLASSES */
const G657_BEND_RADIUS_MM = G657_FIBRE_CLASSES;

function generation(code) {
  const g = PON_GENERATIONS[String(code)];
  if (!g) throw Object.assign(new Error('PON_GENERATION_UNKNOWN'), { code: 'PON_GENERATION_UNKNOWN' });
  return g;
}

function budgetClass(code, className) {
  const set = POWER_BUDGET_CLASSES[String(code)];
  if (!set) throw Object.assign(new Error('PON_GENERATION_UNKNOWN'), { code: 'PON_GENERATION_UNKNOWN' });
  const key = String(className).toUpperCase().replace('PLUS', '+');
  const c = set[key] || set[String(className).toUpperCase()];
  if (!c) throw Object.assign(new Error('PON_BUDGET_CLASS_UNKNOWN'), { code: 'PON_BUDGET_CLASS_UNKNOWN' });
  return Object.freeze({
    generation: String(code),
    className: key,
    minDb: c.minDb,
    maxDb: c.maxDb,
    catalogVersion: CATALOG_VERSION
  });
}

function validateLinkBudget({ code, className, totalLossDb, attenuatorDocumented = false } = {}) {
  const c = budgetClass(code, className);
  const loss = Number(totalLossDb);
  if (!Number.isFinite(loss) || loss < 0) {
    throw Object.assign(new Error('PON_LOSS_INVALID'), { code: 'PON_LOSS_INVALID' });
  }
  const underMin = loss < c.minDb;
  const overMax = loss > c.maxDb;
  const within = !underMin && !overMax;
  let decision = 'PASS';
  if (overMax) decision = 'FAIL';
  else if (underMin && !attenuatorDocumented) decision = 'BLOCKED_REQUIRES_ATTENUATOR_EVIDENCE';
  else if (underMin && attenuatorDocumented) decision = 'PASS_WITH_ATTENUATOR';
  return Object.freeze({
    decision,
    within,
    underMin,
    overMax,
    required: Object.freeze({ minDb: c.minDb, maxDb: c.maxDb }),
    totalLossDb: loss,
    marginDb: Number((c.maxDb - loss).toFixed(4)),
    catalogVersion: CATALOG_VERSION,
    calculatedNotMeasured: true
  });
}

function splitRatioFeasibility({
  code, splitRatio, availableBudgetDb, splitterLossDb,
  connectorLossDb = 0.5, spliceLossDb = 0.1, splices = 0,
  fibreLossDbPerKm = 0.35, distanceKm = 0
} = {}) {
  const g = generation(code);
  const ratio = Math.trunc(splitRatio);
  if (!g.splitRatios.includes(ratio)) {
    return Object.freeze({ feasible: false, reason: 'SPLIT_RATIO_NOT_IN_STANDARD', allowed: g.splitRatios });
  }
  if (splitterLossDb == null || !Number.isFinite(Number(splitterLossDb))) {
    return Object.freeze({
      feasible: false,
      reason: 'SPLITTER_LOSS_REQUIRED',
      note: 'Unknown splitter must not be treated as 0 dB'
    });
  }
  const budget = Number(availableBudgetDb);
  if (!Number.isFinite(budget)) {
    return Object.freeze({ feasible: false, reason: 'AVAILABLE_BUDGET_REQUIRED' });
  }
  const parts = {
    splitter: Number(splitterLossDb),
    connectors: Number(connectorLossDb) * 2,
    splices: Number(spliceLossDb) * Math.max(0, Math.trunc(splices)),
    fibre: Number(fibreLossDbPerKm) * Number(distanceKm)
  };
  const used = Object.values(parts).reduce((s, v) => s + v, 0);
  return Object.freeze({
    feasible: used <= budget,
    generation: g.code,
    splitRatio: ratio,
    usedDb: Number(used.toFixed(4)),
    remainingDb: Number((budget - used).toFixed(4)),
    breakdown: Object.freeze(parts),
    catalogVersion: CATALOG_VERSION
  });
}

function bendClass(code) {
  const b = G657_FIBRE_CLASSES[String(code)];
  if (!b) throw Object.assign(new Error('PON_BEND_CLASS_UNKNOWN'), { code: 'PON_BEND_CLASS_UNKNOWN' });
  return Object.freeze({
    code: String(code),
    category: b.category,
    minimumDesignRadiusMm: b.minimumDesignRadiusMm,
    macrobendLossDb: b.macrobendLossDb,
    // Back-compat aliases clearly labeled as loss (dB), not radius
    radius15mmLossDb: b.macrobendLossDb.at15mm,
    radius10mmLossDb: b.macrobendLossDb.at10mm,
    source: b.source,
    truthBoundary: b.truthBoundary,
    catalogVersion: CATALOG_VERSION
  });
}

module.exports = {
  CATALOG_VERSION,
  PON_GENERATIONS,
  POWER_BUDGET_CLASSES,
  G657_FIBRE_CLASSES,
  G657_BEND_RADIUS_MM,
  generation,
  budgetClass,
  validateLinkBudget,
  splitRatioFeasibility,
  bendClass
};

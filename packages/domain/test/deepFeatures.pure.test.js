'use strict';

/**
 * Pure deterministic tests for the three deep-feature helpers added 2026-09-17.
 * Run: node packages/domain/test/deepFeatures.pure.test.js
 */

const { createAssetFingerprint } = require('../src/assetFingerprint');
const { estimateConstructionCost } = require('../src/constructionCostEstimator');
const { rankOpticalHypotheses, fuseOpticalLossObservations } = require('../../engineering/src/opticalHypothesisRanker');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; console.log('  PASS:', m); } else { failed++; console.error('  FAIL:', m); } }

console.log('=== Asset Fingerprint ===');
const fp1 = createAssetFingerprint({
  assetType: 'SPLITTER',
  serial: 'SP-001',
  assetId: 'A1',
  installEventId: 'EVT-9',
  locationRef: { lat: 24.7, lng: 46.7 },
  attributes: { ports: 8 }
});
assert(typeof fp1.fingerprint === 'string' && fp1.fingerprint.length === 64, 'SHA-256 fingerprint length');
assert(fp1.note === 'FINGERPRINT_ONLY_NOT_PERSISTED', 'not persisted note');
const fp2 = createAssetFingerprint({
  assetType: 'SPLITTER',
  serial: 'SP-001',
  assetId: 'A1',
  installEventId: 'EVT-9',
  locationRef: { lat: 24.7, lng: 46.7 },
  attributes: { ports: 8 }
});
assert(fp1.fingerprint === fp2.fingerprint, 'deterministic same input → same hash');
let threw = false;
try { createAssetFingerprint({}); } catch (e) { threw = true; }
assert(threw, 'rejects missing assetType');

console.log('=== Construction Cost Estimator ===');
const cost = estimateConstructionCost({
  lengthKm: 2.5,
  splices: 10,
  connectors: 4,
  splitters: ['1:8', '1:16'],
  unitRates: {
    perKm: 1200,
    perSplice: 15,
    perConnector: 8,
    perSplitterType: { '1:8': 45, '1:16': 90 },
    other: 100,
    currency: 'SAR'
  }
});
assert(cost.costs.total > 0, 'total cost positive');
assert(cost.opticalBudget.note === 'CALCULATED_NOT_MEASURED', 'optical remains calculated');
assert(cost.advisory === true, 'marked advisory');
assert(cost.note.includes('SUPPLIED_RATES'), 'rates are supplied only');

console.log('=== Optical Hypothesis Ranker ===');
const rank = rankOpticalHypotheses({
  hypotheses: ['SHARP_BEND', 'MOISTURE_INGRESS', 'NATURAL_AGING'],
  priors: [0.3, 0.3, 0.4],
  evidenceLikelihoods: [
    { likelihoods: [0.8, 0.2, 0.1] },
    { likelihoods: [0.6, 0.5, 0.3] }
  ]
});
assert(rank.ranking.length === 3, 'three ranked hypotheses');
assert(rank.advisory === true, 'advisory only');
assert(typeof rank.entropyNats === 'number', 'entropy present');

const fused = fuseOpticalLossObservations([
  { value: 0.4, variance: 0.01 },
  { value: 0.42, variance: 0.02 }
]);
assert(Number.isFinite(fused.mean), 'fused mean finite');
assert(fused.assumption === 'INDEPENDENT_GAUSSIAN', 'assumption declared');

console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All deep-feature pure tests passed.');

'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const formal = require('../packages/formal-verification/src');
const numerical = require('../packages/engineering/src/numericalIntegrity');
const optical = require('../packages/engineering/src/opticalPhysics');
const twin = require('../packages/digital-twin-gis/src').twinVerification;
const firewallSource = fs.readFileSync('packages/security-firewall/src/sovereignBoundary.js', 'utf8');

const opticalSolver = (input) => {
  const q = input.segments[0];
  const totalLossDb = q.lengthKm * q.attenuationDbPerKm + q.lossDb;
  return { totalLossDb, rxDbm: input.txDbm - totalLossDb, marginDb: input.txDbm - totalLossDb - input.receiverSensitivityDbm };
};
const weibull = ({ age, shapeBeta, scaleEta }) => ({ reliability: Math.exp(-((age / scaleEta) ** shapeBeta)) });
const expectedUtility = ({ actions, outcomes }) => ({
  ranking: actions.map((a) => ({ id: a.id, expectedUtility: outcomes.reduce((s, o) => s + o.probability * (a.payoffByOutcome[o.id] || 0), 0) - a.directCost })).sort((a, b) => b.expectedUtility - a.expectedUtility)
});
const opticalInterval = {
  opticalLinkInterval: numerical.opticalLinkInterval,
  pointSolver: (input) => ({ totalLossDb: optical.linkBudget({
    txDbm: input.txDbm, receiverSensitivityDbm: input.receiverSensitivityDbm,
    lengthKm: input.segments[0].lengthKm, fiberAttenuationDbPerKm: input.segments[0].attenuationDbPerKm,
    explicitLossDb: input.segments[0].lossDb
  }).totalDb })
};

const result = formal.runFormalVerification({
  opticalSolver, weibull, expectedUtility,
  stateGraph: { states: ['A', 'B'], initial: 'A', terminals: ['B'], transitions: { A: ['B'], B: [] } },
  localization: { locales: ['ar', 'en'], coreInput: { x: 1 }, coreEvaluator: ({ x }) => ({ x }) },
  firewallSource, opticalInterval
});
if (result.status !== 'PASS_CORE') throw new Error('FORMAL_VERIFICATION_FAILED');
const twinState = { assets: ['a'], topologyVersion: 1 };
const twinSigningKeys = crypto.generateKeyPairSync('ed25519');
const twinSigningKeyId = 'formal-verification-ephemeral-test-key';
const twinSeal = twin.sealTwinState({ tenantId: 'tenant-a', sequence: 1, state: twinState, signingKey: twinSigningKeys.privateKey, keyId: twinSigningKeyId });
const twinResults = [
  twin.verifyTopologyDag({ nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b' }], roots: ['a'] }),
  twin.validateOpticalParity({ expected: 12, measured: 12.0005, toleranceDb: 0.001 }),
  twin.validateSpatialAsset({ lengthMeters: 100, vertexCount: 3 }),
  twin.verifyTwinSeal(twinSeal, twinState, {
    resolvePublicKey: (keyId) => keyId === twinSigningKeyId ? twinSigningKeys.publicKey : undefined,
    requireSignature: true
  }),
  twin.simulateFailure({ edges: [{ from: 's', to: 'x' }, { from: 'x', to: 't' }], source: 's', target: 't', requiredDisjointPaths: 1 })
];
if (twinResults.some((item) => item.status !== 'PASS' && item.passes !== true)) throw new Error('DIGITAL_TWIN_VERIFICATION_FAILED');
console.log(JSON.stringify({ status: result.status, mode: result.mode, domainVersion: result.domainVersion, totalChecks: result.totalChecks, results: result.results, digitalTwin: twinResults }, null, 2));

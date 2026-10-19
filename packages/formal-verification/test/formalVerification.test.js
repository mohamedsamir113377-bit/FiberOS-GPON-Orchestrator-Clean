'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const formal = require('../src');
const { opticalLinkInterval } = require('../../engineering/src/numericalIntegrity');
const { linkBudget } = require('../../engineering/src/opticalPhysics');
const firewallSource = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../security-firewall/src/sovereignBoundary.js'), 'utf8');

function opticalSolver(input) {
  const segment = input.segments[0];
  const totalLossDb = segment.lengthKm * segment.attenuationDbPerKm + segment.lossDb;
  return { totalLossDb, rxDbm: input.txDbm - totalLossDb, marginDb: input.txDbm - totalLossDb - input.receiverSensitivityDbm };
}
function weibull({ age, shapeBeta, scaleEta }) { return { reliability: Math.exp(-((age / scaleEta) ** shapeBeta)) }; }
function expectedUtility({ actions, outcomes }) {
  const ranking = actions.map(action => ({
    id: action.id,
    expectedUtility: outcomes.reduce((sum, outcome) => sum + outcome.probability * (action.payoffByOutcome[outcome.id] || 0), 0) - action.directCost
  })).sort((a, b) => b.expectedUtility - a.expectedUtility);
  return { ranking };
}

test('finite state graph proves liveness and rejects a cycle', () => {
  const graph = {
    states: ['PROPOSED', 'VERIFIED', 'APPROVED', 'COMMITTED', 'FAILED'],
    initial: 'PROPOSED', terminals: ['COMMITTED', 'FAILED'],
    transitions: { PROPOSED: ['VERIFIED'], VERIFIED: ['APPROVED'], APPROVED: ['COMMITTED', 'FAILED'], COMMITTED: [], FAILED: [] }
  };
  const proof = formal.verifyStateGraph(graph);
  assert.equal(proof.status, 'PASS');
  assert.equal(proof.maxPathLength, 3);
  assert.throws(() => formal.verifyStateGraph({ ...graph, transitions: { ...graph.transitions, VERIFIED: ['PROPOSED'] } }), /STATE_GRAPH_CYCLE/);
});

test('localization payload cannot influence deterministic core output', () => {
  const proof = formal.verifyLocalizationNonInterference({
    locales: ['ar', 'en', 'fr', 'ay'],
    coreInput: { ticketStatus: 'APPROVED', tenantId: 'tenant-a' },
    localizedPayloads: [{ locale: 'ar', messages: { approve: 'اعتماد' } }, { locale: 'fr', messages: { approve: 'Approuver' } }],
    coreEvaluator: ({ ticketStatus, tenantId }) => ({ ticketStatus, tenantId, eligible: ticketStatus === 'APPROVED' })
  });
  assert.equal(proof.status, 'PASS');
  assert.equal(proof.localeCount, 4);
});

test('kernel boundary uses HMAC and timing-safe comparison without claiming CPU equality', () => {
  const proof = formal.verifyConstantTimeBoundary(firewallSource);
  assert.equal(proof.status, 'PASS');
  assert.match(proof.proofBoundary, /not claimed/);
});

test('optical interval contains point calculation under declared bounds', () => {
  const proof = formal.verifyOpticalInterval({ opticalLinkInterval, pointSolver: input => {
    const r = linkBudget({ txDbm: input.txDbm, receiverSensitivityDbm: input.receiverSensitivityDbm, lengthKm: input.segments[0].lengthKm, fiberAttenuationDbPerKm: input.segments[0].attenuationDbPerKm, explicitLossDb: input.segments[0].lossDb });
    return { totalLossDb: r.totalDb };
  }});
  assert.equal(proof.status, 'PASS');
  assert.equal(proof.maximumDeclaredBoundDb, 0.001);
});

test('combined bounded certificate is deterministic and exposes soundness boundary', () => {
  const result = formal.runFormalVerification({
    opticalSolver, weibull, expectedUtility,
    stateGraph: { states: ['A', 'B'], initial: 'A', terminals: ['B'], transitions: { A: ['B'], B: [] } },
    localization: { locales: ['ar', 'en'], coreInput: { x: 1 }, coreEvaluator: ({ x }) => ({ x }) },
    firewallSource
  });
  assert.equal(result.status, 'PASS_CORE');
  assert.ok(result.totalChecks >= 40);
  assert.match(result.soundnessBoundary, /do not prove universal absence/);
  assert.equal(result.certificateMaterial, formal.runFormalVerification({ opticalSolver, weibull, expectedUtility, stateGraph: { states: ['A', 'B'], initial: 'A', terminals: ['B'], transitions: { A: ['B'], B: [] } }, localization: { locales: ['ar', 'en'], coreInput: { x: 1 }, coreEvaluator: ({ x }) => ({ x }) }, firewallSource }).certificateMaterial);
});

test('release profile requires every release obligation and reports only complete release as PASS_COMPLETE', () => {
  const input = {
    opticalSolver, weibull, expectedUtility,
    stateGraph: { states: ['A', 'B'], initial: 'A', terminals: ['B'], transitions: { A: ['B'], B: [] } },
    localization: { locales: ['ar', 'en'], coreInput: { x: 1 }, coreEvaluator: ({ x }) => ({ x }) },
    firewallSource,
    opticalInterval: { opticalLinkInterval, pointSolver: input => {
      const r = linkBudget({ txDbm: input.txDbm, receiverSensitivityDbm: input.receiverSensitivityDbm, lengthKm: input.segments[0].lengthKm, fiberAttenuationDbPerKm: input.segments[0].attenuationDbPerKm, explicitLossDb: input.segments[0].lossDb });
      return { totalLossDb: r.totalDb };
    } }
  };
  assert.equal(formal.runFormalVerification({ ...input, profile: 'core' }).status, 'PASS_CORE');
  const release = formal.runFormalVerification({ ...input, profile: 'release' });
  assert.equal(release.status, 'PASS_COMPLETE');
  assert.equal(release.profile, 'release');
  assert.deepEqual(release.omittedChecks, []);
  assert.throws(() => formal.runFormalVerification({ opticalSolver, weibull, expectedUtility, profile: 'release' }), /FORMAL_RELEASE_PROFILE_REQUIREMENTS_MISSING/);
});

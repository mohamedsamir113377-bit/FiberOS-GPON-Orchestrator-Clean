'use strict';

// FiberOS formal verification is intentionally executable and bounded. It proves
// declared invariants over explicit finite domains and static contracts. It does
// not claim an unbounded theorem about arbitrary JavaScript, CPU timing, or all
// possible PostgreSQL executions.

function assert(condition, message) { if (!condition) throw new Error(message); }
function finite(x, name) {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new TypeError(`${name} must be finite`);
  return n;
}
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}
function freezeResult(result) { return Object.freeze(result); }

function verifyOpticalModel(solver) {
  assert(typeof solver === 'function', 'optical solver function required');
  const txs = [-10, 0, 10];
  const sensitivities = [-30, -25];
  const lengths = [0, 0.1, 1, 10];
  const alphas = [0, 0.2, 0.35];
  const fixed = [0, 0.5, 3.4];
  let checks = 0;
  for (const tx of txs) for (const sensitivity of sensitivities) for (const lengthKm of lengths)
    for (const attenuationDbPerKm of alphas) for (const lossDb of fixed) {
      const input = { txDbm: tx, receiverSensitivityDbm: sensitivity, segments: [{ lengthKm, attenuationDbPerKm, lossDb }] };
      const r = solver(input);
      assert(Number.isFinite(r.totalLossDb) && r.totalLossDb >= 0, 'optical loss domain invariant');
      assert(Math.abs(r.rxDbm - (tx - r.totalLossDb)) <= 1e-12, 'rx conservation property');
      assert(Math.abs(r.marginDb - (r.rxDbm - sensitivity)) <= 1e-12, 'margin identity property');
      const plus = solver({ ...input, segments: [{ ...input.segments[0], lossDb: lossDb + 0.25 }] });
      assert(plus.rxDbm <= r.rxDbm + 1e-12, 'loss monotonicity property');
      checks += 1;
    }
  return freezeResult({ name: 'optical-bounded-properties', status: 'PASS', checks });
}

function verifyWeibullModel(weibull) {
  assert(typeof weibull === 'function', 'weibull function required');
  const ages = [0, 1, 10, 100, 1000];
  const betas = [0.5, 1, 2];
  const etas = [10, 100];
  let checks = 0;
  for (const beta of betas) for (const eta of etas) {
    let previous = 1;
    for (const age of ages) {
      const r = weibull({ age, shapeBeta: beta, scaleEta: eta });
      assert(r.reliability >= -1e-15 && r.reliability <= 1 + 1e-15, 'Weibull probability bound');
      assert(r.reliability <= previous + 1e-12, 'Weibull non-increasing property');
      previous = r.reliability;
      const scaleIdentity = weibull({ age: age / eta, shapeBeta: beta, scaleEta: 1 });
      assert(Math.abs(r.reliability - scaleIdentity.reliability) <= 1e-12, 'Weibull scale property');
      checks += 1;
    }
  }
  return freezeResult({ name: 'weibull-bounded-properties', status: 'PASS', checks });
}

function verifyDecisionModel(expectedUtility) {
  assert(typeof expectedUtility === 'function', 'expectedUtility function required');
  const probabilities = [0, 0.25, 0.5, 0.75, 1];
  const actions = [
    { id: 'observe', directCost: 0, payoffByOutcome: { failure: -100, success: 0 } },
    { id: 'prevent', directCost: 15, payoffByOutcome: { failure: -10, success: 0 } }
  ];
  let checks = 0;
  for (const p of probabilities) {
    const r = expectedUtility({ actions, outcomes: [{ id: 'failure', probability: p }, { id: 'success', probability: 1 - p }] });
    assert(r.ranking.length === 2, 'decision ranking completeness');
    const observe = r.ranking.find(x => x.id === 'observe').expectedUtility;
    assert(Math.abs(observe + 100 * p) <= 1e-12, 'expected utility linearity property');
    checks += 1;
  }
  const certainFailure = expectedUtility({ actions, outcomes: [{ id: 'failure', probability: 1 }, { id: 'success', probability: 0 }] });
  assert(certainFailure.ranking[0].id === 'prevent', 'certain-failure dominance property');
  const certainSuccess = expectedUtility({ actions, outcomes: [{ id: 'failure', probability: 0 }, { id: 'success', probability: 1 }] });
  assert(certainSuccess.ranking[0].id === 'observe', 'certain-success dominance property');
  checks += 2;
  return freezeResult({ name: 'decision-bounded-properties', status: 'PASS', checks });
}

function normalizeGraph(graph) {
  assert(graph && typeof graph === 'object', 'state graph required');
  const states = [...new Set((graph.states || []).map(String))];
  const initial = String(graph.initial);
  const terminals = new Set((graph.terminals || []).map(String));
  assert(states.includes(initial), 'initial state must be declared');
  assert(terminals.size > 0, 'at least one terminal state required');
  for (const terminal of terminals) assert(states.includes(terminal), `terminal state not declared: ${terminal}`);
  const transitions = new Map();
  for (const state of states) {
    const next = [...new Set(((graph.transitions && graph.transitions[state]) || []).map(String))];
    for (const target of next) assert(states.includes(target), `transition target not declared: ${state}->${target}`);
    transitions.set(state, next);
  }
  return { states, initial, terminals, transitions };
}

/**
 * Proves a finite transition graph is acyclic outside terminal states and that
 * every reachable non-terminal has a path to a terminal. This is a bounded DAG
 * proof, not a theorem about external queues or database locks.
 */
function verifyStateGraph(graph) {
  const g = normalizeGraph(graph);
  const reachable = new Set();
  const visit = (state) => {
    if (reachable.has(state)) return;
    reachable.add(state);
    for (const next of g.transitions.get(state)) visit(next);
  };
  visit(g.initial);
  const colors = new Map();
  const rank = new Map();
  const dfs = (state) => {
    const color = colors.get(state) || 0;
    if (color === 1) throw new Error(`STATE_GRAPH_CYCLE:${state}`);
    if (color === 2) return rank.get(state);
    colors.set(state, 1);
    if (g.terminals.has(state)) {
      rank.set(state, 0);
    } else {
      const next = g.transitions.get(state);
      assert(next.length > 0, `NON_TERMINAL_DEAD_END:${state}`);
      const childRanks = next.map(dfs);
      rank.set(state, Math.max(...childRanks) + 1);
    }
    colors.set(state, 2);
    return rank.get(state);
  };
  dfs(g.initial);
  for (const state of reachable) assert(g.terminals.has(state) || rank.has(state), `UNPROVEN_REACHABLE_STATE:${state}`);
  return freezeResult({
    name: 'finite-state-dag-liveness', status: 'PASS', states: g.states.length,
    reachableStates: reachable.size, terminalStates: g.terminals.size,
    maxPathLength: Math.max(...[...rank.values()]),
    proofBoundary: 'finite reachable graph; external persistence, queues, and locks require separate runtime tests'
  });
}

/**
 * Checks non-interference of presentation/localization data for a deterministic
 * core evaluator. The core input is held constant while locale payloads vary.
 */
function verifyLocalizationNonInterference({ locales, coreInput, coreEvaluator, localizedPayloads = [] }) {
  assert(Array.isArray(locales) && locales.length > 0, 'locales required');
  assert(typeof coreEvaluator === 'function', 'coreEvaluator required');
  const baseline = stable(coreEvaluator(coreInput));
  let checks = 0;
  for (const locale of locales) {
    const payload = localizedPayloads.find(x => x.locale === locale) || { locale, messages: {} };
    const output = coreEvaluator({ ...coreInput, presentation: { locale, messages: payload.messages } });
    assert(stable(output) === baseline, `LOCALIZATION_CORE_INTERFERENCE:${locale}`);
    checks += 1;
  }
  return freezeResult({ name: 'localization-non-interference', status: 'PASS', localeCount: locales.length, checks, proofBoundary: 'deterministic evaluator and supplied finite locale set' });
}

/**
 * Static proof obligation for the kernel boundary. timingSafeEqual protects the
 * comparison path; JavaScript cannot prove identical CPU cycles across hardware.
 */
function verifyConstantTimeBoundary(sourceText) {
  assert(typeof sourceText === 'string', 'firewall source required');
  assert(/timingSafeEqual\s*\(/.test(sourceText), 'CONSTANT_TIME_COMPARISON_MISSING');
  assert(!/signature\s*===|expected\s*===|actual\s*===/.test(sourceText), 'VARIABLE_TIME_SIGNATURE_COMPARISON_PRESENT');
  assert(/createHmac\(['"]sha256['"]/.test(sourceText), 'HMAC_SHA256_BOUNDARY_MISSING');
  return freezeResult({ name: 'constant-time-kernel-boundary', status: 'PASS', proofBoundary: 'constant-time comparison API and HMAC construction are present; CPU-cycle equality is not claimed' });
}

function verifyOpticalInterval({ opticalLinkInterval, pointSolver }) {
  assert(typeof opticalLinkInterval === 'function', 'opticalLinkInterval required');
  assert(typeof pointSolver === 'function', 'pointSolver required');
  const cases = [
    { txDbm: 0, receiverSensitivityDbm: -25, segments: [{ lengthKm: 1, attenuationDbPerKm: 0.35, lossDb: 0.2, attenuationBoundDbPerKm: 0.001 }] },
    { txDbm: 5, receiverSensitivityDbm: -30, segments: [{ lengthKm: 10, attenuationDbPerKm: 0.2, lossDb: 1.2, lossBoundDb: 0.001 }] }
  ];
  for (const input of cases) {
    const interval = opticalLinkInterval(input);
    const point = pointSolver(input);
    assert(point.totalLossDb >= interval.totalLossDb.lower - 1e-12 && point.totalLossDb <= interval.totalLossDb.upper + 1e-12, 'POINT_OUTSIDE_OPTICAL_INTERVAL');
  }
  return freezeResult({ name: 'optical-interval-containment', status: 'PASS', checks: cases.length, maximumDeclaredBoundDb: 0.001, proofBoundary: 'declared input bounds and finite test cases; not a universal instrument calibration guarantee' });
}

function runFormalVerification({ opticalSolver, weibull, expectedUtility, stateGraph, localization, firewallSource, opticalInterval, domainVersion = 'alpha18.v2', profile = 'core' }) {
  if (!['core', 'release'].includes(profile)) throw new Error('FORMAL_VERIFICATION_PROFILE_INVALID');
  if (profile === 'release' && (!stateGraph || !localization || !firewallSource || !opticalInterval)) throw new Error('FORMAL_RELEASE_PROFILE_REQUIREMENTS_MISSING');
  const results = [verifyOpticalModel(opticalSolver), verifyWeibullModel(weibull), verifyDecisionModel(expectedUtility)];
  if (stateGraph) results.push(verifyStateGraph(stateGraph));
  if (localization) results.push(verifyLocalizationNonInterference(localization));
  if (firewallSource) results.push(verifyConstantTimeBoundary(firewallSource));
  if (opticalInterval) results.push(verifyOpticalInterval(opticalInterval));
  const checks = ['optical-model', 'weibull-model', 'decision-model'];
  if (stateGraph) checks.push('state-graph');
  if (localization) checks.push('localization-non-interference');
  if (firewallSource) checks.push('constant-time-boundary');
  if (opticalInterval) checks.push('optical-interval-containment');
  const required = profile === 'release'
    ? ['optical-model', 'weibull-model', 'decision-model', 'state-graph', 'localization-non-interference', 'constant-time-boundary', 'optical-interval-containment']
    : ['optical-model', 'weibull-model', 'decision-model'];
  const omitted = required.filter(name => !checks.includes(name));
  const status = profile === 'release'
    ? (omitted.length ? 'PASS_PARTIAL' : 'PASS_COMPLETE')
    : (omitted.length ? 'PASS_PARTIAL' : 'PASS_CORE');
  return freezeResult({
    status, profile, requiredChecks: required, omittedChecks: omitted, mode: 'bounded-property-and-contract-verification', domainVersion,
    soundnessBoundary: 'Results prove only explicit finite domains, supplied deterministic evaluators, static security contracts, and declared numerical bounds; they do not prove universal absence of vulnerabilities, equal CPU cycles, production capacity, or physical measurement truth.',
    totalChecks: results.reduce((sum, result) => sum + Number(result.checks || 1), 0),
    results,
    certificateMaterial: stable(results)
  });
}

module.exports = Object.freeze({
  verifyOpticalModel,
  verifyWeibullModel,
  verifyDecisionModel,
  verifyStateGraph,
  verifyLocalizationNonInterference,
  verifyConstantTimeBoundary,
  verifyOpticalInterval,
  runFormalVerification
});

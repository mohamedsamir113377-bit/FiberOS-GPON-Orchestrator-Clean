'use strict';

/**
 * Digital-twin layer architecture, Zero-Trust governance and simulation drift.
 * Concept sources (public): AI-Powered Digital Twins (H. Nelson, Wiley) — the
 * layered engineering architecture — and Digital Twins: Core Principles and AI
 * Integration (B. Tekinerdogan, Morgan Kaufmann) — modelling & data integration.
 * Pure; no simulation runtime is executed here.
 */

const TWIN_LAYERS = Object.freeze([
  Object.freeze({ order: 1, key: 'RAW_INGESTION', label: 'Raw data ingestion', responsibility: 'Collect measurements and telemetry without interpretation.' }),
  Object.freeze({ order: 2, key: 'SEMANTIC_SPINE', label: 'Semantic spine', responsibility: 'Bind raw fields to a governed asset/attribute model.' }),
  Object.freeze({ order: 3, key: 'EVENT_BACKBONE', label: 'Event backbone', responsibility: 'Carry state changes as ordered, replayable events.' }),
  Object.freeze({ order: 4, key: 'NATIVE_CORE', label: 'Native core model', responsibility: 'Hold the authoritative physical/operational model.' }),
  Object.freeze({ order: 5, key: 'STATE_STORE', label: 'State store', responsibility: 'Persist current and historical twin state with lineage.' }),
  Object.freeze({ order: 6, key: 'AGENT_REASONING', label: 'Agent reasoning loops', responsibility: 'Reason over twin state to propose, never to authorise.' }),
  Object.freeze({ order: 7, key: 'SIMULATION', label: 'Simulation engine', responsibility: 'Run scenario and what-if models against the twin.' }),
  Object.freeze({ order: 8, key: 'PREDICTION', label: 'Predictive analytics', responsibility: 'Forecast degradation, faults and signal loss.' }),
  Object.freeze({ order: 9, key: 'GOVERNANCE', label: 'Governance & policy', responsibility: 'Enforce policy, accountability and audit on every action.' }),
  Object.freeze({ order: 10, key: 'SECURITY', label: 'Zero-Trust security', responsibility: 'Authenticate and authorise every hop; no implicit trust.' }),
  Object.freeze({ order: 11, key: 'INTERFACE', label: 'Interface & visualisation', responsibility: 'Expose the twin to operators and field crews.' }),
  Object.freeze({ order: 12, key: 'FEEDBACK', label: 'Feedback & reconciliation', responsibility: 'Reconcile simulated state with observed reality.' })
]);

function validateTwinArchitecture(layers) {
  const provided = new Set((layers || []).map((l) => String(l)));
  const required = TWIN_LAYERS.map((l) => l.key);
  const missing = required.filter((k) => !provided.has(k));
  const unknown = [...provided].filter((k) => !required.includes(k));
  return Object.freeze({ complete: missing.length === 0, missing: Object.freeze(missing), unknown: Object.freeze(unknown), layerCount: required.length });
}

function zeroTrustTwinCheck({ authenticated, authorized, tenantScoped, encryptedInTransit, leastPrivilege }) {
  const checks = { authenticated: !!authenticated, authorized: !!authorized, tenantScoped: !!tenantScoped, encryptedInTransit: !!encryptedInTransit, leastPrivilege: !!leastPrivilege };
  const failures = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return Object.freeze({ passed: failures.length === 0, checks: Object.freeze(checks), failures: Object.freeze(failures) });
}

function simulationDrift({ observed, simulated, tolerancePct = 5 }) {
  if (!Array.isArray(observed) || !Array.isArray(simulated) || observed.length !== simulated.length || observed.length === 0) {
    throw new Error('TWIN_DRIFT_SERIES_INVALID');
  }
  const tol = Number(tolerancePct);
  if (!Number.isFinite(tol) || tol < 0) throw new Error('TWIN_TOLERANCE_INVALID');
  let sumAbs = 0, maxRel = 0, breaches = 0;
  for (let i = 0; i < observed.length; i++) {
    const o = Number(observed[i]), s = Number(simulated[i]);
    if (!Number.isFinite(o) || !Number.isFinite(s)) throw new Error('TWIN_DRIFT_VALUE_INVALID');
    const diff = Math.abs(o - s);
    sumAbs += diff;
    const rel = o === 0 ? (s === 0 ? 0 : Infinity) : (diff / Math.abs(o)) * 100;
    if (rel > maxRel) maxRel = rel;
    if (rel > tol) breaches += 1;
  }
  return Object.freeze({
    meanAbsoluteDrift: Number((sumAbs / observed.length).toFixed(6)),
    maxRelativeDriftPct: Number(maxRel.toFixed(6)),
    breaches,
    withinTolerance: breaches === 0
  });
}

function twinTruthBoundary() {
  return Object.freeze({
    twinIsAuthoritative: false,
    simulationIsAdvisory: true,
    observedRealityPrevails: true,
    note: 'A digital twin is a model, never a substitute for measured reality.'
  });
}

module.exports = { TWIN_LAYERS, validateTwinArchitecture, zeroTrustTwinCheck, simulationDrift, twinTruthBoundary };

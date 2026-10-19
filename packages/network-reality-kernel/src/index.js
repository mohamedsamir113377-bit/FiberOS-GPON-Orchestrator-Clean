'use strict';

const EVIDENCE = new Set(['observed','measured','derived','client_declared','simulated','unverified']);
const LIVE_COMMANDS = new Set(['topology.change','port.claim','service.path.promote','asset.accept','incident.close']);

function finite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(`${name} must be a finite number`);
  return n;
}

function sha256(value) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function classifyObservation(o, verifier = {}) {
  if (!o || typeof o !== 'object') throw new TypeError('REALITY_OBSERVATION_REQUIRED');
  if (o.simulation === true) return 'simulated';
  if (o.clientDeclared === true) return 'client_declared';
  if (o.measured === true && verifier.measurementProof === true) return 'measured';
  if (o.source && verifier.sourceTrusted === true) return 'observed';
  if (o.derivedFromEvidence === true) return 'derived';
  return 'unverified';
}

function assertNoPromotion(from, to, proof = {}) {
  if (!EVIDENCE.has(from) || !EVIDENCE.has(to)) throw new Error('INVALID_EVIDENCE_CLASS');
  if (from === 'simulated' && to !== 'simulated') throw new Error('SIMULATION_CANNOT_SELF_PROMOTE');
  if (from === 'client_declared' && to !== 'client_declared') throw new Error('CLIENT_DATA_CANNOT_SELF_PROMOTE');
  if (from === 'unverified' && to !== 'unverified') throw new Error('UNVERIFIED_EVIDENCE_CANNOT_PROMOTE');
  if (from !== to && proof.externalVerification !== true) throw new Error('EVIDENCE_RECLASSIFICATION_REQUIRES_PROOF');
  return true;
}

function compileClaim({ subjectType, subjectId, assertion, evidence = [], authority = 'database' }) {
  if (!subjectType || !subjectId || !assertion || typeof assertion !== 'object') {
    throw new Error('INVALID_TRUTH_CLAIM');
  }
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error('TRUTH_CLAIM_REQUIRES_EVIDENCE');
  return Object.freeze({
    subjectType: String(subjectType),
    subjectId: String(subjectId),
    assertion,
    evidenceIds: evidence.map(String),
    authority: String(authority),
    claimHash: sha256({ subjectType, subjectId, assertion, evidence })
  });
}

function boundedImpactBudget(budget) {
  const b = budget || {};
  const keys = ['affectedServices','affectedCustomers','affectedCapacity','sharedRiskExposure'];
  const out = {};
  for (const k of keys) {
    const n = Number(b[k] == null ? 0 : b[k]);
    if (!Number.isInteger(n) || n < 0) throw new Error('INVALID_IMPACT_BUDGET');
    out[k] = n;
  }
  return Object.freeze(out);
}

function authorizeCommand({ commandType, policyAllowed, authorizationRef, impact, budget }) {
  if (!LIVE_COMMANDS.has(String(commandType))) throw new Error('COMMAND_TYPE_NOT_ALLOWED');
  if (policyAllowed !== true) throw new Error('COMMAND_POLICY_DENIED');
  if (!authorizationRef) throw new Error('COMMAND_AUTHORIZATION_REQUIRED');
  const actual = boundedImpactBudget(impact);
  const limit = boundedImpactBudget(budget);
  for (const k of Object.keys(limit)) {
    if (actual[k] > limit[k]) throw new Error('COMMAND_IMPACT_BUDGET_EXCEEDED');
  }
  return Object.freeze({ commandType, authorizationRef: String(authorizationRef), impact: actual });
}

function reconstructEffectivePath(versions, at) {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) throw new Error('INVALID_RECONSTRUCTION_TIME');
  const candidates = (versions || []).filter(v => {
    const from = new Date(v.validFrom).getTime();
    const to = v.validTo == null ? Infinity : new Date(v.validTo).getTime();
    return v.state === 'accepted' || v.state === 'live' ? from <= t && t < to : false;
  }).sort((a,b) => Number(b.versionNo || 0) - Number(a.versionNo || 0));
  return candidates[0] ? Object.freeze(candidates[0]) : null;
}

function deriveFailureImpact(edges, failedAssetId, serviceRefs = {}) {
  const id = String(failedAssetId);
  const adj = new Map();
  for (const e of edges || []) {
    if (e.active === false) continue;
    const a = String(e.fromAssetId || e.from_asset_id);
    const b = String(e.toAssetId || e.to_asset_id);
    if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b); adj.get(b).push(a);
  }
  const seen = new Set([id]), q=[id];
  while(q.length){ const x=q.shift(); for(const n of adj.get(x)||[]){ if(!seen.has(n)){seen.add(n);q.push(n)} } }
  const services=new Set(), customers=new Set();
  for(const x of seen){ for(const s of serviceRefs[x]?.services||[]) services.add(String(s)); for(const c of serviceRefs[x]?.customers||[]) customers.add(String(c)); }
  return Object.freeze({failedAssetId:id,affectedAssetIds:[...seen],affectedServices:[...services],affectedCustomers:[...customers]});
}

function auditTopology(nodes, edges) {
  const ids=new Set((nodes||[]).map(n=>String(n.id)));
  const findings=[];
  for(const n of nodes||[]) if(n.parentId && !ids.has(String(n.parentId))) findings.push({code:'MISSING_PARENT',subjectId:String(n.id),severity:'HIGH'});
  const seenEdges=new Set();
  for(const e of edges||[]) { const key=[e.fromAssetId||e.from_asset_id,e.toAssetId||e.to_asset_id,e.relation].join('|'); if(seenEdges.has(key)) findings.push({code:'DUPLICATE_EDGE',severity:'HIGH',key}); seenEdges.add(key); }
  return Object.freeze(findings);
}

function verifyPostCondition({ expectedHash, actualState }) {
  const actualHash = sha256(actualState);
  if (actualHash !== String(expectedHash)) throw new Error('POST_CONDITION_PROOF_FAILED');
  return Object.freeze({ verified: true, postStateHash: actualHash });
}

function normalizeAssetSemantics({ assetType, registry = [] } = {}) {
  const raw = String(assetType || '').trim();
  if (!raw) throw new Error('ASSET_TYPE_REQUIRED');
  const exact = registry.find(r => String(r.normalizedClass).trim().toUpperCase() === raw.toUpperCase());
  if (exact) return Object.freeze({ ...exact, matchedBy: 'normalized_class' });
  const folded = raw.toLowerCase();
  const alias = registry.find(r => (r.aliases || []).some(a => String(a).trim().toLowerCase() === folded));
  if (alias) return Object.freeze({ ...alias, matchedBy: 'alias' });
  throw new Error('ASSET_SEMANTIC_CLASS_UNRESOLVED');
}

function resolveAuthority({ factClass, observations = [], policies = [] } = {}) {
  const relevant = observations.filter(o => String(o.factClass || o.claimType || '') === String(factClass));
  if (!relevant.length) return Object.freeze({ status: 'UNVERIFIED', selected: null, conflicts: [] });
  const ranked = relevant.map(o => {
    const p = policies
      .filter(x => String(x.factClass) === String(factClass) && String(x.sourceClass) === String(o.sourceClass || o.authorityClass))
      .sort((a,b) => Number(a.precedence) - Number(b.precedence))[0];
    return { observation: o, precedence: p ? Number(p.precedence) : Number.MAX_SAFE_INTEGER, policy: p || null };
  }).sort((a,b) => a.precedence - b.precedence);
  const bestPrecedence = ranked[0].precedence;
  const best = ranked.filter(x => x.precedence === bestPrecedence);
  if (best.length > 1) {
    const hashes = new Set(best.map(x => String(x.observation.contentHash || x.observation.hash || JSON.stringify(x.observation.payload))));
    if (hashes.size > 1) return Object.freeze({ status: 'CONFLICTED', selected: null, conflicts: best.map(x => x.observation.id || x.observation.observationId || null) });
  }
  return Object.freeze({ status: 'ADMISSIBLE', selected: best[0].observation, conflicts: [] });
}

function evaluateEvidenceAdmissibility({ claimType, fromClass, toClass, rules = [], externalProof = false } = {}) {
  const rule = rules.find(r =>
    String(r.claimType) === String(claimType) &&
    String(r.fromEvidenceClass) === String(fromClass) &&
    String(r.toEvidenceClass) === String(toClass)
  );
  if (!rule) return Object.freeze({ allowed: false, reason: 'ADMISSIBILITY_RULE_NOT_FOUND' });
  if (rule.allowed !== true) return Object.freeze({ allowed: false, reason: 'ADMISSIBILITY_RULE_DENIED' });
  if (rule.requiresExternalProof === true && externalProof !== true) {
    return Object.freeze({ allowed: false, reason: 'EXTERNAL_PROOF_REQUIRED' });
  }
  return Object.freeze({ allowed: true, reason: null });
}

function compileCanonicalTruth({ factClass, subject, observations = [], authorityPolicies = [], admissibilityRules = [] } = {}) {
  const authority = resolveAuthority({ factClass, observations, policies: authorityPolicies });
  if (authority.status !== 'ADMISSIBLE') {
    return Object.freeze({
      status: authority.status,
      subject,
      factClass,
      selectedObservation: null,
      conflictSet: authority.conflicts
    });
  }
  const selected = authority.selected;
  const evidenceClass = String(selected.evidenceClass || selected.classification || 'unverified');
  const claim = compileClaim({
    subjectType: String(subject?.type || 'UNKNOWN'),
    subjectId: String(subject?.id || ''),
    assertion: selected.payload || selected.assertion || {},
    evidence: selected.evidenceIds || selected.evidence || []
  });
  return Object.freeze({
    status: 'ADMISSIBLE',
    factClass,
    subject,
    selectedObservation: selected,
    claim,
    admissibility: evaluateEvidenceAdmissibility({
      claimType: factClass,
      fromClass: evidenceClass,
      toClass: evidenceClass,
      rules: admissibilityRules,
      externalProof: true
    })
  });
}

function validateNetworkInvariants({
  services = [],
  livePaths = [],
  ports = [],
  cores = [],
  assets = [],
  acceptance = [],
  pathHops = [],
  capacity = []
} = {}) {
  const failures = [];
  const liveByService = new Map();
  for (const p of livePaths.filter(x => x.state === 'live')) {
    const key = String(p.serviceId ?? p.service_id);
    if (liveByService.has(key)) failures.push({ code: 'MULTIPLE_LIVE_SERVICE_PATHS', subjectId: key });
    liveByService.set(key, p);
  }
  for (const s of services.filter(x => x.isActive !== false && x.is_active !== false)) {
    const key = String(s.id);
    if (!liveByService.has(key)) failures.push({ code: 'SERVICE_WITHOUT_LIVE_PATH', subjectId: key });
  }

  const portOwners = new Map();
  for (const p of ports.filter(x => ['used','reserved','connected','active'].includes(String(x.status).toLowerCase()))) {
    const key = String(p.id ?? p.portId);
    if (portOwners.has(key)) failures.push({ code: 'PORT_MULTIPLE_ASSIGNMENT', subjectId: key });
    portOwners.set(key, p);
  }

  const coreOwners = new Map();
  for (const c of cores.filter(x => ['active','spliced','used','connected'].includes(String(x.status).toLowerCase()))) {
    const key = String(c.id ?? c.coreId);
    if (coreOwners.has(key)) failures.push({ code: 'CORE_MULTIPLE_ASSIGNMENT', subjectId: key });
    coreOwners.set(key, c);
  }

  const assetMap = new Map(assets.map(a => [String(a.id), a]));
  for (const a of assets) {
    if (a.mandatoryDependencyId && assetMap.get(String(a.mandatoryDependencyId))?.status === 'retired') {
      failures.push({ code: 'RETIRED_MANDATORY_DEPENDENCY', subjectId: String(a.id) });
    }
  }

  for (const g of acceptance) {
    if ((g.targetState === 'ACCEPTED' || g.targetState === 'LIVE') &&
        (!g.asBuiltVerified || !g.testVerified || !g.evidenceComplete)) {
      failures.push({ code: 'ACCEPTANCE_EVIDENCE_INCOMPLETE', subjectId: String(g.entityId) });
    }
  }

  const nodeIds = new Set(assets.map(a => String(a.id)));
  for (const h of pathHops) {
    for (const id of [h.fromAssetId,h.toAssetId].filter(Boolean)) {
      if (!nodeIds.has(String(id))) failures.push({ code: 'PATH_HOP_UNKNOWN_ASSET', subjectId: String(id) });
    }
  }

  for (const c of capacity) {
    if (Number(c.available ?? c.availableCount) < 0) failures.push({ code: 'NEGATIVE_DERIVED_CAPACITY', subjectId: String(c.assetId ?? c.id) });
  }
  return Object.freeze({ valid: failures.length === 0, failures });
}

function conservationBalance({ start, consumed = 0, returned = 0 } = {}) {
  const s = Number(start), c = Number(consumed), r = Number(returned);
  if (![s,c,r].every(Number.isFinite) || s < 0 || c < 0 || r < 0) throw new Error('INVALID_CONSERVATION_INPUT');
  const remaining = s - c + r;
  if (remaining < 0) throw new Error('CONSERVATION_NEGATIVE_REMAINING');
  return Object.freeze({ start:s, consumed:c, returned:r, remaining });
}

function validateStateTransition({ currentState, requestedState, actor, preconditions = true, requiredEvidence = [], invariantCheck = true } = {}) {
  if (!currentState || !requestedState) throw new Error('STATE_TRANSITION_STATE_REQUIRED');
  if (!actor) throw new Error('STATE_TRANSITION_ACTOR_REQUIRED');
  if (preconditions !== true) throw new Error('STATE_TRANSITION_PRECONDITION_FAILED');
  if (!invariantCheck) throw new Error('STATE_TRANSITION_INVARIANT_FAILED');
  if (!Array.isArray(requiredEvidence)) throw new Error('STATE_TRANSITION_EVIDENCE_INVALID');
  return Object.freeze({
    allowed: true,
    currentState: String(currentState),
    requestedState: String(requestedState),
    actor: String(actor),
    requiredEvidence: requiredEvidence.map(String)
  });
}

function buildProofCarryingCommand({
  commandId, idempotencyKey, requestHash, actor, tenant, authorization,
  intent, targetVersion, preconditions, expectedImpact, requiredEvidence,
  rollbackPlan, policyDecision, executionResult = {}, postconditions = [], proofReferences = []
} = {}) {
  const required = [
    ['commandId', commandId], ['idempotencyKey', idempotencyKey], ['requestHash', requestHash],
    ['actor', actor], ['tenant', tenant], ['authorization', authorization], ['intent', intent]
  ];
  for (const [name, value] of required) if (!value) throw new Error(`COMMAND_${name.toUpperCase()}_REQUIRED`);
  if (!preconditions) throw new Error('COMMAND_PRECONDITIONS_REQUIRED');
  if (!rollbackPlan) throw new Error('COMMAND_ROLLBACK_REQUIRED');
  return Object.freeze({
    commandId:String(commandId), idempotencyKey:String(idempotencyKey), requestHash:String(requestHash),
    actor:String(actor), tenant:String(tenant), authorization, intent:String(intent),
    targetVersion: targetVersion == null ? null : Number(targetVersion),
    preconditions, expectedImpact:boundedImpactBudget(expectedImpact),
    requiredEvidence:(requiredEvidence || []).map(String),
    rollbackPlan, policyDecision, executionResult,
    postconditions:Array.isArray(postconditions) ? postconditions : [],
    proofReferences:Array.isArray(proofReferences) ? proofReferences : []
  });
}

function simulateCounterfactual({ state, delta, recompute } = {}) {
  if (!state || typeof state !== 'object') throw new Error('SIMULATION_STATE_REQUIRED');
  if (typeof recompute !== 'function') throw new Error('SIMULATION_RECOMPUTE_REQUIRED');
  const baseline = JSON.parse(JSON.stringify(state));
  const hypothetical = JSON.parse(JSON.stringify(state));
  if (delta && typeof delta === 'object') Object.assign(hypothetical, JSON.parse(JSON.stringify(delta)));
  const result = recompute(hypothetical, baseline);
  return Object.freeze({ status:'SIMULATED', baseline, hypothetical, result });
}

function classifyCausalRelation({ supporting = [], contradicting = [], fieldConfirmed = false } = {}) {
  if (fieldConfirmed === true) return 'CAUSALLY_CONFIRMED';
  if (supporting.length > 0 && contradicting.length > 0) return 'UNKNOWN';
  if (supporting.length > 0) return 'CORRELATED';
  return 'SUSPECTED';
}

function buildUncertaintyTruth({ state = 'UNKNOWN', authorityClass, evidenceIds = [], freshness, measurementUncertainty = {}, conflictSet = [], verificationMethod, lastVerifiedAt } = {}) {
  const allowed = new Set(['CONFIRMED','PROBABLE','CORRELATED','UNVERIFIED','CONFLICTED','STALE','UNKNOWN']);
  if (!allowed.has(String(state))) throw new Error('UNCERTAINTY_STATE_INVALID');
  return Object.freeze({
    truthState:String(state), authorityClass: authorityClass ? String(authorityClass) : null,
    evidenceIds: evidenceIds.map(String), freshness: freshness || null,
    measurementUncertainty, conflictSet: conflictSet.map(String),
    verificationMethod: verificationMethod || null, lastVerifiedAt: lastVerifiedAt || null
  });
}

function replayTimeline(events = [], at) {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) throw new Error('INVALID_REPLAY_TIME');
  const ordered = events
    .filter(e => new Date(e.eventTime ?? e.occurredAt ?? e.createdAt).getTime() <= t)
    .sort((a,b) => {
      const ta = new Date(a.eventTime ?? a.occurredAt ?? a.createdAt).getTime();
      const tb = new Date(b.eventTime ?? b.occurredAt ?? b.createdAt).getTime();
      return ta - tb || Number(a.sequenceNo ?? a.sequence ?? 0) - Number(b.sequenceNo ?? b.sequence ?? 0);
    });
  return Object.freeze(ordered.map(e => Object.freeze({ ...e })));
}

function enforceSafetyBudget(actual, budget) {
  const a = boundedImpactBudget(actual), b = boundedImpactBudget(budget);
  for (const k of Object.keys(b)) if (a[k] > b[k]) {
    return Object.freeze({ allowed:false, reason:'IMPACT_BUDGET_EXCEEDED', key:k, actual:a[k], limit:b[k] });
  }
  return Object.freeze({ allowed:true, reason:null, actual:a, budget:b });
}

function validateCapabilityClaim(claim = {}) {
  const allowed = new Set(['IMPLEMENTED','CI-VERIFIED','RUNTIME-VERIFIED','REFERENCE-VERIFIED','BUYER-ENVIRONMENT-REQUIRED','DESIGN-ONLY','NOT-IMPLEMENTED']);
  if (!claim.claimId || !claim.capability || !claim.sourceReference || !allowed.has(String(claim.status))) {
    throw new Error('CAPABILITY_CLAIM_INVALID');
  }
  if (claim.status === 'RUNTIME-VERIFIED' && (!claim.ciReference || !claim.proofDate || !claim.runtimeRequirement)) {
    throw new Error('RUNTIME_CLAIM_REQUIRES_CI_RUNTIME_PROOF');
  }
  return Object.freeze({ ...claim });
}

function validateOpticalEvidence({ evidenceClass='unverified', evidenceIds=[], sourceTrusted=false, measurementProof=false, derivationProof=false, instrumentId=null, calibrationId=null } = {}) {
  const cls=String(evidenceClass);
  if(!EVIDENCE.has(cls)) throw new Error('OPTICAL_EVIDENCE_CLASS_INVALID');
  if(!Array.isArray(evidenceIds)||evidenceIds.length===0) throw new Error('OPTICAL_EVIDENCE_REQUIRED');
  if(cls==='observed'&&sourceTrusted!==true) return Object.freeze({admissible:false,status:'UNVERIFIED',reason:'TRUSTED_SOURCE_PROOF_REQUIRED'});
  if(cls==='measured'&&(measurementProof!==true||!instrumentId||!calibrationId)) return Object.freeze({admissible:false,status:'UNVERIFIED',reason:'MEASUREMENT_PROVENANCE_REQUIRED',instrumentId:instrumentId||null,calibrationId:calibrationId||null});
  if(cls==='derived'&&derivationProof!==true) return Object.freeze({admissible:false,status:'UNVERIFIED',reason:'DERIVATION_PROOF_REQUIRED'});
  if(cls==='simulated') return Object.freeze({admissible:false,status:'SIMULATED',reason:'SIMULATION_CANNOT_ASSERT_FIELD_TRUTH'});
  if(cls==='client_declared') return Object.freeze({admissible:false,status:'CLIENT_DECLARED',reason:'CLIENT_DATA_NOT_AUTHORITATIVE'});
  if(cls==='unverified') return Object.freeze({admissible:false,status:'UNVERIFIED',reason:'EVIDENCE_NOT_VERIFIED'});
  return Object.freeze({admissible:true,status:cls.toUpperCase(),reason:null,evidenceIds:evidenceIds.map(String),instrumentId:instrumentId?String(instrumentId):null,calibrationId:calibrationId?String(calibrationId):null});
}

function assessOpticalAssurance({
  currentRxDbm,
  expectedRxDbm,
  measurementStdDb = 0,
  modelStdDb = 0,
  previousRxDbm = null,
  alarms = [],
  peerObservations = [],
  servicePathVersionId = null,
  serviceId = null,
  pathHopOrdinals = null
} = {}) {
  const current = finite(currentRxDbm, 'currentRxDbm');
  const expected = finite(expectedRxDbm, 'expectedRxDbm');
  const residual = current - expected;
  const sigma = Math.sqrt(Math.max(0, finite(measurementStdDb, 'measurementStdDb')) ** 2 + Math.max(0, finite(modelStdDb, 'modelStdDb')) ** 2);
  const delta = previousRxDbm == null ? null : current - finite(previousRxDbm, 'previousRxDbm');
  const hasCriticalAlarm = alarms.some(a => String(a.severity || '').toUpperCase() === 'CRITICAL');
  const hasMajorAlarm = alarms.some(a => String(a.severity || '').toUpperCase() === 'MAJOR');
  const contradictoryPeer = peerObservations.some(o => o.conflicts === true || String(o.status || '').toUpperCase() === 'CONFLICTED');
  let assuranceState = 'HEALTHY';
  if (contradictoryPeer) assuranceState = 'CONFLICTED';
  else if (hasCriticalAlarm || hasMajorAlarm) assuranceState = 'ALARM_CORRELATED';
  else if (residual < 0 || (delta != null && delta < 0 && Math.abs(delta) >= 1)) assuranceState = 'DEGRADED';
  const pathBound = servicePathVersionId != null;
  return Object.freeze({
    assuranceState,
    currentRxDbm: current,
    expectedRxDbm: expected,
    residualDb: residual,
    residualSigmaDb: sigma,
    historicalDeltaDb: delta,
    alarmCount: alarms.length,
    criticalOrMajorAlarm: hasCriticalAlarm || hasMajorAlarm,
    peerObservationCount: peerObservations.length,
    forecasted: false,
    reason: assuranceState === 'DEGRADED' ? 'OBSERVED_OR_DERIVED_DEGRADATION' : null,
    servicePathVersionId: pathBound ? String(servicePathVersionId) : null,
    serviceId: serviceId != null ? String(serviceId) : null,
    pathHopOrdinals: Array.isArray(pathHopOrdinals)
      ? Object.freeze(pathHopOrdinals.map((n) => {
          const v = Number(n);
          if (!Number.isFinite(v) || v <= 0) throw new TypeError('pathHopOrdinals must be positive finite numbers');
          return v;
        }))
      : null,
    pathBound
  });
}

/**
 * Compile a ledger-ready optical-assurance record bound to a service-path version.
 * Requires explicit path identity; refuses to compile without it (path-only binding).
 * Does not write to the database and does not claim instrument proof.
 */
function compileOpticalAssuranceLedgerRecord({
  tenantId,
  servicePathVersionId,
  serviceId = null,
  assetId = null,
  portId = null,
  currentMeasurementId = null,
  previousMeasurementId = null,
  assessment,
  evidenceIds = [],
  method = 'path_bound_residual',
  alarmSignalIds = [],
  peerObservationIds = []
} = {}) {
  if (!tenantId) throw new Error('OPTICAL_ASSURANCE_TENANT_REQUIRED');
  if (!servicePathVersionId) throw new Error('OPTICAL_ASSURANCE_SERVICE_PATH_VERSION_REQUIRED');
  if (!assessment || typeof assessment !== 'object') throw new Error('OPTICAL_ASSURANCE_ASSESSMENT_REQUIRED');
  if (assessment.pathBound !== true || assessment.servicePathVersionId == null) {
    throw new Error('OPTICAL_ASSURANCE_PATH_BINDING_REQUIRED');
  }
  if (String(assessment.servicePathVersionId) !== String(servicePathVersionId)) {
    throw new Error('OPTICAL_ASSURANCE_PATH_VERSION_MISMATCH');
  }
  const allowed = new Set(['HEALTHY', 'DEGRADED', 'ALARM_CORRELATED', 'CONFLICTED', 'UNVERIFIED']);
  const state = String(assessment.assuranceState || '');
  if (!allowed.has(state)) throw new Error('OPTICAL_ASSURANCE_STATE_INVALID');
  if (!Array.isArray(evidenceIds)) throw new TypeError('evidenceIds must be an array');

  const record = Object.freeze({
    schema: 'fiberos.optical-assurance-ledger-record.v1',
    tenantId: String(tenantId),
    servicePathVersionId: String(servicePathVersionId),
    serviceId: serviceId != null ? String(serviceId) : (assessment.serviceId || null),
    assetId: assetId != null ? String(assetId) : null,
    portId: portId != null ? String(portId) : null,
    currentMeasurementId: currentMeasurementId != null ? String(currentMeasurementId) : null,
    previousMeasurementId: previousMeasurementId != null ? String(previousMeasurementId) : null,
    expectedRxDbm: assessment.expectedRxDbm,
    currentRxDbm: assessment.currentRxDbm,
    residualDb: assessment.residualDb,
    residualSigmaDb: assessment.residualSigmaDb,
    alarmSignalIds: Object.freeze((alarmSignalIds || []).map(String)),
    peerObservationIds: Object.freeze((peerObservationIds || []).map(String)),
    assuranceState: state,
    assessmentResult: Object.freeze({
      historicalDeltaDb: assessment.historicalDeltaDb,
      criticalOrMajorAlarm: assessment.criticalOrMajorAlarm === true,
      pathHopOrdinals: assessment.pathHopOrdinals || null,
      pathBound: true,
      forecasted: false
    }),
    evidenceIds: Object.freeze(evidenceIds.map(String)),
    method: String(method),
    contentHash: sha256({
      tenantId,
      servicePathVersionId,
      serviceId,
      assetId,
      portId,
      assessment: {
        assuranceState: state,
        residualDb: assessment.residualDb,
        residualSigmaDb: assessment.residualSigmaDb,
        currentRxDbm: assessment.currentRxDbm,
        expectedRxDbm: assessment.expectedRxDbm
      },
      evidenceIds
    }),
    note: 'Ledger-shaped compile only; persistence and instrument verification remain external.'
  });
  return record;
}

function buildProofGraph({ claim, object, relationship, observation, evidence, actor, device, time, location, method, measurement, instrument, calibration, integrity, acceptance } = {}) {
  const raw = [
    ['CLAIM',claim],['OBJECT',object],['RELATIONSHIP',relationship],['OBSERVATION',observation],
    ['EVIDENCE',evidence],['ACTOR',actor],['DEVICE',device],['TIME',time],['LOCATION',location],
    ['METHOD',method],['MEASUREMENT',measurement],['INSTRUMENT',instrument],['CALIBRATION',calibration],
    ['HASH',integrity],['ACCEPTANCE',acceptance]
  ].filter(([,v]) => v != null);
  if (!raw.length) throw new Error('PROOF_GRAPH_EMPTY');
  const nodes = raw.map(([nodeType,value], index) => {
    const key = typeof value === 'string' ? value : (value.id || value.key || String(index));
    const hash = sha256(JSON.stringify({domain:'fiberos.proof-graph.v1',nodeType,key,value}));
    return Object.freeze({nodeType,nodeKey:String(key),payload:value,nodeHash:hash,ordinal:index+1});
  });
  const edges = [];
  for(let i=1;i<nodes.length;i++){
    edges.push(Object.freeze({
      fromNodeKey:nodes[i-1].nodeKey,
      toNodeKey:nodes[i].nodeKey,
      relation:`PROVES_${nodes[i].nodeType}`,
      ordinal:i,
      edgeHash:sha256(JSON.stringify({from:nodes[i-1].nodeKey,to:nodes[i].nodeKey,ordinal:i}))
    }));
  }
  return Object.freeze({nodes,edges,complete:nodes.some(n=>n.nodeType==='CLAIM') && nodes.some(n=>n.nodeType==='EVIDENCE')});
}

function buildStateTransitionRecord(input = {}) {
  const required=['tenantId','entityType','entityId','fromState','toState','status','transitionHash'];
  for(const k of required) if(input[k] == null || input[k]==='') throw new Error(`STATE_TRANSITION_${k.toUpperCase()}_REQUIRED`);
  return Object.freeze({
    tenantId:String(input.tenantId),
    entityType:String(input.entityType),
    entityId:String(input.entityId),
    fromState:String(input.fromState),
    toState:String(input.toState),
    commandId:input.commandId||null,
    actorId:input.actorId||null,
    policyVersion:input.policyVersion||null,
    preconditionsResult:input.preconditionsResult||{},
    evidenceIds:(input.evidenceIds||[]).map(String),
    invariantResult:input.invariantResult||{},
    sideEffects:Array.isArray(input.sideEffects)?input.sideEffects:[],
    postconditions:Array.isArray(input.postconditions)?input.postconditions:[],
    transitionHash:String(input.transitionHash),
    status:String(input.status)
  });
}

function evaluateSafetyBudget(actual={}, budget={}) {
  const limits=[
    ['affectedCustomers','maxAffectedCustomers'],
    ['affectedServices','maxAffectedServices'],
    ['capacityLoss','maxCapacityLoss'],
    ['sharedRiskDomains','maxSharedRiskDomains']
  ];
  for(const [actualKey,limitKey] of limits){
    if(budget[limitKey] != null && Number(actual[actualKey]||0) > Number(budget[limitKey])){
      return Object.freeze({allowed:false,reason:'SAFETY_BUDGET_EXCEEDED',dimension:actualKey,actual:Number(actual[actualKey]||0),limit:Number(budget[limitKey])});
    }
  }
  return Object.freeze({allowed:true,reason:null});
}

function buildControlCycle({ correlationId, stage, input, output, policyVersion, commandId, autonomous=false } = {}) {
  const allowed=new Set(['MONITOR','ANALYZE','REFLECT','DECIDE','POLICY','AUTH','EXECUTE','VERIFY','ROLLBACK','COMMIT','LEARN']);
  if(!correlationId) throw new Error('CONTROL_CORRELATION_ID_REQUIRED');
  if(!allowed.has(String(stage))) throw new Error('CONTROL_STAGE_INVALID');
  if(autonomous === true) throw new Error('AUTONOMOUS_CONTROL_DISABLED');
  return Object.freeze({
    correlationId:String(correlationId),
    stage:String(stage),
    inputHash:sha256(input ?? {}),
    outputHash:output == null ? null : sha256(output),
    policyVersion:policyVersion||null,
    commandId:commandId||null,
    autonomous:false,
    result:output ?? {}
  });
}


function recoverControlCycle({ priorStage, desiredStage = 'ROLLBACK', commandId, verifiedPostCondition = false, idempotencyKey, reauthorizationRef } = {}) {
  const stages = new Set(['MONITOR','ANALYZE','REFLECT','DECIDE','POLICY','AUTH','EXECUTE','VERIFY','ROLLBACK','COMMIT','LEARN']);
  if (!stages.has(String(priorStage))) throw new Error('RECOVERY_PRIOR_STAGE_INVALID');
  if (!stages.has(String(desiredStage))) throw new Error('RECOVERY_TARGET_STAGE_INVALID');
  if (!commandId) throw new Error('RECOVERY_COMMAND_ID_REQUIRED');
  if (!idempotencyKey) throw new Error('RECOVERY_IDEMPOTENCY_KEY_REQUIRED');
  if (String(priorStage) === 'COMMIT') return Object.freeze({ recoverable:false, reason:'COMMITTED_STATE_REQUIRES_COMPENSATING_COMMAND', nextStage:'ROLLBACK' });
  if (!reauthorizationRef) throw new Error('RECOVERY_REAUTHORIZATION_REQUIRED');
  if (String(priorStage) === 'VERIFY' && verifiedPostCondition === true) return Object.freeze({
    recoverable:true,
    reason:'POSTCONDITION_ALREADY_VERIFIED_REAUTHORIZATION_REQUIRED',
    priorStage:'VERIFY',
    nextStage:'COMMIT',
    commandId:String(commandId),
    idempotencyKey:String(idempotencyKey),
    reauthorizationRef:String(reauthorizationRef),
    requiresReauthorization:true,
    autonomous:false
  });
  if (String(desiredStage) === 'COMMIT') throw new Error('RECOVERY_CANNOT_SKIP_VERIFICATION');
  return Object.freeze({
    recoverable:true,
    reason:'INTERRUPTED_CONTROL_CYCLE',
    priorStage:String(priorStage),
    nextStage:String(desiredStage),
    commandId:String(commandId),
    idempotencyKey:String(idempotencyKey),
    reauthorizationRef:String(reauthorizationRef),
    requiresReauthorization:true,
    autonomous:false
  });
}

module.exports = {
  finite,
  EVIDENCE: Object.freeze([...EVIDENCE]),
  classifyObservation,
  assertNoPromotion,
  compileClaim,
  boundedImpactBudget,
  authorizeCommand,
  verifyPostCondition,
  reconstructEffectivePath,
  deriveFailureImpact,
  auditTopology,
  sha256,
  normalizeAssetSemantics,
  resolveAuthority,
  evaluateEvidenceAdmissibility,
  compileCanonicalTruth,
  validateNetworkInvariants,
  conservationBalance,
  validateStateTransition,
  buildProofCarryingCommand,
  simulateCounterfactual,
  classifyCausalRelation,
  buildUncertaintyTruth,
  replayTimeline,
  enforceSafetyBudget,
  validateCapabilityClaim,
  assessOpticalAssurance,
  compileOpticalAssuranceLedgerRecord,
  validateOpticalEvidence,
  buildProofGraph,
  buildStateTransitionRecord,
  evaluateSafetyBudget,
  buildControlCycle,
  recoverControlCycle
};

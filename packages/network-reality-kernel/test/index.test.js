'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const k = require('../src/index');

test('simulation and client-declared evidence cannot self-promote', () => {
  assert.throws(() => k.assertNoPromotion('simulated','measured'), /SIMULATION_CANNOT_SELF_PROMOTE/);
  assert.throws(() => k.assertNoPromotion('client_declared','observed'), /CLIENT_DATA_CANNOT_SELF_PROMOTE/);
  assert.throws(() => k.assertNoPromotion('unverified','observed'), /UNVERIFIED_EVIDENCE_CANNOT_PROMOTE/);
});

test('claim compilation requires evidence and is content-addressed', () => {
  const c = k.compileClaim({
    subjectType:'PHYSICAL_ASSET',
    subjectId:'asset-1',
    assertion:{status:'live'},
    evidence:['e-1']
  });
  assert.equal(c.evidenceIds[0], 'e-1');
  assert.match(c.claimHash, /^[a-f0-9]{64}$/);
  assert.throws(() => k.compileClaim({subjectType:'x',subjectId:'y',assertion:{}}), /TRUTH_CLAIM_REQUIRES_EVIDENCE/);
});

test('commands require policy, authorization and bounded impact', () => {
  assert.throws(() => k.authorizeCommand({
    commandType:'topology.change',policyAllowed:false,authorizationRef:'a',
    impact:{affectedCustomers:1},budget:{affectedCustomers:2}
  }), /COMMAND_POLICY_DENIED/);
  assert.throws(() => k.authorizeCommand({
    commandType:'topology.change',policyAllowed:true,authorizationRef:'a',
    impact:{affectedCustomers:3},budget:{affectedCustomers:2}
  }), /COMMAND_IMPACT_BUDGET_EXCEEDED/);
  const c = k.authorizeCommand({
    commandType:'topology.change',policyAllowed:true,authorizationRef:'a',
    impact:{affectedCustomers:1},budget:{affectedCustomers:2}
  });
  assert.equal(c.impact.affectedCustomers,1);
});

test('post-condition verification is deterministic', () => {
  const state={asset:'a',status:'live'};
  const hash=k.sha256(state);
  assert.equal(k.verifyPostCondition({expectedHash:hash,actualState:state}).verified,true);
  assert.throws(() => k.verifyPostCondition({expectedHash:hash,actualState:{asset:'a',status:'failed'}}), /POST_CONDITION_PROOF_FAILED/);
});

test('temporal reconstruction selects the effective accepted/live version', () => {
  const p = k.reconstructEffectivePath([
    {versionNo:1,validFrom:'2026-01-01T00:00:00Z',validTo:'2026-02-01T00:00:00Z',state:'live'},
    {versionNo:2,validFrom:'2026-02-01T00:00:00Z',validTo:null,state:'live'}
  ], '2026-03-01T00:00:00Z');
  assert.equal(p.versionNo,2);
});

test('failure impact is bounded to connected topology', () => {
  const r = k.deriveFailureImpact([
    {fromAssetId:'a',toAssetId:'b',active:true},
    {fromAssetId:'b',toAssetId:'c',active:true},
    {fromAssetId:'x',toAssetId:'y',active:true}
  ], 'a', {b:{services:['s1']},c:{customers:['c1']}});
  assert.deepEqual(r.affectedAssetIds.sort(),['a','b','c']);
  assert.deepEqual(r.affectedServices,['s1']);
  assert.deepEqual(r.affectedCustomers,['c1']);
});

test('topology audit detects missing parents and duplicate edges', () => {
  const f = k.auditTopology([{id:'a'},{id:'b',parentId:'missing'}], [
    {fromAssetId:'a',toAssetId:'b',relation:'fiber'},
    {fromAssetId:'a',toAssetId:'b',relation:'fiber'}
  ]);
  assert.equal(f.some(x=>x.code==='MISSING_PARENT'),true);
  assert.equal(f.some(x=>x.code==='DUPLICATE_EDGE'),true);
});


test('asset semantics resolve normalized class or declared alias only', () => {
  assert.equal(k.normalizeAssetSemantics({
    assetType:'MAIN_BOX',
    registry:[{normalizedClass:'MAIN_BOX',aliases:['FDB','FAT']}]
  }).matchedBy,'normalized_class');
  assert.equal(k.normalizeAssetSemantics({
    assetType:'FDB',
    registry:[{normalizedClass:'MAIN_BOX',aliases:['FDB','FAT']}]
  }).normalizedClass,'MAIN_BOX');
  assert.throws(() => k.normalizeAssetSemantics({assetType:'mystery',registry:[]}), /ASSET_SEMANTIC_CLASS_UNRESOLVED/);
});

test('authority resolution refuses equal-precedence conflicting observations', () => {
  const result=k.resolveAuthority({
    factClass:'PHYSICAL_LOCATION',
    observations:[
      {id:'o1',factClass:'PHYSICAL_LOCATION',sourceClass:'FIELD',contentHash:'a'},
      {id:'o2',factClass:'PHYSICAL_LOCATION',sourceClass:'FIELD',contentHash:'b'}
    ],
    policies:[{factClass:'PHYSICAL_LOCATION',sourceClass:'FIELD',precedence:1}]
  });
  assert.equal(result.status,'CONFLICTED');
  assert.deepEqual(result.conflicts.sort(),['o1','o2']);
});

test('evidence admissibility obeys declared rule and external proof', () => {
  const rule={claimType:'PORT_ACTIVE',fromEvidenceClass:'client_declared',toEvidenceClass:'measured',requiresExternalProof:true,allowed:true};
  assert.deepEqual(k.evaluateEvidenceAdmissibility({claimType:'PORT_ACTIVE',fromClass:'client_declared',toClass:'measured',rules:[rule],externalProof:false}).allowed,false);
  assert.deepEqual(k.evaluateEvidenceAdmissibility({claimType:'PORT_ACTIVE',fromClass:'client_declared',toClass:'measured',rules:[rule],externalProof:true}).allowed,true);
});

test('network invariants detect duplicate live paths and unknown hops', () => {
  const r=k.validateNetworkInvariants({
    services:[{id:'s1',isActive:true}],
    livePaths:[{serviceId:'s1',state:'live'},{serviceId:'s1',state:'live'}],
    assets:[{id:'a1',status:'active'}],
    pathHops:[{fromAssetId:'a1',toAssetId:'missing'}],
    capacity:[{assetId:'a1',available:-1}]
  });
  assert.equal(r.valid,false);
  assert.equal(r.failures.some(x=>x.code==='MULTIPLE_LIVE_SERVICE_PATHS'),true);
  assert.equal(r.failures.some(x=>x.code==='PATH_HOP_UNKNOWN_ASSET'),true);
  assert.equal(r.failures.some(x=>x.code==='NEGATIVE_DERIVED_CAPACITY'),true);
});

test('conservation balance never permits unexplained negative remainder', () => {
  assert.deepEqual(k.conservationBalance({start:100,consumed:60,returned:5}).remaining,45);
  assert.throws(()=>k.conservationBalance({start:10,consumed:11,returned:0}),/CONSERVATION_NEGATIVE_REMAINING/);
});

test('state transition and proof-carrying command require authority boundary inputs', () => {
  assert.throws(()=>k.validateStateTransition({currentState:'installed',requestedState:'accepted',actor:'a',preconditions:false}),/STATE_TRANSITION_PRECONDITION_FAILED/);
  const cmd=k.buildProofCarryingCommand({
    commandId:'cmd-1',idempotencyKey:'idem-1',requestHash:'a'.repeat(64),
    actor:'actor-1',tenant:'tenant-1',authorization:{ref:'auth-1'},
    intent:'accept',targetVersion:3,preconditions:{state:'installed'},
    expectedImpact:{affectedCustomers:2},requiredEvidence:['e1'],
    rollbackPlan:{type:'restore'},policyDecision:{allowed:true},
    postconditions:[{status:'accepted'}],proofReferences:['e2']
  });
  assert.equal(cmd.requiredEvidence[0],'e1');
  assert.equal(cmd.expectedImpact.affectedCustomers,2);
});

test('counterfactual is explicit and cannot mutate baseline object', () => {
  const state={status:'live',customers:10};
  const r=k.simulateCounterfactual({state,delta:{status:'failed'},recompute:s=>({customers:s.customers-10})});
  assert.equal(r.status,'SIMULATED');
  assert.equal(state.status,'live');
  assert.equal(r.hypothetical.status,'failed');
});

test('causal and uncertainty outputs preserve epistemic state', () => {
  assert.equal(k.classifyCausalRelation({supporting:['e1'],fieldConfirmed:true}),'CAUSALLY_CONFIRMED');
  assert.equal(k.classifyCausalRelation({supporting:['e1'],contradicting:['e2']}),'UNKNOWN');
  assert.equal(k.buildUncertaintyTruth({state:'CONFLICTED',evidenceIds:['e1'],conflictSet:['c1']}).truthState,'CONFLICTED');
});

test('replay is deterministic by effective event time then sequence', () => {
  const out=k.replayTimeline([
    {id:'b',eventTime:'2026-01-01T00:00:02Z',sequenceNo:2},
    {id:'a',eventTime:'2026-01-01T00:00:01Z',sequenceNo:1}
  ],'2026-01-01T00:00:03Z');
  assert.deepEqual(out.map(x=>x.id),['a','b']);
});

test('safety budget and commercial claim gate fail closed', () => {
  assert.equal(k.enforceSafetyBudget({affectedCustomers:5},{affectedCustomers:3}).allowed,false);
  assert.throws(()=>k.validateCapabilityClaim({
    claimId:'c1',capability:'x',sourceReference:'src',status:'RUNTIME-VERIFIED'
  }),/RUNTIME_CLAIM_REQUIRES_CI_RUNTIME_PROOF/);
});


test('optical assurance uses current/history/alarm/peer evidence without forecasting', () => {
  const healthy=k.assessOpticalAssurance({
    currentRxDbm:-20,expectedRxDbm:-21,previousRxDbm:-20.2,
    measurementStdDb:0.2,modelStdDb:0.1,alarms:[],peerObservations:[]
  });
  assert.equal(healthy.assuranceState,'HEALTHY');
  assert.equal(healthy.forecasted,false);

  const alarmed=k.assessOpticalAssurance({
    currentRxDbm:-24,expectedRxDbm:-21,alarms:[{severity:'CRITICAL'}]
  });
  assert.equal(alarmed.assuranceState,'ALARM_CORRELATED');
});



test('proof graph preserves the prescribed evidence chain shape', () => {
  const g=k.buildProofGraph({
    claim:{id:'c1'},object:{id:'a1'},relationship:{id:'r1'},
    observation:{id:'o1'},evidence:{id:'e1'},actor:{id:'u1'},
    device:{id:'d1'},time:{value:'2026-10-07T00:00:00Z'},method:{id:'m1'},
    measurement:{id:'me1'},instrument:{id:'i1'},calibration:{id:'cal1'},
    integrity:{hash:'a'.repeat(64)},acceptance:{id:'ac1'}
  });
  assert.equal(g.complete,true);
  assert.equal(g.nodes[0].nodeType,'CLAIM');
  assert.equal(g.nodes[g.nodes.length-1].nodeType,'ACCEPTANCE');
});

test('state transition record and control cycle fail closed on autonomous execution', () => {
  const rec=k.buildStateTransitionRecord({
    tenantId:'t1',entityType:'FTTH_CABLE',entityId:'c1',
    fromState:'installed',toState:'accepted',status:'VERIFIED',transitionHash:'h1'
  });
  assert.equal(rec.toState,'accepted');
  assert.throws(()=>k.buildControlCycle({correlationId:'x',stage:'EXECUTE',input:{},autonomous:true}),/AUTONOMOUS_CONTROL_DISABLED/);
  assert.equal(k.buildControlCycle({correlationId:'x',stage:'ANALYZE',input:{a:1}}).autonomous,false);
});

test('safety budget returns the exceeded dimension rather than silently allowing', () => {
  const r=k.evaluateSafetyBudget(
    {affectedCustomers:50,affectedServices:2,capacityLoss:0,sharedRiskDomains:1},
    {maxAffectedCustomers:25,maxAffectedServices:5,maxCapacityLoss:1,maxSharedRiskDomains:2}
  );
  assert.equal(r.allowed,false);
  assert.equal(r.dimension,'affectedCustomers');
});


test('recovery requires reauthorization after interrupted execution and cannot skip verification',()=>{
  const { recoverControlCycle } = require('../src');
  const r=recoverControlCycle({priorStage:'EXECUTE',commandId:'cmd-1',idempotencyKey:'idem-1',reauthorizationRef:'reauth-1'});
  assert.equal(r.recoverable,true);
  assert.equal(r.requiresReauthorization,true);
  assert.equal(r.autonomous,false);
  assert.throws(()=>recoverControlCycle({priorStage:'EXECUTE',desiredStage:'COMMIT',commandId:'cmd-1',idempotencyKey:'idem-1',reauthorizationRef:'reauth-1'}),/RECOVERY_CANNOT_SKIP_VERIFICATION/);
  const committed=recoverControlCycle({priorStage:'COMMIT',commandId:'cmd-2',idempotencyKey:'idem-2',reauthorizationRef:'reauth-2'});
  assert.equal(committed.recoverable,false);
});


test('recovery refuses to resume without explicit reauthorization reference',()=>{assert.throws(()=>k.recoverControlCycle({priorStage:'EXECUTE',commandId:'cmd-1',idempotencyKey:'idem-1'}),/RECOVERY_REAUTHORIZATION_REQUIRED/);});
test('verified interrupted cycle may commit only after reauthorization',()=>{const out=k.recoverControlCycle({priorStage:'VERIFY',verifiedPostCondition:true,commandId:'cmd-2',idempotencyKey:'idem-2',reauthorizationRef:'reauth-2'});assert.equal(out.recoverable,true);assert.equal(out.nextStage,'COMMIT');assert.equal(out.requiresReauthorization,true);});


test('optical evidence validation requires provenance for measured observations and rejects client assertions',()=>{
  assert.deepEqual(k.validateOpticalEvidence({evidenceClass:'measured',evidenceIds:['e1'],measurementProof:false,instrumentId:'inst-1',calibrationId:'cal-1'}).admissible,false);
  assert.equal(k.validateOpticalEvidence({evidenceClass:'measured',evidenceIds:['e1'],measurementProof:true,instrumentId:'inst-1',calibrationId:'cal-1'}).admissible,true);
  assert.equal(k.validateOpticalEvidence({evidenceClass:'client_declared',evidenceIds:['e2']}).status,'CLIENT_DECLARED');
  assert.equal(k.validateOpticalEvidence({evidenceClass:'simulated',evidenceIds:['e3']}).admissible,false);
});

test('assessOpticalAssurance path binding fields', () => {
  const k = require('../src/index.js');
  const a = k.assessOpticalAssurance({
    currentRxDbm: -22,
    expectedRxDbm: -20,
    servicePathVersionId: 'spv-99',
    serviceId: 'svc-9',
    pathHopOrdinals: [1, 2, 3]
  });
  assert.equal(a.pathBound, true);
  assert.equal(a.servicePathVersionId, 'spv-99');
  assert.deepEqual(a.pathHopOrdinals, [1, 2, 3]);
  assert.equal(a.forecasted, false);
});

test('compileOpticalAssuranceLedgerRecord rejects service-path version mismatch', () => {
  const k = require('../src/index.js');
  const assessment = k.assessOpticalAssurance({
    currentRxDbm: -21,
    expectedRxDbm: -20,
    servicePathVersionId: 'spv-actual'
  });
  assert.throws(() => k.compileOpticalAssuranceLedgerRecord({
    tenantId: 't1',
    servicePathVersionId: 'spv-other',
    assessment
  }), /OPTICAL_ASSURANCE_PATH_VERSION_MISMATCH/);
});

test('compileOpticalAssuranceLedgerRecord requires path binding', () => {
  const k = require('../src/index.js');
  const assessment = k.assessOpticalAssurance({
    currentRxDbm: -21,
    expectedRxDbm: -20,
    servicePathVersionId: 'spv-1',
    pathHopOrdinals: [1]
  });
  const rec = k.compileOpticalAssuranceLedgerRecord({
    tenantId: 't1',
    servicePathVersionId: 'spv-1',
    serviceId: 'svc-1',
    assessment,
    evidenceIds: ['e1']
  });
  assert.equal(rec.schema, 'fiberos.optical-assurance-ledger-record.v1');
  assert.equal(rec.assuranceState, assessment.assuranceState);
  assert.ok(rec.contentHash);
  assert.equal(rec.assessmentResult.pathBound, true);
  assert.throws(() => k.compileOpticalAssuranceLedgerRecord({
    tenantId: 't1',
    assessment: k.assessOpticalAssurance({ currentRxDbm: -20, expectedRxDbm: -20 })
  }), /SERVICE_PATH_VERSION_REQUIRED/);
});

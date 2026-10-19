'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {CONTROL_PROOF_SCHEMA,CONTROL_PROOF_PAYLOAD_SCHEMA,canonicalJson,sha256,verifySignedControlProof}=require('../../../packages/core/src/buyerRuntimeProof');
const {RUNTIME_SCHEMA,RUNTIME_PAYLOAD_SCHEMA,ACCEPTANCE_SCHEMA,ACCEPTANCE_PAYLOAD_SCHEMA,BUNDLE_SCHEMA,REQUIRED_RUNTIME_CHECKS,signEnvelope,validateRuntimeAttestation,validateGoLiveAcceptanceBundle}=require('../../../scripts/buyer-acceptance/runtime-go-live-attestation');
const NOW=Date.parse('2026-10-10T12:00:00.000Z'),release={packageVersion:'1.0.0-test',manifestSha256:'a'.repeat(64),sourceCommit:null};
const buyer={organizationId:'buyer-acme',deploymentId:'prod-eu-01',environment:'production'};
function keys(){return crypto.generateKeyPairSync('ed25519');}
function readinessChecks(backend='PROCESS_LOCAL'){return REQUIRED_RUNTIME_CHECKS.map(name=>name==='rateLimitBoundary'?{name,status:'PASS',backend}:{name,status:'PASS'});}
function sign(payload,schema,k,keyId){return signEnvelope(payload,schema,{privateKey:k.privateKey,keyId});}
function proofPayload(extra={}){return {schemaVersion:CONTROL_PROOF_PAYLOAD_SCHEMA,proofType:'backupRestore',result:'PASS',checkedAt:new Date(NOW).toISOString(),environment:'production',
 buyerOrganizationId:buyer.organizationId,deploymentId:buyer.deploymentId,release:{...release},checks:{backupCreated:true,restoreVerified:true,integrityVerified:true},
 evidenceSha256:'b'.repeat(64),evidenceReferences:['evidence-vault://run/CHG-1042'],producer:'buyer-backup-verification-pipeline',...extra};}
function runtimePayload(extra={}){return {schemaVersion:RUNTIME_PAYLOAD_SCHEMA,verificationId:'verify-unique-01',verifiedAt:new Date(NOW).toISOString(),expiresAt:new Date(NOW+24*60*60*1000).toISOString(),
 outcome:'PASS_RUNTIME',proofLevel:'RUNTIME_PRODUCTION',environment:'production',buyer:{...buyer},release:{...release},sourceManifestCheck:{status:'PASS',manifestSha256:release.manifestSha256},
 readiness:{ok:true,productionReady:true,contract:'fiberos.r14.1.runtime-environment-contract.v1',checkedAt:new Date(NOW).toISOString(),
 checks:readinessChecks(),reportSha256:'c'.repeat(64)},...extra};}
function acceptancePayload(runtimeEnvelope,extra={}){return {schemaVersion:ACCEPTANCE_PAYLOAD_SCHEMA,acceptedAt:new Date(NOW).toISOString(),decision:'ACCEPT_FOR_GO_LIVE',acceptedBy:'buyer-release-approver',
 changeReference:'CHG-1042',openCriticalExceptions:0,productionHoldReleaseExecuted:false,environment:'production',buyer:{...buyer},release:{...release},
 runtimeAttestationSha256:sha256(Buffer.from(canonicalJson(runtimeEnvelope),'utf8')),runtimeAttestationKeyId:runtimeEnvelope.signature.keyId,...extra};}
test('signed control proof binds buyer, deployment, exact release and freshness',()=>{const k=keys(),e=sign(proofPayload(),CONTROL_PROOF_SCHEMA,k,'infra-proof-key-1');
 const r=verifySignedControlProof(e,{publicKey:k.publicKey,expectedKeyId:'infra-proof-key-1',proofType:'backupRestore',requiredFields:['backupCreated','restoreVerified','integrityVerified'],
 expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId,expectedRelease:release,now:NOW});assert.equal(r.ok,true,r.failures.join(','));});
test('control proof requires a pinned trusted key ID',()=>{const k=keys(),e=sign(proofPayload(),CONTROL_PROOF_SCHEMA,k,'infra-proof-key-1');const r=verifySignedControlProof(e,{publicKey:k.publicKey,proofType:'backupRestore',requiredFields:['backupCreated','restoreVerified','integrityVerified'],expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId,expectedRelease:release,now:NOW});assert.ok(r.failures.includes('CONTROL_PROOF_EXPECTED_KEY_ID_REQUIRED'));});
test('unsigned boolean-only proof is rejected',()=>{const r=verifySignedControlProof({healthy:true,alertsConfigured:true,backupCreated:true,restoreVerified:true,integrityVerified:true},
 {publicKey:keys().publicKey,expectedKeyId:'infra-proof-key-1',proofType:'backupRestore',requiredFields:['backupCreated','restoreVerified','integrityVerified'],
 expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId,expectedRelease:release,now:NOW});assert.equal(r.ok,false);assert.ok(r.failures.includes('ENVELOPE_SCHEMA_INVALID'));});
test('control proof rejects stale evidence, release drift and tampering',()=>{const k=keys(),o={publicKey:k.publicKey,expectedKeyId:'infra-proof-key-1',proofType:'backupRestore',
 requiredFields:['backupCreated','restoreVerified','integrityVerified'],expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId,expectedRelease:release,now:NOW};
 const stale=sign(proofPayload({checkedAt:new Date(NOW-25*60*60*1000).toISOString()}),CONTROL_PROOF_SCHEMA,k,'infra-proof-key-1');assert.equal(verifySignedControlProof(stale,o).ok,false);
 const mismatch=sign(proofPayload({release:{...release,manifestSha256:'d'.repeat(64)}}),CONTROL_PROOF_SCHEMA,k,'infra-proof-key-1');assert.ok(verifySignedControlProof(mismatch,o).failures.includes('CONTROL_PROOF_RELEASE_MISMATCH'));
 const tampered=sign(proofPayload(),CONTROL_PROOF_SCHEMA,k,'infra-proof-key-1');tampered.payload.checks.restoreVerified=false;assert.ok(verifySignedControlProof(tampered,o).failures.includes('SIGNATURE_INVALID'));});
test('runtime attestation is bound to release and each readiness result',()=>{const k=keys(),e=sign(runtimePayload(),RUNTIME_SCHEMA,k,'buyer-runtime-key-1'),o={publicKey:k.publicKey,expectedKeyId:'buyer-runtime-key-1',expectedRelease:release,
 expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId,now:NOW};const r=validateRuntimeAttestation(e,o);assert.equal(r.ok,true,r.failures.join(','));
 const bad=JSON.parse(JSON.stringify(e));bad.payload.readiness.checks[0].status='FAIL';assert.ok(validateRuntimeAttestation(bad,o).failures.includes('SIGNATURE_INVALID'));});
test('Go-Live acceptance verifies both signatures and binds runtime digest',()=>{const rk=keys(),ak=keys(),re=sign(runtimePayload(),RUNTIME_SCHEMA,rk,'buyer-runtime-key-1'),
 ae=sign(acceptancePayload(re),ACCEPTANCE_SCHEMA,ak,'go-live-approver-key-1'),bundle={schema:BUNDLE_SCHEMA,runtimeAttestation:re,acceptance:ae},
 o={runtimePublicKey:rk.publicKey,runtimeKeyId:'buyer-runtime-key-1',acceptancePublicKey:ak.publicKey,acceptanceKeyId:'go-live-approver-key-1',expectedRelease:release,
 expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId,now:NOW};const r=validateGoLiveAcceptanceBundle(bundle,o);assert.equal(r.ok,true,r.failures.join(','));
 const bad=JSON.parse(JSON.stringify(bundle));bad.acceptance.payload.decision='ACCEPT_WITHOUT_PROOF';assert.ok(validateGoLiveAcceptanceBundle(bad,o).failures.includes('ACCEPTANCE:SIGNATURE_INVALID'));});
test('runtime attestation rejects missing or duplicate required checks and conditional Redis HA omission',()=>{const k=keys(),o={publicKey:k.publicKey,expectedKeyId:'buyer-runtime-key-1',expectedRelease:release,expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId,now:NOW};
 const base=runtimePayload(),missing=runtimePayload({readiness:{...base.readiness,checks:readinessChecks().filter(c=>c.name!=='tlsIngress')}});let r=validateRuntimeAttestation(sign(missing,RUNTIME_SCHEMA,k,'buyer-runtime-key-1'),o);assert.ok(r.failures.includes('RUNTIME_REQUIRED_READINESS_CHECK_MISSING:tlsIngress'));
 const duplicate=runtimePayload({readiness:{...base.readiness,checks:[...readinessChecks(),{name:'database',status:'PASS'}]}});r=validateRuntimeAttestation(sign(duplicate,RUNTIME_SCHEMA,k,'buyer-runtime-key-1'),o);assert.ok(r.failures.includes('RUNTIME_READINESS_CHECK_DUPLICATE:database'));
 const redis=runtimePayload({readiness:{...base.readiness,checks:readinessChecks('REDIS')}});r=validateRuntimeAttestation(sign(redis,RUNTIME_SCHEMA,k,'buyer-runtime-key-1'),o);assert.ok(r.failures.includes('RUNTIME_REQUIRED_READINESS_CHECK_MISSING:redisHighAvailability'));
 const redisComplete=runtimePayload({readiness:{...base.readiness,checks:[...readinessChecks('REDIS'),{name:'redisHighAvailability',status:'PASS'}]}});assert.equal(validateRuntimeAttestation(sign(redisComplete,RUNTIME_SCHEMA,k,'buyer-runtime-key-1'),o).ok,true);
});
test('Go-Live acceptance rejects the same signing key for runtime proof and buyer approval',()=>{const shared=keys(),re=sign(runtimePayload(),RUNTIME_SCHEMA,shared,'buyer-runtime-key-1'),ae=sign(acceptancePayload(re),ACCEPTANCE_SCHEMA,shared,'go-live-approver-key-1'),bundle={schema:BUNDLE_SCHEMA,runtimeAttestation:re,acceptance:ae},r=validateGoLiveAcceptanceBundle(bundle,{runtimePublicKey:shared.publicKey,runtimeKeyId:'buyer-runtime-key-1',acceptancePublicKey:shared.publicKey,acceptanceKeyId:'go-live-approver-key-1',expectedRelease:release,expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId,now:NOW});assert.ok(r.failures.includes('RUNTIME_AND_ACCEPTANCE_SIGNING_KEYS_NOT_DISTINCT'));});
test('Go-Live acceptance rejects critical exceptions and implicit Production Hold release',()=>{const rk=keys(),ak=keys(),re=sign(runtimePayload(),RUNTIME_SCHEMA,rk,'buyer-runtime-key-1'),
 ae=sign(acceptancePayload(re,{openCriticalExceptions:1}),ACCEPTANCE_SCHEMA,ak,'go-live-approver-key-1'),bundle={schema:BUNDLE_SCHEMA,runtimeAttestation:re,acceptance:ae},
 r=validateGoLiveAcceptanceBundle(bundle,{runtimePublicKey:rk.publicKey,runtimeKeyId:'buyer-runtime-key-1',acceptancePublicKey:ak.publicKey,acceptanceKeyId:'go-live-approver-key-1',
 expectedRelease:release,expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId,now:NOW});assert.ok(r.failures.includes('OPEN_CRITICAL_EXCEPTIONS_NOT_ZERO'));});

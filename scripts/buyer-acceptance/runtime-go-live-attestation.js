#!/usr/bin/env node
'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {canonicalJson,sha256,getReleaseIdentity,sameRelease,verifySignedEnvelope}=require('../../packages/core/src/buyerRuntimeProof');
const ROOT=path.resolve(__dirname,'../..'),RUNTIME_SCHEMA='fiberos.r14.1.buyer-runtime-attestation.v1',RUNTIME_PAYLOAD_SCHEMA='fiberos.r14.1.buyer-runtime-attestation-payload.v1',ACCEPTANCE_SCHEMA='fiberos.r14.1.go-live-acceptance.v1',ACCEPTANCE_PAYLOAD_SCHEMA='fiberos.r14.1.go-live-acceptance-payload.v1',BUNDLE_SCHEMA='fiberos.r14.1.go-live-acceptance-bundle.v1',RUNTIME_CONTRACT_SCHEMA='fiberos.r14.1.runtime-environment-contract.v1',REQUIRED_RUNTIME_CHECKS=Object.freeze(['node','npm','database','secretsBoundary','tlsIngress','rlsTenantIsolation','rateLimitBoundary','replayDefense','kernelBoundaryMode','identityOidcJwks','i18nProductionLocales','healthMetricsAlerts','backupRestore','externalAdapters']),MAX_AGE_MS=24*60*60*1000,MAX_FUTURE_SKEW_MS=5*60*1000,SHA256_RE=/^[a-f0-9]{64}$/;
function env(n){return String(process.env[n]||'').trim();}
function requiredEnv(n){const v=env(n);if(!v)throw new Error('REQUIRED_ENV_MISSING:'+n);return v;}
function readJsonFile(f){try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{throw new Error('JSON_EVIDENCE_FILE_INVALID');}}
function signEnvelope(payload,schema,o={}){
 const keyId=String(o.keyId||'').trim();if(!keyId)throw new Error('SIGNING_KEY_ID_REQUIRED');let key=o.privateKey||null;
 if(!key){if(!o.privateKeyFile)throw new Error('SIGNING_PRIVATE_KEY_FILE_REQUIRED');try{key=crypto.createPrivateKey(fs.readFileSync(o.privateKeyFile));}catch{throw new Error('SIGNING_PRIVATE_KEY_UNAVAILABLE');}}
 const sig=crypto.sign(null,Buffer.from(canonicalJson(payload),'utf8'),key);return {schema,payload,signature:{algorithm:'Ed25519',keyId,value:sig.toString('base64')}};
}
function validateTimestamp(v,now,maxAge,prefix){if(typeof v!=='string'||Number.isNaN(Date.parse(v)))return [prefix+'_TIMESTAMP_INVALID'];const t=Date.parse(v);if(t>now+MAX_FUTURE_SKEW_MS)return [prefix+'_TIMESTAMP_FROM_FUTURE'];if(now-t>maxAge)return [prefix+'_TIMESTAMP_EXPIRED'];return [];}
function trustedPublicKey(options,role){const direct=options[role+'PublicKey'];if(direct)return direct&&direct.type==='public'?direct:crypto.createPublicKey(direct);const file=options[role+'PublicKeyFile'];if(!file)throw new Error('TRUSTED_PUBLIC_KEY_REQUIRED');return crypto.createPublicKey(fs.readFileSync(file));}
function publicKeyFingerprint(key){const publicKey=key&&key.type==='public'?key:crypto.createPublicKey(key);return crypto.createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');}
function assertDistinctSigningKeys(runtimeKey,acceptanceKey,runtimeKeyId,acceptanceKeyId){if(typeof runtimeKeyId!=='string'||!runtimeKeyId.trim()||typeof acceptanceKeyId!=='string'||!acceptanceKeyId.trim())throw new Error('RUNTIME_AND_ACCEPTANCE_KEY_IDS_REQUIRED');if(runtimeKeyId===acceptanceKeyId)throw new Error('RUNTIME_AND_ACCEPTANCE_KEY_IDS_NOT_DISTINCT');if(publicKeyFingerprint(runtimeKey)===publicKeyFingerprint(acceptanceKey))throw new Error('RUNTIME_AND_ACCEPTANCE_SIGNING_KEYS_NOT_DISTINCT');}
function runtimeReadinessCheckFailures(checks){const failures=[],byName=new Map();for(const c of checks){if(!c||typeof c.name!=='string'||!c.name.trim()){failures.push('RUNTIME_READINESS_CHECK_NAME_INVALID');continue;}if(byName.has(c.name))failures.push('RUNTIME_READINESS_CHECK_DUPLICATE:'+c.name);else byName.set(c.name,c);}for(const name of REQUIRED_RUNTIME_CHECKS)if(!byName.has(name))failures.push('RUNTIME_REQUIRED_READINESS_CHECK_MISSING:'+name);const limiter=byName.get('rateLimitBoundary');if(limiter&&!['PROCESS_LOCAL','REDIS'].includes(limiter.backend))failures.push('RUNTIME_RATE_LIMIT_BACKEND_INVALID');if(limiter&&limiter.backend==='REDIS'&&!byName.has('redisHighAvailability'))failures.push('RUNTIME_REQUIRED_READINESS_CHECK_MISSING:redisHighAvailability');return failures;}
function validateRuntimeAttestation(envelope,o={}){
 const now=Number.isFinite(o.now)?o.now:Date.now(),sig=verifySignedEnvelope(envelope,{expectedSchema:RUNTIME_SCHEMA,publicKey:o.publicKey,publicKeyFile:o.publicKeyFile,expectedKeyId:o.expectedKeyId}),failures=[...sig.failures],p=sig.payload,add=(c,e)=>{if(!c)failures.push(e);};
 add(typeof o.expectedKeyId==='string'&&o.expectedKeyId.trim().length>0,'RUNTIME_TRUSTED_KEY_ID_REQUIRED');
 if(p){
 add(p.schemaVersion===RUNTIME_PAYLOAD_SCHEMA,'RUNTIME_PAYLOAD_SCHEMA_INVALID');add(p.outcome==='PASS_RUNTIME','RUNTIME_OUTCOME_NOT_PASS');add(p.proofLevel==='RUNTIME_PRODUCTION','RUNTIME_PROOF_LEVEL_INVALID');add(p.environment==='production','RUNTIME_ENVIRONMENT_NOT_PRODUCTION');
 add(p.buyer&&p.buyer.organizationId===o.expectedBuyerOrganizationId,'RUNTIME_BUYER_MISMATCH');add(p.buyer&&p.buyer.deploymentId===o.expectedDeploymentId,'RUNTIME_DEPLOYMENT_MISMATCH');add(sameRelease(p.release,o.expectedRelease),'RUNTIME_RELEASE_MISMATCH');
 add(p.sourceManifestCheck&&p.sourceManifestCheck.status==='PASS'&&p.sourceManifestCheck.manifestSha256===(o.expectedRelease||{}).manifestSha256,'RUNTIME_SOURCE_MANIFEST_NOT_VERIFIED');
 add(p.readiness&&p.readiness.contract===RUNTIME_CONTRACT_SCHEMA,'RUNTIME_READINESS_CONTRACT_INVALID');add(p.readiness&&p.readiness.ok===true&&p.readiness.productionReady===true,'RUNTIME_READINESS_GATE_NOT_PASS');const checks=p.readiness&&p.readiness.checks;add(Array.isArray(checks)&&checks.length>0,'RUNTIME_READINESS_CHECKS_MISSING');
 if(Array.isArray(checks)){for(const c of checks)add(c&&c.status==='PASS','RUNTIME_READINESS_CHECK_FAILED:'+String(c&&c.name||'UNKNOWN'));failures.push(...runtimeReadinessCheckFailures(checks));}
 add(SHA256_RE.test((p.readiness||{}).reportSha256||''),'RUNTIME_READINESS_REPORT_HASH_INVALID');failures.push(...validateTimestamp(p.verifiedAt,now,MAX_AGE_MS,'RUNTIME_ATTESTATION'));
 if(typeof p.expiresAt!=='string'||Number.isNaN(Date.parse(p.expiresAt)))failures.push('RUNTIME_EXPIRY_INVALID');else{const expiry=Date.parse(p.expiresAt),verified=Date.parse(p.verifiedAt);if(!(expiry>now))failures.push('RUNTIME_ATTESTATION_EXPIRED');if(Number.isFinite(verified)&&expiry>verified+MAX_AGE_MS+60000)failures.push('RUNTIME_EXPIRY_EXCEEDS_MAXIMUM');}
 }
 return {ok:failures.length===0,failures:[...new Set(failures)],payload:p,keyId:sig.keyId};
}
function validateGoLiveAcceptanceBundle(bundle,o={}){
 const now=Number.isFinite(o.now)?o.now:Date.now(),failures=[];
 if(!bundle||typeof bundle!=='object'||Array.isArray(bundle)||bundle.schema!==BUNDLE_SCHEMA)return {ok:false,failures:['GO_LIVE_BUNDLE_SCHEMA_INVALID']};
 if(typeof o.runtimeKeyId!=='string'||!o.runtimeKeyId.trim()||typeof o.acceptanceKeyId!=='string'||!o.acceptanceKeyId.trim())failures.push('RUNTIME_AND_ACCEPTANCE_TRUSTED_KEY_IDS_REQUIRED');
 const runtimeEnvelopeKeyId=bundle.runtimeAttestation&&bundle.runtimeAttestation.signature&&bundle.runtimeAttestation.signature.keyId;
 const acceptanceEnvelopeKeyId=bundle.acceptance&&bundle.acceptance.signature&&bundle.acceptance.signature.keyId;
 if(o.runtimeKeyId===o.acceptanceKeyId||runtimeEnvelopeKeyId===acceptanceEnvelopeKeyId)failures.push('RUNTIME_AND_ACCEPTANCE_KEY_IDS_NOT_DISTINCT');
 try{const runtimeTrustedKey=trustedPublicKey(o,'runtime'),acceptanceTrustedKey=trustedPublicKey(o,'acceptance');if(publicKeyFingerprint(runtimeTrustedKey)===publicKeyFingerprint(acceptanceTrustedKey))failures.push('RUNTIME_AND_ACCEPTANCE_SIGNING_KEYS_NOT_DISTINCT');}catch{failures.push('RUNTIME_AND_ACCEPTANCE_KEY_SEPARATION_UNVERIFIABLE');}
 const runtime=validateRuntimeAttestation(bundle.runtimeAttestation,{publicKey:o.runtimePublicKey,publicKeyFile:o.runtimePublicKeyFile,expectedKeyId:o.runtimeKeyId,expectedRelease:o.expectedRelease,expectedBuyerOrganizationId:o.expectedBuyerOrganizationId,expectedDeploymentId:o.expectedDeploymentId,now});
 if(!runtime.ok)failures.push(...runtime.failures.map(x=>'RUNTIME:'+x));
 const acceptance=verifySignedEnvelope(bundle.acceptance,{expectedSchema:ACCEPTANCE_SCHEMA,publicKey:o.acceptancePublicKey,publicKeyFile:o.acceptancePublicKeyFile,expectedKeyId:o.acceptanceKeyId});
 if(!acceptance.ok)failures.push(...acceptance.failures.map(x=>'ACCEPTANCE:'+x));const p=acceptance.payload;
 if(p){
 const digest=sha256(Buffer.from(canonicalJson(bundle.runtimeAttestation),'utf8'));
 if(p.schemaVersion!==ACCEPTANCE_PAYLOAD_SCHEMA)failures.push('ACCEPTANCE_PAYLOAD_SCHEMA_INVALID');if(p.decision!=='ACCEPT_FOR_GO_LIVE')failures.push('GO_LIVE_DECISION_NOT_ACCEPTED');
 if(p.productionHoldReleaseExecuted!==false)failures.push('PRODUCTION_HOLD_MUST_REMAIN_SEPARATE');if(p.openCriticalExceptions!==0)failures.push('OPEN_CRITICAL_EXCEPTIONS_NOT_ZERO');
 if(typeof p.acceptedBy!=='string'||!p.acceptedBy.trim())failures.push('ACCEPTED_BY_MISSING');if(typeof p.changeReference!=='string'||!p.changeReference.trim())failures.push('CHANGE_REFERENCE_MISSING');
 if(p.environment!=='production')failures.push('ACCEPTANCE_ENVIRONMENT_NOT_PRODUCTION');if(!p.buyer||p.buyer.organizationId!==o.expectedBuyerOrganizationId)failures.push('ACCEPTANCE_BUYER_MISMATCH');
 if(!p.buyer||p.buyer.deploymentId!==o.expectedDeploymentId)failures.push('ACCEPTANCE_DEPLOYMENT_MISMATCH');if(!sameRelease(p.release,o.expectedRelease))failures.push('ACCEPTANCE_RELEASE_MISMATCH');
 if(p.runtimeAttestationSha256!==digest)failures.push('RUNTIME_ATTESTATION_DIGEST_MISMATCH');if(p.runtimeAttestationKeyId!==(bundle.runtimeAttestation&&bundle.runtimeAttestation.signature&&bundle.runtimeAttestation.signature.keyId))failures.push('RUNTIME_ATTESTATION_KEY_BINDING_MISMATCH');
 failures.push(...validateTimestamp(p.acceptedAt,now,MAX_AGE_MS,'GO_LIVE_ACCEPTANCE'));
 }
 return {ok:failures.length===0,failures:[...new Set(failures)],runtime,acceptance:p};
}
function writeEvidenceExclusive(value,doc){
 const output=path.resolve(ROOT,value),rel=path.relative(ROOT,output),inside=rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)),allowed=rel==='evidence'||rel.startsWith('evidence'+path.sep);
 if(inside&&!allowed)throw new Error('EVIDENCE_OUTPUT_MUST_BE_OUTSIDE_PACKAGED_TREE');fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});let fd;
 try{fd=fs.openSync(output,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(doc,null,2)+'\n','utf8');fs.fsyncSync(fd);}catch(e){if(fd!==undefined){try{fs.closeSync(fd);}catch{}try{fs.unlinkSync(output);}catch{}}if(e&&e.code==='EEXIST')throw new Error('EVIDENCE_OUTPUT_ALREADY_EXISTS');throw new Error('EVIDENCE_OUTPUT_WRITE_FAILED');}
 fs.closeSync(fd);return output;
}
function sourceManifestCheck(){const r=spawnSync(process.execPath,['scripts/release-provenance.js','--check'],{cwd:ROOT,encoding:'utf8',env:process.env,maxBuffer:8*1024*1024});if(r.error||r.status!==0)throw new Error('SOURCE_MANIFEST_CHECK_FAILED');}
function liveReadiness(){
 const r=spawnSync(process.execPath,['scripts/production-readiness-gate.js'],{cwd:ROOT,encoding:'utf8',env:{...process.env,NODE_ENV:'production'},maxBuffer:12*1024*1024});let report;
 try{report=JSON.parse(r.stdout||'');}catch{return {ok:false,report:null,failures:['LIVE_READINESS_REPORT_INVALID']};}
 const failures=[];if(r.error||r.status!==0||report.ok!==true||report.productionReady!==true)failures.push('LIVE_READINESS_GATE_FAILED');
 if(!Array.isArray(report.checks)||!report.checks.length)failures.push('LIVE_READINESS_CHECKS_MISSING');else for(const c of report.checks)if(!c||c.status!=='PASS')failures.push('READINESS_CHECK_FAILED:'+String(c&&c.name||'UNKNOWN'));
 return {ok:failures.length===0,report,failures:[...new Set(failures)]};
}
function summarize(report){return {ok:report.ok===true,productionReady:report.productionReady===true,contract:report.contract,checkedAt:report.checkedAt,checks:report.checks.map(c=>({name:c.name,status:c.status,...(c.name==='rateLimitBoundary'?{backend:c.backend}:{})})),reportSha256:sha256(Buffer.from(canonicalJson(report),'utf8'))};}
function buyerIdentity(){
 const organizationId=requiredEnv('FIBEROS_BUYER_ORGANIZATION_ID'),deploymentId=requiredEnv('FIBEROS_DEPLOYMENT_ID');
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$/.test(organizationId))throw new Error('BUYER_ORGANIZATION_ID_FORMAT_INVALID');
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$/.test(deploymentId))throw new Error('DEPLOYMENT_ID_FORMAT_INVALID');
 return {organizationId,deploymentId,environment:'production'};
}
function runtimeCommand(){
 const buyer=buyerIdentity();if(env('NODE_ENV')!=='production')throw new Error('NODE_ENV_MUST_BE_PRODUCTION');sourceManifestCheck();
 const gate=liveReadiness();if(!gate.ok){console.log(JSON.stringify({ok:false,phase:'buyer-runtime',status:'BLOCKED',failures:gate.failures,
 failedChecks:gate.report&&Array.isArray(gate.report.checks)?gate.report.checks.filter(c=>!c||c.status!=='PASS').map(c=>({name:c&&c.name||'UNKNOWN',status:c&&c.status||'FAIL'})):[]},null,2));process.exitCode=1;return;}
 const release=getReleaseIdentity(ROOT),verifiedAt=new Date().toISOString(),payload={schemaVersion:RUNTIME_PAYLOAD_SCHEMA,verificationId:crypto.randomUUID(),verifiedAt,
 expiresAt:new Date(Date.now()+MAX_AGE_MS).toISOString(),outcome:'PASS_RUNTIME',proofLevel:'RUNTIME_PRODUCTION',environment:'production',buyer,release,
 sourceManifestCheck:{status:'PASS',manifestSha256:release.manifestSha256},readiness:summarize(gate.report)};
 const envelope=signEnvelope(payload,RUNTIME_SCHEMA,{privateKeyFile:requiredEnv('FIBEROS_BUYER_RUNTIME_SIGNING_KEY_FILE'),keyId:requiredEnv('FIBEROS_BUYER_RUNTIME_KEY_ID')});
 const output=writeEvidenceExclusive(requiredEnv('FIBEROS_RUNTIME_ATTESTATION_OUTPUT'),envelope);
 console.log(JSON.stringify({ok:true,status:'PASS_RUNTIME',proofLevel:payload.proofLevel,verificationId:payload.verificationId,release,buyer,output,
 attestationSha256:sha256(Buffer.from(canonicalJson(envelope),'utf8')),expiresAt:payload.expiresAt},null,2));
}
function acceptCommand(){
 const buyer=buyerIdentity();if(!process.argv.includes('--confirm-go-live'))throw new Error('EXPLICIT_CONFIRMATION_REQUIRED: pass --confirm-go-live');
 if(requiredEnv('FIBEROS_GO_LIVE_DECISION')!=='ACCEPT')throw new Error('GO_LIVE_DECISION_MUST_EXPLICITLY_EQUAL_ACCEPT');
 const acceptedBy=requiredEnv('FIBEROS_GO_LIVE_ACCEPTED_BY'),changeReference=requiredEnv('FIBEROS_GO_LIVE_CHANGE_REFERENCE');
 if(requiredEnv('FIBEROS_GO_LIVE_OPEN_CRITICAL_EXCEPTIONS')!=='0')throw new Error('GO_LIVE_REQUIRES_ZERO_OPEN_CRITICAL_EXCEPTIONS');
 sourceManifestCheck();const release=getReleaseIdentity(ROOT),runtimeEnvelope=readJsonFile(requiredEnv('FIBEROS_RUNTIME_ATTESTATION_FILE'));
 const runtimePublicKeyFile=requiredEnv('FIBEROS_BUYER_RUNTIME_PUBLIC_KEY_FILE'),runtimeKeyId=requiredEnv('FIBEROS_BUYER_RUNTIME_KEY_ID'),acceptanceKeyId=requiredEnv('FIBEROS_GO_LIVE_ACCEPTANCE_KEY_ID');
 let runtimePublicKey,acceptancePrivateKey;try{runtimePublicKey=crypto.createPublicKey(fs.readFileSync(runtimePublicKeyFile));acceptancePrivateKey=crypto.createPrivateKey(fs.readFileSync(requiredEnv('FIBEROS_GO_LIVE_ACCEPTANCE_SIGNING_KEY_FILE')));}catch{throw new Error('SIGNER_KEY_MATERIAL_UNAVAILABLE');}
 assertDistinctSigningKeys(runtimePublicKey,crypto.createPublicKey(acceptancePrivateKey),runtimeKeyId,acceptanceKeyId);
 const runtime=validateRuntimeAttestation(runtimeEnvelope,{publicKey:runtimePublicKey,expectedKeyId:runtimeKeyId,
 expectedRelease:release,expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId});
 if(!runtime.ok)throw new Error('RUNTIME_ATTESTATION_REJECTED:'+runtime.failures.join(','));
 const acceptedAt=new Date().toISOString(),payload={schemaVersion:ACCEPTANCE_PAYLOAD_SCHEMA,acceptedAt,decision:'ACCEPT_FOR_GO_LIVE',acceptedBy,changeReference,
 openCriticalExceptions:0,productionHoldReleaseExecuted:false,environment:'production',buyer,release,
 runtimeAttestationSha256:sha256(Buffer.from(canonicalJson(runtimeEnvelope),'utf8')),runtimeAttestationKeyId:runtimeEnvelope.signature.keyId};
 const acceptance=signEnvelope(payload,ACCEPTANCE_SCHEMA,{privateKey:acceptancePrivateKey,keyId:acceptanceKeyId});
 const bundle={schema:BUNDLE_SCHEMA,runtimeAttestation:runtimeEnvelope,acceptance},output=writeEvidenceExclusive(requiredEnv('FIBEROS_GO_LIVE_ACCEPTANCE_OUTPUT'),bundle);
 console.log(JSON.stringify({ok:true,decision:payload.decision,acceptedAt,acceptedBy,changeReference,buyer,release,output,
 acceptanceSha256:sha256(Buffer.from(canonicalJson(bundle),'utf8')),productionHoldReleaseExecuted:false},null,2));
}
function verifyCommand(){
 const buyer=buyerIdentity();sourceManifestCheck();const release=getReleaseIdentity(ROOT),bundle=readJsonFile(requiredEnv('FIBEROS_GO_LIVE_ACCEPTANCE_FILE'));
 const v=validateGoLiveAcceptanceBundle(bundle,{runtimePublicKeyFile:requiredEnv('FIBEROS_BUYER_RUNTIME_PUBLIC_KEY_FILE'),runtimeKeyId:requiredEnv('FIBEROS_BUYER_RUNTIME_KEY_ID'),
 acceptancePublicKeyFile:requiredEnv('FIBEROS_GO_LIVE_ACCEPTANCE_PUBLIC_KEY_FILE'),acceptanceKeyId:requiredEnv('FIBEROS_GO_LIVE_ACCEPTANCE_KEY_ID'),
 expectedRelease:release,expectedBuyerOrganizationId:buyer.organizationId,expectedDeploymentId:buyer.deploymentId});
 if(!v.ok){console.log(JSON.stringify({ok:false,status:'REJECTED',failures:v.failures},null,2));process.exitCode=1;return;}
 console.log(JSON.stringify({ok:true,status:'VERIFIED_GO_LIVE_ACCEPTANCE',release,buyer,acceptedAt:v.acceptance.acceptedAt,acceptedBy:v.acceptance.acceptedBy,
 changeReference:v.acceptance.changeReference,productionHoldReleaseExecuted:v.acceptance.productionHoldReleaseExecuted,
 acceptanceKeyId:bundle.acceptance.signature.keyId,runtimeKeyId:bundle.runtimeAttestation.signature.keyId},null,2));
}
function main(){try{const c=process.argv[2];if(c==='runtime')return runtimeCommand();if(c==='accept')return acceptCommand();if(c==='verify')return verifyCommand();throw new Error('COMMAND_REQUIRED: use runtime, accept, or verify');}
catch(e){console.error(JSON.stringify({ok:false,status:'BLOCKED',error:e&&e.message?e.message:'GO_LIVE_EVIDENCE_FAILED'},null,2));process.exitCode=1;}}
if(require.main===module)main();
module.exports={RUNTIME_SCHEMA,RUNTIME_PAYLOAD_SCHEMA,ACCEPTANCE_SCHEMA,ACCEPTANCE_PAYLOAD_SCHEMA,BUNDLE_SCHEMA,RUNTIME_CONTRACT_SCHEMA,REQUIRED_RUNTIME_CHECKS,signEnvelope,validateRuntimeAttestation,validateGoLiveAcceptanceBundle};

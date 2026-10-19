'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const CONTROL_PROOF_SCHEMA='fiberos.r14.1.buyer-runtime-control-proof.v1';
const CONTROL_PROOF_PAYLOAD_SCHEMA='fiberos.r14.1.buyer-runtime-control-proof-payload.v1';
const MAX_PROOF_AGE_MS=24*60*60*1000,MAX_FUTURE_SKEW_MS=5*60*1000;
const SHA256_RE=/^[a-f0-9]{64}$/,COMMIT_RE=/^[a-f0-9]{40}$/;
function canonicalJson(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonicalJson).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(v[k])).join(',')+'}';}
function sha256(v){return crypto.createHash('sha256').update(v).digest('hex');}
function getReleaseIdentity(root){
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),manifestBytes=fs.readFileSync(path.join(root,'SALES_PACKAGE_MANIFEST.json'));
 let sourceCommit=null;try{const c=execFileSync('git',['rev-parse','--verify','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();if(COMMIT_RE.test(c))sourceCommit=c;}catch{/* ZIP handoffs may not contain .git. */}
 return {packageVersion:pkg.version,manifestSha256:sha256(manifestBytes),sourceCommit};
}
function sameRelease(a,b){return Boolean(a&&b&&a.packageVersion===b.packageVersion&&a.manifestSha256===b.manifestSha256&&a.sourceCommit===b.sourceCommit);}
function timestampFailure(v,now,maxAge,prefix){if(typeof v!=='string'||Number.isNaN(Date.parse(v)))return prefix+'_TIMESTAMP_INVALID';const t=Date.parse(v);if(t>now+MAX_FUTURE_SKEW_MS)return prefix+'_TIMESTAMP_FROM_FUTURE';if(now-t>maxAge)return prefix+'_TIMESTAMP_EXPIRED';return null;}
function loadPublicKey(o){if(o.publicKey)return o.publicKey;if(!o.publicKeyFile)return {error:'TRUSTED_PUBLIC_KEY_REQUIRED'};try{return crypto.createPublicKey(fs.readFileSync(o.publicKeyFile));}catch{return {error:'TRUSTED_PUBLIC_KEY_UNAVAILABLE'};}}
function verifySignedEnvelope(envelope,o={}){
 const failures=[];if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))return {ok:false,failures:['ENVELOPE_NOT_OBJECT'],payload:null,keyId:null};
 if(envelope.schema!==o.expectedSchema)failures.push('ENVELOPE_SCHEMA_INVALID');
 if(!envelope.payload||typeof envelope.payload!=='object'||Array.isArray(envelope.payload))failures.push('ENVELOPE_PAYLOAD_INVALID');
 const s=envelope.signature;if(!s||typeof s!=='object')failures.push('SIGNATURE_MISSING');else{
 if(s.algorithm!=='Ed25519')failures.push('SIGNATURE_ALGORITHM_INVALID');
 if(typeof s.keyId!=='string'||!s.keyId.trim())failures.push('SIGNATURE_KEY_ID_MISSING');
 if(o.expectedKeyId&&s.keyId!==o.expectedKeyId)failures.push('SIGNATURE_KEY_ID_MISMATCH');
 if(typeof s.value!=='string'||!s.value.trim())failures.push('SIGNATURE_VALUE_MISSING');}
 let key=loadPublicKey(o);if(key&&key.error){failures.push(key.error);key=null;}
 if(envelope.payload&&typeof envelope.payload==='object'&&s&&s.algorithm==='Ed25519'&&typeof s.value==='string'&&key)try{
 const sig=Buffer.from(s.value,'base64');if(sig.length!==64||sig.toString('base64')!==s.value)failures.push('SIGNATURE_ENCODING_INVALID');
 else if(!crypto.verify(null,Buffer.from(canonicalJson(envelope.payload),'utf8'),key,sig))failures.push('SIGNATURE_INVALID');
 }catch{failures.push('SIGNATURE_VERIFICATION_FAILED');}
 return {ok:failures.length===0,failures:[...new Set(failures)],payload:envelope.payload||null,keyId:s&&typeof s.keyId==='string'?s.keyId:null};
}
function verifySignedControlProof(envelope,o={}){
 const now=Number.isFinite(o.now)?o.now:Date.now(),maxAge=Number.isFinite(o.maxAgeMs)?o.maxAgeMs:MAX_PROOF_AGE_MS;
 const v=verifySignedEnvelope(envelope,{expectedSchema:CONTROL_PROOF_SCHEMA,publicKey:o.publicKey,publicKeyFile:o.publicKeyFile,expectedKeyId:o.expectedKeyId});
 const failures=[...v.failures],p=v.payload,add=(cond,code)=>{if(!cond)failures.push(code);};
 if(typeof o.expectedKeyId!=='string'||!o.expectedKeyId.trim())failures.push('CONTROL_PROOF_EXPECTED_KEY_ID_REQUIRED');
 if(p){
 add(p.schemaVersion===CONTROL_PROOF_PAYLOAD_SCHEMA,'CONTROL_PROOF_PAYLOAD_SCHEMA_INVALID');
 add(typeof o.proofType==='string'&&p.proofType===o.proofType,'CONTROL_PROOF_TYPE_MISMATCH');
 add(p.result==='PASS','CONTROL_PROOF_RESULT_NOT_PASS');add(p.environment==='production','CONTROL_PROOF_ENVIRONMENT_NOT_PRODUCTION');
 add(typeof o.expectedBuyerOrganizationId==='string'&&o.expectedBuyerOrganizationId.trim().length>0&&p.buyerOrganizationId===o.expectedBuyerOrganizationId,'CONTROL_PROOF_BUYER_MISMATCH');
 add(typeof o.expectedDeploymentId==='string'&&o.expectedDeploymentId.trim().length>0&&p.deploymentId===o.expectedDeploymentId,'CONTROL_PROOF_DEPLOYMENT_MISMATCH');
 add(sameRelease(p.release,o.expectedRelease),'CONTROL_PROOF_RELEASE_MISMATCH');
 add(p.checks&&typeof p.checks==='object'&&!Array.isArray(p.checks),'CONTROL_PROOF_CHECKS_INVALID');
 if(p.checks&&typeof p.checks==='object')for(const f of o.requiredFields||[])add(p.checks[f]===true,'CONTROL_PROOF_REQUIRED_CHECK_FAILED:'+f);
 const tf=timestampFailure(p.checkedAt,now,maxAge,'CONTROL_PROOF');if(tf)failures.push(tf);
 add(SHA256_RE.test(p.evidenceSha256||''),'CONTROL_PROOF_EVIDENCE_HASH_INVALID');
 add(typeof p.producer==='string'&&p.producer.trim().length>0,'CONTROL_PROOF_PRODUCER_MISSING');
 add(Array.isArray(p.evidenceReferences)&&p.evidenceReferences.length>0&&p.evidenceReferences.every(x=>typeof x==='string'&&x.trim().length>=3),'CONTROL_PROOF_EVIDENCE_REFERENCES_MISSING');
 }
 return {ok:failures.length===0,failures:[...new Set(failures)],payload:p,keyId:v.keyId};
}
module.exports={CONTROL_PROOF_SCHEMA,CONTROL_PROOF_PAYLOAD_SCHEMA,MAX_PROOF_AGE_MS,MAX_FUTURE_SKEW_MS,canonicalJson,sha256,getReleaseIdentity,sameRelease,timestampFailure,verifySignedEnvelope,verifySignedControlProof};

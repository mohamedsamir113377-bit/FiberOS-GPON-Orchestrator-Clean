'use strict';
const crypto=require('crypto');
function stable(v){if(v===null||typeof v!=='object')return v;if(Array.isArray(v))return v.map(stable);const o={};for(const k of Object.keys(v).sort())o[k]=stable(v[k]);return o;}
function sha256(v){return crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(stable(v))).digest('hex');}
function requiredString(v,n){if(typeof v!=='string'||!v.trim())throw new TypeError(n+' must be non-empty');return v.trim();}
function modelSpec(input){
 const fields=['modelId','version','purpose','equationOrAlgorithm','assumptions','domainOfValidity','units','parameters','uncertaintyMethod','validationMethod','baseline','rejectionConditions'];
 for(const f of fields) if(input[f]===undefined||input[f]===null||(typeof input[f]==='string'&&!input[f].trim())) throw new Error('MISSING_'+f.toUpperCase());
 if(!Array.isArray(input.assumptions)||!input.assumptions.length) throw new Error('ASSUMPTIONS_REQUIRED');
 if(!Array.isArray(input.parameters)) throw new Error('PARAMETERS_MUST_BE_ARRAY');
 if(!Array.isArray(input.rejectionConditions)||!input.rejectionConditions.length) throw new Error('REJECTION_CONDITIONS_REQUIRED');
 const p={kind:'fiberos.model-spec',version:1,modelId:requiredString(input.modelId,'modelId'),modelVersion:requiredString(input.version,'version'),purpose:input.purpose,equationOrAlgorithm:input.equationOrAlgorithm,assumptions:stable(input.assumptions),domainOfValidity:stable(input.domainOfValidity),units:stable(input.units),parameters:stable(input.parameters),uncertaintyMethod:input.uncertaintyMethod,validationMethod:input.validationMethod,baseline:stable(input.baseline),rejectionConditions:stable(input.rejectionConditions),evidenceRefs:stable(input.evidenceRefs||[])};
 return Object.freeze({...p,specHash:sha256(p)});
}
function verifyModelSpec(spec){if(!spec||spec.kind!=='fiberos.model-spec'||typeof spec.specHash!=='string')return {valid:false,reason:'INVALID_SPEC'};const p={...spec};delete p.specHash;return Object.freeze({valid:sha256(p)===spec.specHash,expected:sha256(p),actual:spec.specHash});}
function compareToBaseline({modelMetric,baselineMetric,lowerIsBetter=true,practicalDelta=null,ci=null}){
 if(!Number.isFinite(modelMetric)||!Number.isFinite(baselineMetric))throw new Error('METRICS_MUST_BE_FINITE');
 const delta=modelMetric-baselineMetric; const direction=lowerIsBetter?-delta:delta;
 const materiallyBetter=practicalDelta===null?direction>0:direction>=practicalDelta;
 const ciSupportsImprovement=ci===null?null:(Number.isFinite(ci.lower)&&Number.isFinite(ci.upper)&&((lowerIsBetter&&ci.upper<0)||(!lowerIsBetter&&ci.lower>0)));
 return Object.freeze({delta,lowerIsBetter,practicalDelta,materiallyBetter,ciSupportsImprovement,evidenceRequired:true});
}
function modelPromotionGate({spec,validationEvidence,baselineComparison,independentVerification,realWorldEvidence=false}){
 const reasons=[];if(!verifyModelSpec(spec).valid)reasons.push('MODEL_SPEC_INTEGRITY_FAILURE');if(!validationEvidence)reasons.push('VALIDATION_EVIDENCE_MISSING');if(!baselineComparison||baselineComparison.materiallyBetter!==true)reasons.push('BASELINE_SUPERIOR_OR_NO_PRACTICAL_GAIN');if(independentVerification!==true)reasons.push('INDEPENDENT_VERIFICATION_REQUIRED');if(realWorldEvidence!==true)reasons.push('REAL_WORLD_EVIDENCE_REQUIRED');return Object.freeze({promotable:reasons.length===0,reasons});
}
module.exports={stable,sha256,modelSpec,verifyModelSpec,compareToBaseline,modelPromotionGate};

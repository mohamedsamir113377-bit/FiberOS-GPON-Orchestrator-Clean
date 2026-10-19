'use strict';

/*
 * Standards/model conformance gate.
 *
 * IMPORTANT: this module does NOT certify compliance with an external standard.
 * It verifies that an input set satisfies an explicitly supplied FiberOS
 * conformance contract: identity, capability, standards references, governed
 * parameters, measurement semantics, validity domains, and evidence/provenance.
 * External normative limits must be supplied by an approved profile/source.
 */
const crypto = require('crypto');
const { parameter } = require('./modelGovernance');
const { normalize } = require('./vendorContract');

function text(x,n){if(typeof x!=='string'||!x.trim())throw new TypeError(`${n} must be a non-empty string`);return x.trim();}
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function nonneg(x,n){const v=finite(x,n);if(v<0)throw new RangeError(`${n} must be >= 0`);return v;}
function arr(x,n){if(!Array.isArray(x))throw new TypeError(`${n} must be an array`);return x;}
function unique(xs){return [...new Set(xs.map(String))];}
function within(value, range){return !range || (value>=range[0] && value<=range[1]);}

function canonicalJson(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
}
function fingerprint(contract){
  return crypto.createHash('sha256').update(canonicalJson(contract)).digest('hex');
}

function validateContract(c){
  c=c||{};
  const errors=[];
  const required=['contractId','modelKey','modelVersion','standards','requiredCapabilities','parameterRefs'];
  for(const k of required) if(c[k]==null) errors.push({code:'MISSING_FIELD',field:k});
  if(c.contractId!=null) text(c.contractId,'contractId');
  if(c.modelKey!=null) text(c.modelKey,'modelKey');
  if(c.modelVersion!=null) text(c.modelVersion,'modelVersion');
  if(c.standards!=null) unique(arr(c.standards,'standards')).forEach(x=>text(x,'standard'));
  if(c.requiredCapabilities!=null) unique(arr(c.requiredCapabilities,'requiredCapabilities')).forEach(x=>text(x,'capability'));
  if(c.parameterRefs!=null) unique(arr(c.parameterRefs,'parameterRefs')).forEach(x=>text(x,'parameterRef'));
  if(c.measurements!=null && !Array.isArray(c.measurements)) throw new TypeError('measurements must be an array');
  return errors;
}

function checkCapabilities(contract, profile, errors, warnings){
  const caps=profile?.capabilities||{};
  for(const cap of unique(contract.requiredCapabilities||[])) if(caps[cap]!==true) errors.push({code:'CAPABILITY_MISSING',capability:cap});
}
function checkStandards(contract, profile, errors){
  const available=new Set(profile?.standards||[]);
  for(const s of unique(contract.standards||[])) if(!available.has(s)) errors.push({code:'STANDARD_REFERENCE_MISSING',standard:s});
}
function checkParameters(contract, bindings, errors){
  const map=new Map((bindings||[]).map(b=>[String(b.parameterKey),b]));
  for(const key of unique(contract.parameterRefs||[])){
    const b=map.get(key);
    if(!b){errors.push({code:'PARAMETER_MISSING',parameterRef:key});continue;}
    if(b.status!=='APPROVED') errors.push({code:'PARAMETER_NOT_APPROVED',parameterRef:key,status:b.status});
    try{parameter(b);}catch(e){errors.push({code:'PARAMETER_INVALID',parameterRef:key,detail:e.message});}
  }
}
function checkMeasurements(contract, measurements, errors, warnings){
  for(let i=0;i<(measurements||[]).length;i++){
    let m;
    try{m=normalize(measurements[i]);}catch(e){errors.push({code:'MEASUREMENT_INVALID',index:i,detail:e.message});continue;}
    if(contract.measurementTypes && !contract.measurementTypes.includes(m.measurementType)) errors.push({code:'MEASUREMENT_TYPE_NOT_ALLOWED',index:i,measurementType:m.measurementType});
    if(contract.units?.[m.measurementType] && contract.units[m.measurementType]!==m.unit) errors.push({code:'UNIT_MISMATCH',index:i,expected:contract.units[m.measurementType],actual:m.unit});
    if(contract.wavelengthNm!=null && m.wavelengthNm!=null && Math.abs(m.wavelengthNm-contract.wavelengthNm)>1e-9) errors.push({code:'WAVELENGTH_MISMATCH',index:i,expected:contract.wavelengthNm,actual:m.wavelengthNm});
    if(contract.requireMeasurementUncertainty && m.uncertainty==null) errors.push({code:'UNCERTAINTY_REQUIRED',index:i});
    if(contract.requireRawReference && !m.rawReference) errors.push({code:'RAW_REFERENCE_REQUIRED',index:i});
    if(contract.maxAgeSeconds!=null){const age=(Date.now()-Date.parse(m.capturedAt))/1000;if(age>nonneg(contract.maxAgeSeconds,'maxAgeSeconds')) errors.push({code:'MEASUREMENT_STALE',index:i,ageSeconds:age,maxAgeSeconds:contract.maxAgeSeconds});}
  }
}
function checkParameterDomains(contract, bindings, errors){
  const context=contract.parameterContext||{};
  for(const b of bindings||[]){
    if(!contract.parameterRefs?.includes(String(b.parameterKey))) continue;
    if(b.validRange && context[b.parameterKey]!=null && !within(Number(context[b.parameterKey]),b.validRange)) errors.push({code:'PARAMETER_DOMAIN_VIOLATION',parameterRef:b.parameterKey,value:context[b.parameterKey],validRange:b.validRange});
  }
}
function checkModelIdentity(contract, model, errors){
  if(!model){errors.push({code:'MODEL_MISSING'});return;}
  if(String(model.modelKey||model.modelId)!==String(contract.modelKey)) errors.push({code:'MODEL_KEY_MISMATCH',expected:contract.modelKey,actual:model.modelKey||model.modelId});
  if(String(model.version)!==String(contract.modelVersion)) errors.push({code:'MODEL_VERSION_MISMATCH',expected:contract.modelVersion,actual:model.version});
  if(model.status && !['APPROVED','verified','calibrated'].includes(model.status)) errors.push({code:'MODEL_NOT_APPROVED',status:model.status});
  if(!model.equation && !model.formula) errors.push({code:'MODEL_FORMULA_MISSING'});
}
function checkProfileIdentity(contract, profile, errors){
  if(!profile){errors.push({code:'VENDOR_PROFILE_MISSING'});return;}
  for(const k of ['vendor','model','version']) if(contract.vendor?.[k]!=null && String(profile[k])!==String(contract.vendor[k])) errors.push({code:'PROFILE_IDENTITY_MISMATCH',field:k,expected:contract.vendor[k],actual:profile[k]});
  const provided=new Set(profile.parameterRefs||[]);
  for(const k of contract.parameterRefs||[]) if(!provided.has(k)) errors.push({code:'PROFILE_PARAMETER_MISSING',parameterRef:k});
}

function evaluate(input){
  input=input||{};
  const contract=input.contract||{};
  const errors=validateContract(contract);
  const warnings=[];
  checkCapabilities(contract,input.profile,errors,warnings);
  checkStandards(contract,input.profile,errors);
  checkModelIdentity(contract,input.model,errors);
  checkProfileIdentity(contract,input.profile,errors);
  checkParameters(contract,input.bindings,errors);
  checkParameterDomains(contract,input.bindings,errors);
  checkMeasurements(contract,input.measurements,errors,warnings);
  const result={
    status:errors.length?'NON_CONFORMANT':'CONFORMANT_TO_DECLARED_CONTRACT',
    certifiableExternally:false,
    errors:Object.freeze(errors),
    warnings:Object.freeze(warnings),
    contractFingerprint:fingerprint(contract),
    scope:'FiberOS structural/model conformance only; not external standards certification'
  };
  return Object.freeze(result);
}

function compatibility(a,b){
  const left=a||{}, right=b||{};
  const missingCapabilities=unique(left.requiredCapabilities||[]).filter(x=>!(right.capabilities||{})[x]);
  const missingStandards=unique(left.standards||[]).filter(x=>!(right.standards||[]).includes(x));
  const missingParameters=unique(left.parameterRefs||[]).filter(x=>!(right.parameterRefs||[]).includes(x));
  return Object.freeze({compatible:!missingCapabilities.length&&!missingStandards.length&&!missingParameters.length,missingCapabilities,missingStandards,missingParameters});
}

module.exports={canonicalJson,fingerprint,evaluate,compatibility};

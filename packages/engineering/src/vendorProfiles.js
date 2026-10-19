'use strict';

/* Vendor/model neutrality without inventing vendor coefficients.
 * A profile is only a schema + parameter binding. Numeric coefficients must
 * arrive through an approved calibration/standards record.
 */
function str(x,n){if(typeof x!=='string'||!x.trim())throw new TypeError(`${n} must be a non-empty string`);return x.trim();}
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function nonNeg(x,n){const v=finite(x,n);if(v<0)throw new RangeError(`${n} must be >= 0`);return v;}
function profile(p){p=p||{};return Object.freeze({
  profileId:str(p.profileId,'profileId'), vendor:str(p.vendor,'vendor'), model:str(p.model,'model'), version:str(p.version,'version'),
  standards:[...(p.standards||[])].map(x=>str(x,'standard')), parameterRefs:[...(p.parameterRefs||[])].map(x=>str(x,'parameterRef')),
  capabilities:Object.freeze({...p.capabilities}), metadata:Object.freeze({...p.metadata})
});}
function validateParameterBinding(b){b=b||{};const required=['parameter','sourceRef','units','validDomain'];for(const k of required)if(b[k]==null)throw new TypeError(`${k} required`);if(typeof b.validDomain!=='object'||Array.isArray(b.validDomain))throw new TypeError('validDomain must be an object');return Object.freeze({...b, value:b.value==null?undefined:finite(b.value,'value'), uncertainty:b.uncertainty==null?undefined:nonNeg(b.uncertainty,'uncertainty')});}
function resolve({profile:pr,bindings=[]}){const p=profile(pr);const map=new Map();for(const b0 of bindings){const b=validateParameterBinding(b0);if(map.has(b.parameter))throw new RangeError(`duplicate parameter binding: ${b.parameter}`);map.set(b.parameter,b);}for(const ref of p.parameterRefs)if(!map.has(ref))throw new RangeError(`missing binding for ${ref}`);return Object.freeze({profile:p,bindings:[...map.values()],complete:true});}
module.exports={profile,validateParameterBinding,resolve};

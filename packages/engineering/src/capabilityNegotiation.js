'use strict';
/* Vendor-neutral capability negotiation. Capabilities describe what an adapter
 * can measure/execute; they never redefine canonical engineering semantics. */
function str(x,n){if(typeof x!=='string'||!x.trim())throw new TypeError(`${n} must be a non-empty string`);return x.trim();}
function set(xs,n){if(!Array.isArray(xs))throw new TypeError(`${n} must be an array`);return new Set(xs.map(x=>str(x,n)));}
function profile(p){p=p||{};return Object.freeze({profileId:str(p.profileId,'profileId'),vendor:str(p.vendor,'vendor'),model:str(p.model,'model'),version:str(p.version,'version'),capabilities:Object.freeze({...p.capabilities}),standards:Object.freeze([...(p.standards||[])].map(x=>str(x,'standard')))});}
function negotiate({required=[],offered=[],requiredStandards=[],offeredStandards=[]}){
 const r=set(required,'required'),o=set(offered,'offered'),rs=set(requiredStandards,'requiredStandards'),os=set(offeredStandards,'offeredStandards');
 const missing=[...r].filter(x=>!o.has(x)); const missingStandards=[...rs].filter(x=>!os.has(x));
 return Object.freeze({compatible:missing.length===0&&missingStandards.length===0,missingCapabilities:missing,missingStandards,matchedCapabilities:[...r].filter(x=>o.has(x)),matchedStandards:[...rs].filter(x=>os.has(x))});
}
function requireCapabilities({profile:p,required=[],requiredStandards=[]}){const q=profile(p), offered=Object.keys(q.capabilities).filter(k=>q.capabilities[k]===true);const n=negotiate({required,offered,requiredStandards,offeredStandards:q.standards});if(!n.compatible)throw new Error(`capability negotiation failed: ${[...n.missingCapabilities,...n.missingStandards].join(',')}`);return Object.freeze({profile:q,...n});}
module.exports={profile,negotiate,requireCapabilities};

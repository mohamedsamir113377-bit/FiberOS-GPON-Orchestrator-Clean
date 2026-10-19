'use strict';
/* Standards are references, not hidden numerical constants. A profile selects
 * applicability; parameter values still require governed provenance. */
function str(x,n){if(typeof x!=='string'||!x.trim())throw new TypeError(`${n} must be a non-empty string`);return x.trim();}
function profile(p){p=p||{};return Object.freeze({profileId:str(p.profileId,'profileId'),standardRefs:Object.freeze([...(p.standardRefs||[])].map(x=>str(x,'standardRef'))),scope:p.scope&&typeof p.scope==='object'?Object.freeze({...p.scope}):Object.freeze({}),parameterRefs:Object.freeze([...(p.parameterRefs||[])].map(x=>str(x,'parameterRef')))});}
function compatible(a,b){const x=profile(a),y=profile(b);const ys=new Set(y.standardRefs);return Object.freeze({compatible:x.standardRefs.every(s=>ys.has(s)),required:x.standardRefs,available:y.standardRefs,missing:x.standardRefs.filter(s=>!ys.has(s))});}
module.exports={profile,compatible};

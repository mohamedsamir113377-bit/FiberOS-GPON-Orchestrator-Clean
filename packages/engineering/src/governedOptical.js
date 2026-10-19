'use strict';
const {requireApproved}=require('./modelGovernance');
const {propagatePath}=require('./opticalPath');
/* Gate: every non-universal optical coefficient must be explicitly bound to an
 * approved parameter record. The canonical equations remain in opticalPath. */
function evaluate({path,bindings}){
 const required=(path.parameterRefs||[]).map(String); const map=new Map((bindings||[]).map(b=>[b.parameterKey,b]));
 requireApproved(required.map(k=>{const b=map.get(k);if(!b)throw new Error(`missing approved parameter: ${k}`);return b;}));
 const resolved={...path};
 for(const key of required){const b=map.get(key); if(b.units==='dB/km') resolved.fiberAttenuationDbPerKm=b.value; else if(b.units==='dB'){
   if(key.includes('splice'))resolved.spliceLossDb=b.value; else if(key.includes('connector'))resolved.connectorLossDb=b.value; else if(key.includes('splitter'))resolved.splitterExcessDb=b.value;
 }}
 const result=propagatePath(resolved);return Object.freeze({status:'GOVERNED_CALCULATION',parameters:required,result});
}
module.exports={evaluate};

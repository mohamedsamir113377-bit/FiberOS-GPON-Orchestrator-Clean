'use strict';
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
/** Expected utility under mutually exclusive outcome states. Probabilities must sum to one. */
function expectedUtility({actions,outcomes}){
 if(!Array.isArray(actions)||!Array.isArray(outcomes)||!actions.length||!outcomes.length)throw new TypeError('actions/outcomes required');
 const ps=outcomes.map((o,i)=>finite(o.probability,`outcomes[${i}].probability`));const sum=ps.reduce((a,b)=>a+b,0);if(Math.abs(sum-1)>1e-9)throw new RangeError(`outcome probabilities must sum to 1 (got ${sum})`);
 const scored=actions.map(a=>{const utility=outcomes.reduce((s,o)=>s+finite(o.probability,'probability')*finite(a.payoffByOutcome?.[o.id],`payoffByOutcome.${o.id}`),0)-finite(a.directCost||0,'directCost');return {...a,expectedUtility:utility};}).sort((a,b)=>b.expectedUtility-a.expectedUtility);
 return Object.freeze({ranking:scored,best:scored[0]});
}
function uncertaintyBudget(components,weights){let total=0;for(const [k,v] of Object.entries(components||{})){const x=Math.max(0,Math.min(1,finite(v,`components.${k}`)));const w=weights?.[k]==null?1:Math.max(0,finite(weights[k],`weights.${k}`));total+=w*x;}const wsum=Object.keys(components||{}).reduce((s,k)=>s+(weights?.[k]==null?1:weights[k]),0);return wsum?Math.min(1,total/wsum):0;}
module.exports={expectedUtility,uncertaintyBudget};

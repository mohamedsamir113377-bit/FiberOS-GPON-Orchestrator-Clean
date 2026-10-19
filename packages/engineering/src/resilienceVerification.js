'use strict';
const {maxFlow}=require('./networkResilience');
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function verify({edges,source,target,requiredDisjointPaths=1,failedEdgeIds=[]}){
 const clean=(edges||[]).map(e=>({...e,capacity:1}));const base=maxFlow({edges:clean,source,target}).maxFlow;const fail=new Set(failedEdgeIds);const active=clean.filter(e=>!fail.has(e.id));const after=maxFlow({edges:active,source,target}).maxFlow;const req=finite(requiredDisjointPaths,'requiredDisjointPaths');return Object.freeze({baselineEdgeDisjointPaths:Math.floor(base+1e-12),postFailureEdgeDisjointPaths:Math.floor(after+1e-12),requiredDisjointPaths:req,passes:after+1e-12>=req,failedEdgeIds:[...fail],model:'unit-capacity edge-disjoint path count'});
}
module.exports={verify};

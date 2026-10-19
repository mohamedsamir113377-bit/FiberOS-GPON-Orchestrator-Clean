'use strict';
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function positive(x,n){const v=finite(x,n);if(v<=0)throw new RangeError(`${n} must be > 0`);return v;}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
/** Convert independent quality factors into a conservative multiplicative quality score. */
function multiplicativeQuality(factors){if(!Array.isArray(factors)||!factors.length)throw new TypeError('factors required');let log=0;for(let i=0;i<factors.length;i++){const q=clamp(finite(factors[i],`factors[${i}]`),0,1);if(q===0)return 0;log+=Math.log(q);}return Math.exp(log);}
/** Exponential freshness decay q(t)=exp(-ln(2)*age/halfLife). */
function freshness(ageSeconds,halfLifeSeconds){const t=Math.max(0,finite(ageSeconds,'ageSeconds'));const h=positive(halfLifeSeconds,'halfLifeSeconds');return Math.exp(-Math.log(2)*t/h);}
/** Combine freshness, provenance, consistency and measurement quality without exceeding [0,1]. */
function truthQuality({freshnessScore,provenanceScore,consistencyScore,measurementScore}){return multiplicativeQuality([freshnessScore,provenanceScore,consistencyScore,measurementScore]);}
module.exports={multiplicativeQuality,freshness,truthQuality};

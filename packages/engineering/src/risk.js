'use strict';
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function validateOutcomes(outcomes){if(!Array.isArray(outcomes)||!outcomes.length)throw new TypeError('outcomes required');const ps=outcomes.map((o,i)=>finite(o.probability,`outcomes[${i}].probability`));if(ps.some(p=>p<0))throw new RangeError('probabilities must be >= 0');const sum=ps.reduce((a,b)=>a+b,0);if(Math.abs(sum-1)>1e-9)throw new RangeError(`probabilities must sum to 1 (got ${sum})`);return outcomes;}
/** VaR_alpha(loss): alpha-quantile of discrete loss distribution, alpha in (0,1). */
function valueAtRisk({action,outcomes,alpha=0.95}){
 validateOutcomes(outcomes);const a=finite(alpha,'alpha');if(!(a>0&&a<1))throw new RangeError('alpha must be in (0,1)');
 const rows=outcomes.map(o=>({loss:-finite(action.payoffByOutcome?.[o.id],`payoffByOutcome.${o.id}`),p:finite(o.probability,'probability'),id:o.id})).sort((x,y)=>x.loss-y.loss);
 let cum=0;for(const r of rows){cum+=r.p;if(cum>=a-1e-15)return r.loss;}return rows[rows.length-1].loss;
}
/** Standard discrete CVaR_alpha: conditional mean of the worst (1-alpha) loss tail, including fractional mass at VaR. */
function cvarLoss({action,outcomes,alpha=0.95}){
 validateOutcomes(outcomes);const a=finite(alpha,'alpha');if(!(a>0&&a<1))throw new RangeError('alpha must be in (0,1)');
 const rows=outcomes.map(o=>({loss:-finite(action.payoffByOutcome?.[o.id],`payoffByOutcome.${o.id}`),p:finite(o.probability,'probability'),id:o.id})).sort((x,y)=>y.loss-x.loss);
 const tail=1-a;let remaining=tail,total=0;for(const r of rows){if(remaining<=1e-15)break;const take=Math.min(remaining,r.p);total+=take*r.loss;remaining-=take;}
 return total/tail;
}
function riskAdjustedRanking({actions,outcomes,alpha=0.95,riskAversion=0}){
 validateOutcomes(outcomes);if(!Array.isArray(actions)||!actions.length)throw new TypeError('actions required');const lam=Math.max(0,finite(riskAversion,'riskAversion'));const scored=actions.map(a=>{const eu=outcomes.reduce((s,o)=>s+o.probability*finite(a.payoffByOutcome?.[o.id],`payoffByOutcome.${o.id}`),0)-finite(a.directCost||0,'directCost');const varLoss=valueAtRisk({action:a,outcomes,alpha});const tailLoss=cvarLoss({action:a,outcomes,alpha});return {...a,expectedUtility:eu,varLoss,cvarLoss:tailLoss,riskAdjustedUtility:eu-lam*tailLoss};}).sort((a,b)=>b.riskAdjustedUtility-a.riskAdjustedUtility);return Object.freeze({alpha,riskAversion:lam,tailProbability:1-alpha,ranking:scored,best:scored[0],formula:'RAU = EU - λ·CVaR_α(loss)',definition:'CVaR_α is the mean loss in the worst (1-α) probability tail'});}
module.exports={valueAtRisk,cvarLoss,riskAdjustedRanking};

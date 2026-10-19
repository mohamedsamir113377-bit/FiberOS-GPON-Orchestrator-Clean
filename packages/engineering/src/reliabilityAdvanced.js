'use strict';
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function positive(x,n){const v=finite(x,n);if(v<=0)throw new RangeError(`${n} must be > 0`);return v;}
function validateObs(obs){if(!Array.isArray(obs)||!obs.length)throw new TypeError('observations required'); return obs.map((o,i)=>({time:positive(o.time,`observations[${i}].time`),event:o.event===undefined?true:Boolean(o.event)}));}
function weibullMLE({observations,tolerance=1e-10,maxIterations=200}){
 const data=validateObs(observations); const failures=data.filter(x=>x.event); const r=failures.length; if(r<2)throw new RangeError('at least two failures are required');
 const logSum=data.reduce((s,o)=>s+Math.log(o.time),0); const failLogSum=failures.reduce((s,o)=>s+Math.log(o.time),0);
 function score(beta){let sumPow=0,sumPowLog=0;for(const o of data){const p=Math.pow(o.time,beta);sumPow+=p;sumPowLog+=p*Math.log(o.time);}return r/beta+failLogSum-r*sumPowLog/sumPow;}
 let lo=0.05,hi=20, slo=score(lo),shi=score(hi); let guard=0; while(slo*shi>0 && guard++<12){lo/=2;hi*=2;slo=score(lo);shi=score(hi);}
 if(!(slo*shi<=0))throw new RangeError('could not bracket Weibull shape MLE');
 for(let i=0;i<maxIterations;i++){const mid=(lo+hi)/2,sm=score(mid);if(Math.abs(sm)<tolerance){lo=hi=mid;break;}if(slo*sm<=0){hi=mid;shi=sm;}else{lo=mid;slo=sm;}}
 const beta=(lo+hi)/2; let sumPow=0;for(const o of data)sumPow+=Math.pow(o.time,beta); const eta=Math.pow(sumPow/r,1/beta);
 const logLikelihood= data.reduce((s,o)=>s+(o.event?(Math.log(beta)+(beta-1)*Math.log(o.time)-beta*Math.log(eta)):-Math.pow(o.time/eta,beta)),0);
 return Object.freeze({shapeBeta:beta,scaleEta:eta,failures:r,totalObservations:data.length,censored:data.length-r,logLikelihood,method:'Weibull 2-parameter MLE with right censoring',converged:true});
}
module.exports={weibullMLE};

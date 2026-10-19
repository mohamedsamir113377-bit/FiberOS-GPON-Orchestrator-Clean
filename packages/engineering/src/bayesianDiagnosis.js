'use strict';
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function normalize(xs){const s=xs.reduce((a,b)=>a+b,0);if(!(s>0))throw new RangeError('posterior mass must be > 0');return xs.map(x=>x/s);}
/** Naive Bayes is deliberately explicit: conditional likelihoods are supplied by calibrated models. */
function posterior({hypotheses,priors,evidenceLikelihoods}){
 if(!Array.isArray(hypotheses)||!hypotheses.length)throw new TypeError('hypotheses required');
 if(!Array.isArray(priors)||priors.length!==hypotheses.length)throw new TypeError('priors mismatch');
 const logScores=hypotheses.map((_,i)=>{let s=Math.log(Math.max(Number(priors[i]),Number.MIN_VALUE));for(const ev of evidenceLikelihoods||[]){const l=Number(ev.likelihoods?.[i]);if(!(l>0&&l<=1))throw new RangeError('likelihoods must be in (0,1]');s+=Math.log(l);}return s;});
 const m=Math.max(...logScores); const raw=logScores.map(s=>Math.exp(s-m)); const p=normalize(raw);
 const ranking=hypotheses.map((h,i)=>({hypothesis:h,posterior:p[i]})).sort((a,b)=>b.posterior-a.posterior);
 return Object.freeze({posterior:p,ranking,entropyNats:-p.reduce((s,x)=>s+(x>0?x*Math.log(x):0),0)});
}

// Correlation-aware evidence fusion: covariance is supplied by the calibration layer.
function gaussianInformationFusion(observations){
 if(!Array.isArray(observations)||!observations.length)throw new TypeError('observations required');
 let precision=0,weighted=0; for(const o of observations){const v=finite(o.variance,'variance');if(v<=0)throw new RangeError('variance must be > 0');const y=finite(o.value,'value');precision+=1/v;weighted+=y/v;}
 const variance=1/precision, mean=weighted/precision; return Object.freeze({mean,variance,stdDev:Math.sqrt(variance),assumption:'INDEPENDENT_GAUSSIAN'});
}
function correlatedGaussianFusion(values,covariance){
 const S=require('./statistics'); return S.generalizedLeastSquares(values,covariance);
}
module.exports={posterior,gaussianInformationFusion,correlatedGaussianFusion};

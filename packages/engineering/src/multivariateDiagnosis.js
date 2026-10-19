'use strict';
const S=require('./statistics');
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function pos(x,n){const v=finite(x,n);if(v<=0)throw new RangeError(`${n} must be > 0`);return v;}
function logSumExp(xs){const m=Math.max(...xs);return m+Math.log(xs.reduce((s,x)=>s+Math.exp(x-m),0));}
function mvnLogLikelihood(x, mean, covariance){
 if(!Array.isArray(x)||!Array.isArray(mean)||x.length!==mean.length)throw new TypeError('x/mean dimension mismatch');
 if(!Array.isArray(covariance)||covariance.length!==x.length)throw new TypeError('covariance dimension mismatch');
 const delta=x.map((v,i)=>finite(v,`x[${i}]`)-finite(mean[i],`mean[${i}]`));
 const L=S.cholesky(covariance); const inv=S.inverse(covariance);
 const q=S.quadraticForm(delta,inv);
 const logDet=2*L.reduce((acc,row,i)=>acc+Math.log(row[i]),0);
 const k=x.length;
 return -0.5*(k*Math.log(2*Math.PI)+logDet+q);
}
/** QDA/Bayesian discriminant with full covariance per hypothesis. */
function gaussianClassifier({x,hypotheses,priors}){
 if(!Array.isArray(hypotheses)||!hypotheses.length)throw new TypeError('hypotheses required');
 if(!Array.isArray(priors)||priors.length!==hypotheses.length)throw new TypeError('priors mismatch');
 const logs=hypotheses.map((h,i)=>{
  const prior=finite(priors[i],`priors[${i}]`);if(prior<=0)throw new RangeError('priors must be > 0');
  return Math.log(prior)+mvnLogLikelihood(x,h.mean,h.covariance);
 });
 const z=logSumExp(logs), posterior=logs.map(v=>Math.exp(v-z));
 const ranking=hypotheses.map((h,i)=>({hypothesis:h.id??i,posterior:posterior[i],logScore:logs[i]})).sort((a,b)=>b.posterior-a.posterior);
 return Object.freeze({posterior,ranking,entropyNats:-posterior.reduce((s,p)=>s+(p>0?p*Math.log(p):0),0),model:'Gaussian QDA with hypothesis-specific covariance',assumptions:['features jointly Gaussian within each hypothesis','covariance matrices are calibrated positive definite']});
}
module.exports={mvnLogLikelihood,gaussianClassifier};

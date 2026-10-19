'use strict';
/*
 * Validation & Benchmarking Lab.
 * Deliberately refuses to invent thresholds, labels, costs, class priors or
 * deployment claims. All acceptance criteria must be supplied by the owner.
 */
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function probability(x,n){const v=finite(x,n);if(v<0||v>1)throw new RangeError(`${n} must be in [0,1]`);return v;}
function integer(x,n){const v=Number(x);if(!Number.isInteger(v)||v<0)throw new RangeError(`${n} must be a non-negative integer`);return v;}
function assertRows(rows){if(!Array.isArray(rows)||rows.length<1)throw new RangeError('rows required');return rows;}
function binary(y,n){const v=integer(y,n);if(v!==0&&v!==1)throw new RangeError(`${n} must be 0 or 1`);return v;}

function probabilisticMetrics(rows,{label='actual',prediction='probability'}={}){
  assertRows(rows);let brier=0,logLoss=0,positives=0,negatives=0;
  for(let i=0;i<rows.length;i++){
    const y=binary(rows[i][label],`${label}[${i}]`),p=probability(rows[i][prediction],`${prediction}[${i}]`);
    const eps=Number.EPSILON;const q=Math.min(1-eps,Math.max(eps,p));
    brier+=(p-y)**2;logLoss-=y*Math.log(q)+(1-y)*Math.log(1-q);if(y)positives++;else negatives++;
  }
  const n=rows.length;return Object.freeze({n,brierScore:brier/n,logLoss:logLoss/n,positives,negatives,prevalence:positives/n,metrics:['Brier score','log loss'],interpretation:'lower is better; no acceptance threshold is embedded'});
}

function confusionAtThreshold(rows,{threshold,label='actual',prediction='probability'}={}){
  const t=probability(threshold,'threshold');assertRows(rows);let tp=0,fp=0,tn=0,fn=0;
  for(let i=0;i<rows.length;i++){const y=binary(rows[i][label],`${label}[${i}]`),p=probability(rows[i][prediction],`${prediction}[${i}]`),pred=p>=t?1:0;if(pred&&y)tp++;else if(pred&&!y)fp++;else if(!pred&&!y)tn++;else fn++;}
  const sens=(tp+fn)?tp/(tp+fn):null,spec=(tn+fp)?tn/(tn+fp):null,ppv=(tp+fp)?tp/(tp+fp):null,npv=(tn+fn)?tn/(tn+fn):null;
  return Object.freeze({threshold,tp,fp,tn,fn,sensitivity:sens,specificity:spec,precision:ppv,npv,balancedAccuracy:sens!=null&&spec!=null?(sens+spec)/2:null});
}

function expectedUtilityAtThreshold(rows,{threshold,label='actual',prediction='probability',falsePositiveCost,falseNegativeCost,truePositiveBenefit=0,trueNegativeBenefit=0}={}){
  const fpCost=finite(falsePositiveCost,'falsePositiveCost'),fnCost=finite(falseNegativeCost,'falseNegativeCost'),tpBenefit=finite(truePositiveBenefit,'truePositiveBenefit'),tnBenefit=finite(trueNegativeBenefit,'trueNegativeBenefit');
  if(fpCost<0||fnCost<0)throw new RangeError('error costs must be >= 0');
  const c=confusionAtThreshold(rows,{threshold,label,prediction});
  const utility=c.tp*tpBenefit+c.tn*tnBenefit-c.fp*fpCost-c.fn*fnCost;
  return Object.freeze({...c,utility,utilityPerObservation:utility/(c.tp+c.fp+c.tn+c.fn)});
}

function calibrationBins(rows,{bins,label='actual',prediction='probability'}={}){
  const k=integer(bins,'bins');if(k<2)throw new RangeError('bins must be >= 2');assertRows(rows);
  const out=Array.from({length:k},()=>({count:0,sumP:0,sumY:0}));
  for(let i=0;i<rows.length;i++){const p=probability(rows[i][prediction],`${prediction}[${i}]`),y=binary(rows[i][label],`${label}[${i}]`);let idx=Math.min(k-1,Math.floor(p*k));out[idx].count++;out[idx].sumP+=p;out[idx].sumY+=y;}
  const result=out.map((b,i)=>({bin:i,lower:i/k,upper:(i+1)/k,count:b.count,meanPredicted:b.count?b.sumP/b.count:null,empiricalRate:b.count?b.sumY/b.count:null,absoluteGap:b.count?Math.abs(b.sumP/b.count-b.sumY/b.count):null}));
  const populated=result.filter(x=>x.count);const ece=populated.reduce((s,b)=>s+b.count/rows.length*b.absoluteGap,0);return Object.freeze({bins:result,ece,definition:'expected calibration error using fixed equal-width probability bins; bin count is a declared parameter'});
}

function temporalSplit(rows,{timeKey='time',trainFraction=0.7,validationFraction=0.15}={}){
  assertRows(rows);const tf=finite(trainFraction,'trainFraction'),vf=finite(validationFraction,'validationFraction');if(tf<=0||vf<0||tf+vf>=1)throw new RangeError('trainFraction/validationFraction must leave a non-empty test set');
  const data=rows.map((r,i)=>({r,i,t:finite(r[timeKey],`${timeKey}[${i}]`)})).sort((a,b)=>a.t-b.t||a.i-b.i);const n=data.length,nt=Math.max(1,Math.floor(n*tf)),nv=Math.max(1,Math.floor(n*vf));if(nt+nv>=n)throw new RangeError('split leaves no test rows');
  return Object.freeze({train:data.slice(0,nt).map(x=>x.r),validation:data.slice(nt,nt+nv).map(x=>x.r),test:data.slice(nt+nv).map(x=>x.r),method:'chronological split',fractions:{train:nt/n,validation:nv/n,test:(n-nt-nv)/n}});
}

function entityDisjointSplit(rows,{entityKey,trainFraction=0.7,validationFraction=0.15}={}){
  assertRows(rows);if(typeof entityKey!=='string'||!entityKey)throw new TypeError('entityKey required');const tf=finite(trainFraction,'trainFraction'),vf=finite(validationFraction,'validationFraction');if(tf<=0||vf<0||tf+vf>=1)throw new RangeError('invalid fractions');
  const groups=new Map();rows.forEach((r,i)=>{const id=String(r[entityKey]??'');if(!id)throw new TypeError(`${entityKey}[${i}] required`);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);});
  const ids=[...groups.keys()].sort();const n=ids.length,nt=Math.max(1,Math.floor(n*tf)),nv=Math.max(0,Math.floor(n*vf));if(nt+nv>=n)throw new RangeError('split leaves no test entities');
  const take=xs=>xs.flatMap(id=>groups.get(id));return Object.freeze({train:take(ids.slice(0,nt)),validation:take(ids.slice(nt,nt+nv)),test:take(ids.slice(nt+nv)),entityKey,method:'entity-disjoint deterministic split'});
}

function binaryBootstrap(rows,metricFn,{replicates=2000,seed}={}){
  assertRows(rows);const r=integer(replicates,'replicates');if(r<100)throw new RangeError('replicates must be >= 100 for an empirical interval');if(!Number.isInteger(seed))throw new TypeError('seed is required for reproducible bootstrap');
  let state=(seed>>>0);const rand=()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296;};const vals=[];for(let b=0;b<r;b++){const sample=Array.from({length:rows.length},()=>rows[Math.floor(rand()*rows.length)]);const v=finite(metricFn(sample),`metric replicate ${b}`);vals.push(v);}vals.sort((a,b)=>a-b);const q=p=>{const x=p*(vals.length-1),lo=Math.floor(x),hi=Math.ceil(x);return lo===hi?vals[lo]:vals[lo]+(vals[hi]-vals[lo])*(x-lo);};return Object.freeze({replicates:r,seed,estimate:finite(metricFn(rows),'estimate'),ci95:[q(0.025),q(0.975)],method:'nonparametric bootstrap percentile interval'});
}

function populationStabilityIndex(reference,current,{bins=10}={}){
  const k=integer(bins,'bins');if(k<2)throw new RangeError('bins must be >= 2');assertRows(reference);assertRows(current);const ref=reference.map((x,i)=>probability(x,`reference[${i}]`)),cur=current.map((x,i)=>probability(x,`current[${i}]`));const edges=Array.from({length:k+1},(_,i)=>i/k);const eps=Number.EPSILON;let psi=0;const rows=[];for(let i=0;i<k;i++){const lo=edges[i],hi=edges[i+1];const rc=ref.filter(x=>i===k-1?x>=lo&&x<=hi:x>=lo&&x<hi).length/ref.length;const cc=cur.filter(x=>i===k-1?x>=lo&&x<=hi:x>=lo&&x<hi).length/cur.length;const a=Math.max(rc,eps),b=Math.max(cc,eps);const term=(b-a)*Math.log(b/a);psi+=term;rows.push({bin:i,referenceShare:rc,currentShare:cc,contribution:term});}return Object.freeze({psi,bins:rows,method:'population stability index over fixed equal-width probability bins',interpretation:'descriptive drift statistic; acceptance threshold must be supplied externally'});}

module.exports={probabilisticMetrics,confusionAtThreshold,expectedUtilityAtThreshold,calibrationBins,temporalSplit,entityDisjointSplit,binaryBootstrap,populationStabilityIndex};

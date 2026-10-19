'use strict';
const U=require('./uncertainty');
const {normalCdf}=require('./opticalPhysics');
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function nonNeg(x,n){const v=finite(x,n);if(v<0)throw new RangeError(`${n} must be >= 0`);return v;}
function inverseNormalCdf(p){
  const q=finite(p,'p'); if(!(q>0&&q<1))throw new RangeError('p must be in (0,1)');
  const a=[-39.6968302866538,220.946098424521,-275.928510446969,138.357751867269,-30.6647980661472,2.50662827745924];
  const b=[-54.4760987982241,161.585836858041,-155.698979859887,66.8013118877197,-13.2806815528857];
  const c=[-0.00778489400243029,-0.322396458041136,-2.40075827716184,-2.54973253934373,4.37466414146497,2.93816398269878];
  const d=[0.00778469570904146,0.32246712907004,2.445134137143,3.75440866190742];
  const h=(v,x)=>v.reduce((acc,k)=>acc*x+k,0);
  if(q<0.02425){const t=Math.sqrt(-2*Math.log(q));return h(c,t)/h([d[0],d[1],d[2],d[3],1],t);}
  if(q>0.97575){const t=Math.sqrt(-2*Math.log(1-q));return -h(c,t)/h([d[0],d[1],d[2],d[3],1],t);}
  const r=q-0.5,s=r*r;return r*h(a,s)/h([b[0],b[1],b[2],b[3],b[4],1],s);
}
/** Correlated uncertainty propagation for FTTH margin.
 * m = tx - sensitivity - length*alpha - Ns*Ls - Nc*Lc - splitterExcess - explicit - designMargin.
 * var(m) = g^T Sigma g. Sigma must describe covariance of the declared inputs.
 */
function correlatedLinkMargin(p){
  p=p||{};
  const tx=finite(p.txDbm,'txDbm'), sens=finite(p.receiverSensitivityDbm,'receiverSensitivityDbm');
  const L=nonNeg(p.lengthKm||0,'lengthKm'), Ns=nonNeg(p.splices||0,'splices'), Nc=nonNeg(p.connectors||0,'connectors');
  const alpha=nonNeg(p.fiberAttenuationDbPerKm,'fiberAttenuationDbPerKm'), Ls=nonNeg(p.spliceLossDb||0,'spliceLossDb'), Lc=nonNeg(p.connectorLossDb||0,'connectorLossDb');
  const excess=nonNeg(p.splitterExcessDb||0,'splitterExcessDb'), explicit=nonNeg(p.explicitLossDb||0,'explicitLossDb'), design=nonNeg(p.designMarginDb||0,'designMarginDb');
  const meanMargin=tx-sens-L*alpha-Ns*Ls-Nc*Lc-excess-explicit-design;
  const names=['txDbm','receiverSensitivityDbm','fiberAttenuationDbPerKm','spliceLossDb','connectorLossDb','splitterExcessDb','explicitLossDb'];
  const gradient=[1,-1,-L,-Ns,-Nc,-1,-1];
  let variance;
  if(p.covariance){if(!Array.isArray(p.covariance)||p.covariance.length!==7)throw new TypeError('covariance must be 7x7 in declared parameter order'); variance=U.covarianceVarianceGradient(gradient,p.covariance);}
  else {const std=[p.txStdDb,p.sensitivityStdDb,p.fiberAttenuationStdDbPerKm!=null?L*p.fiberAttenuationStdDbPerKm:null,p.spliceLossStdDb!=null?Math.sqrt(Ns)*p.spliceLossStdDb:null,p.connectorLossStdDb!=null?Math.sqrt(Nc)*p.connectorLossStdDb:null,p.splitterExcessStdDb,p.explicitLossStdDb].map(v=>v==null?0:finite(v,'std')); variance=std.reduce((s,x)=>s+x*x,0);}
  const sigma=Math.sqrt(Math.max(0,variance));
  const serviceQuantileP= p.serviceQuantileP==null ? null : finite(p.serviceQuantileP,'serviceQuantileP');
  let lowerMargin=null;
  if(serviceQuantileP!=null){const z=inverseNormalCdf(serviceQuantileP);lowerMargin=meanMargin-z*sigma;}
  return Object.freeze({parameterOrder:names,meanMarginDb:meanMargin,stdMarginDb:sigma,varianceMarginDb2:variance,zAtZero:sigma?meanMargin/sigma:(meanMargin>=0?Infinity:-Infinity),probabilityMarginPositive:sigma?normalCdf(meanMargin/sigma):(meanMargin>0?1:meanMargin===0?0.5:0),quantileMarginDb:lowerMargin,feasible:meanMargin>=0,formula:'m=g(x); Var(m)=g^TΣg'});
}
module.exports={correlatedLinkMargin,inverseNormalCdf};

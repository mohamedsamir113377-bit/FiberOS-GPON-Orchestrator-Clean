'use strict';
const U=require('./uncertainty');
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function nonNeg(x,n){const v=finite(x,n);if(v<0)throw new RangeError(`${n} must be >= 0`);return v;}
/** Bidirectional OTDR event reconciliation for the same physical event.
 * x_A=d_A, x_B=L-d_B. If d_A and d_B are measured from opposite ends,
 * least-squares reconciliation under independent Gaussian distance errors is
 * x=(d_A + L-d_B)/2. Var(x)=(sigma_A^2+sigma_B^2)/4.
 */
function reconcileBidirectionalEvent({lengthKm,distanceAKm,distanceBKm,sigmaAKm=0,sigmaBKm=0,toleranceKm=null}){
 const L=positive(lengthKm,'lengthKm'),a=nonNeg(distanceAKm,'distanceAKm'),b=nonNeg(distanceBKm,'distanceBKm'),sa=nonNeg(sigmaAKm,'sigmaAKm'),sb=nonNeg(sigmaBKm,'sigmaBKm');
 if(a>L||b>L)throw new RangeError('event distance cannot exceed link length');
 const xA=a,xB=L-b,den=sa*sa+sb*sb;
 const x=den===0?(xA+xB)/2:(xA*sb*sb+xB*sa*sa)/den;
 const variance=den===0?0:(sa*sa*sb*sb)/den;
 const sigma=Math.sqrt(variance),discrepancy=Math.abs(xA-xB);
 const tol=toleranceKm==null?null:nonNeg(toleranceKm,'toleranceKm');
 return Object.freeze({locationFromAkm:x,stdKm:sigma,varianceKm2:variance,endpointDiscrepancyKm:discrepancy,consistent:tol==null?true:discrepancy<=tol,formula:'x=(xA/sA²+xB/sB²)/(1/sA²+1/sB²), Var(x)=1/(1/sA²+1/sB²)',method:den===0?'equal_weight':'inverse_variance'});
}
function positive(x,n){const v=finite(x,n);if(v<=0)throw new RangeError(`${n} must be > 0`);return v;}
function weightedEventConsensus(events){if(!Array.isArray(events)||!events.length)throw new TypeError('events required');let sw=0,sx=0;for(const e of events){const x=finite(e.locationKm,'locationKm'),s=nonNeg(e.sigmaKm??0,'sigmaKm');if(s===0)return Object.freeze({locationKm:x,sigmaKm:0,method:'zero_uncertainty'});const w=1/(s*s);sw+=w;sx+=w*x;}return Object.freeze({locationKm:sx/sw,sigmaKm:Math.sqrt(1/sw),method:'inverse_variance_weighted'});}
module.exports={reconcileBidirectionalEvent,weightedEventConsensus};

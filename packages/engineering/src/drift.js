'use strict';
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function standardizedResidual(current,baselineStd){const s=finite(baselineStd,'baselineStd');if(s<=0)throw new RangeError('baselineStd must be > 0');return finite(current,'current')/s;}
// Multivariate squared Mahalanobis distance. Covariance inverse must come from validated calibration data.
function mahalanobisSquared(delta,covInv){if(!Array.isArray(delta)||!Array.isArray(covInv)||covInv.length!==delta.length)throw new TypeError('dimension mismatch');let s=0;for(let i=0;i<delta.length;i++){if(covInv[i].length!==delta.length)throw new TypeError('covInv must be square');for(let j=0;j<delta.length;j++)s+=delta[i]*covInv[i][j]*delta[j];}return s;}
function driftDecision(distanceSquared,threshold){const d=finite(distanceSquared,'distanceSquared'),t=finite(threshold,'threshold');if(t<0)throw new RangeError('threshold >= 0');return Object.freeze({distanceSquared:d,threshold:t,drift:d>t,quarantine:d>t});}
module.exports={standardizedResidual,mahalanobisSquared,driftDecision};

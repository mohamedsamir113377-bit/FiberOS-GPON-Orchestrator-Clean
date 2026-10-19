'use strict';
const crypto=require('crypto');
const stable=v=>{if(v===null||typeof v!=='object')return v;if(Array.isArray(v))return v.map(stable);const o={};for(const k of Object.keys(v).sort())o[k]=stable(v[k]);return o;};
const sha256=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(stable(v))).digest('hex');
function finiteNumber(x,n){if(!Number.isFinite(x))throw new TypeError(`${n} must be finite`);return x;}
function unitSignature(unit){
 if(typeof unit!=='object'||!unit)throw new TypeError('UNIT_SIGNATURE_REQUIRED');
 const out={}; for(const [k,v] of Object.entries(unit)){if(!Number.isInteger(v)||!Number.isFinite(v))throw new TypeError('UNIT_EXPONENT_INVALID'); if(v!==0)out[k]=v;}
 return Object.freeze(out);
}
function sameDimensions(a,b){const x=unitSignature(a),y=unitSignature(b);return JSON.stringify(stable(x))===JSON.stringify(stable(y));}
function assertSameDimensions(a,b,code='DIMENSION_MISMATCH'){if(!sameDimensions(a,b))throw new Error(code);return true;}
function interval(lo,hi){finiteNumber(lo,'lo');finiteNumber(hi,'hi');if(lo>hi)throw new Error('INTERVAL_INVALID');return Object.freeze({lo,hi});}
function intervalAdd(a,b){return interval(a.lo+b.lo,a.hi+b.hi);}
function intervalMul(a,b){const p=[a.lo*b.lo,a.lo*b.hi,a.hi*b.lo,a.hi*b.hi];return interval(Math.min(...p),Math.max(...p));}
function validateDomain(value,spec){
 if(typeof spec!=='object'||!spec)throw new TypeError('DOMAIN_SPEC_REQUIRED');
 if(spec.min!==undefined&&value<spec.min)return {valid:false,reason:'DOMAIN_BELOW_MIN'};
 if(spec.max!==undefined&&value>spec.max)return {valid:false,reason:'DOMAIN_ABOVE_MAX'};
 if(spec.allowed!==undefined&&(!Array.isArray(spec.allowed)||!spec.allowed.includes(value)))return {valid:false,reason:'DOMAIN_NOT_ALLOWED'};
 return {valid:true};
}
function validateAssumptions(assumptions,{evidenceIds=[],now=Date.now()}={}){
 if(!Array.isArray(assumptions)||!assumptions.length)throw new Error('ASSUMPTIONS_REQUIRED');
 const evidence=new Set(evidenceIds);const failures=[];
 for(const a of assumptions){if(!a||typeof a!=='object')failures.push('ASSUMPTION_INVALID');else{
  if(a.evidenceId&&!evidence.has(a.evidenceId))failures.push(`MISSING_ASSUMPTION_EVIDENCE:${a.id||'unknown'}`);
  if(a.expiresAt!==undefined&&(!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<now))failures.push(`ASSUMPTION_EXPIRED:${a.id||'unknown'}`);
  if(a.status&&a.status!=='VALID')failures.push(`ASSUMPTION_STATUS:${a.id||'unknown'}`);
 }}
 return Object.freeze({valid:failures.length===0,failures});
}
function finiteDifferenceJacobian(fn,x,{step=1e-6}={}){
 if(typeof fn!=='function'||!Array.isArray(x)||!x.every(Number.isFinite))throw new Error('JACOBIAN_INPUT_INVALID');
 if(!(step>0)||!Number.isFinite(step))throw new Error('JACOBIAN_STEP_INVALID');
 const y0=fn(x.slice()); if(!Array.isArray(y0)||!y0.every(Number.isFinite))throw new Error('JACOBIAN_OUTPUT_INVALID');
 const J=Array.from({length:y0.length},()=>Array(x.length).fill(0));
 for(let j=0;j<x.length;j++){const h=step*Math.max(1,Math.abs(x[j]));const xp=x.slice(),xm=x.slice();xp[j]+=h;xm[j]-=h;const yp=fn(xp),ym=fn(xm);if(!Array.isArray(yp)||!Array.isArray(ym)||yp.length!==y0.length)throw new Error('JACOBIAN_OUTPUT_SHAPE');for(let i=0;i<y0.length;i++)J[i][j]=(yp[i]-ym[i])/(2*h);}
 return Object.freeze(J.map(r=>Object.freeze(r)));
}
function conditionNumber1(A){
 if(!Array.isArray(A)||!A.length||!A.every(r=>Array.isArray(r)&&r.length===A.length))throw new Error('MATRIX_SQUARE_REQUIRED');
 const n=A.length;const norm=Math.max(...Array.from({length:n},(_,j)=>A.reduce((s,r)=>s+Math.abs(r[j]),0))); if(!(norm>0))return Infinity;
 const M=A.map(r=>r.slice());let invNorm=0;
 for(let col=0;col<n;col++){const b=Array(n).fill(0);b[col]=1;const x=solveLinearSystem(M,b);const s=x.reduce((a,v)=>a+Math.abs(v),0);if(s>invNorm)invNorm=s;}
 return norm*invNorm;
}
function solveLinearSystem(A,b){const n=A.length, M=A.map((r,i)=>r.slice().concat(b[i]));for(let k=0;k<n;k++){let p=k;for(let i=k+1;i<n;i++)if(Math.abs(M[i][k])>Math.abs(M[p][k]))p=i;if(Math.abs(M[p][k])<Number.EPSILON*10)throw new Error('SINGULAR_MATRIX');[M[k],M[p]]=[M[p],M[k]];for(let i=k+1;i<n;i++){const f=M[i][k]/M[k][k];for(let j=k;j<=n;j++)M[i][j]-=f*M[k][j];}}
 const x=Array(n);for(let i=n-1;i>=0;i--){let s=M[i][n];for(let j=i+1;j<n;j++)s-=M[i][j]*x[j];x[i]=s/M[i][i];}return x;}
function assessNumericalStability(fn,input,{relativePerturbation=1e-8,maxCondition=null}={}){
 if(typeof fn!=='function'||!Array.isArray(input)||!input.every(Number.isFinite))throw new Error('STABILITY_INPUT_INVALID');
 const y0=fn(input.slice());if(!Array.isArray(y0)||!y0.every(Number.isFinite))return {stable:false,reason:'NONFINITE_BASE_OUTPUT'};
 if(!(relativePerturbation>0)||!Number.isFinite(relativePerturbation))throw new Error('STABILITY_PERTURBATION_INVALID');
 let conditionEstimate=0;
 for(let j=0;j<input.length;j++){const h=relativePerturbation*Math.max(1,Math.abs(input[j]));const xp=input.slice(),xm=input.slice();xp[j]+=h;xm[j]-=h;const yp=fn(xp),ym=fn(xm);
  for(let i=0;i<y0.length;i++){if(!Number.isFinite(yp[i])||!Number.isFinite(ym[i]))return {stable:false,reason:'NONFINITE_PERTURBED_OUTPUT'};const outScale=Math.max(1,Math.abs(y0[i]));const inputScale=Math.max(1,Math.abs(input[j]));const relInput=h/inputScale;const relOutput=Math.abs(yp[i]-ym[i])/(2*outScale);conditionEstimate=Math.max(conditionEstimate,relInput===0?Infinity:relOutput/relInput);}
 }
 if(maxCondition!==null && (!(maxCondition>=0)||!Number.isFinite(maxCondition)))throw new Error('MAX_CONDITION_INVALID');
 return Object.freeze({stable:maxCondition===null?null:conditionEstimate<=maxCondition,conditionEstimate,relativePerturbation,maxCondition});
}
function gaussianVariance(jacobian,covariance){
 if(!Array.isArray(jacobian)||jacobian.length!==1)throw new Error('SCALAR_JACOBIAN_REQUIRED');const g=jacobian[0];const n=g.length;if(!Array.isArray(covariance)||covariance.length!==n||!covariance.every(r=>Array.isArray(r)&&r.length===n))throw new Error('COVARIANCE_SHAPE_INVALID');let v=0;for(let i=0;i<n;i++){for(let j=0;j<n;j++){if(!Number.isFinite(covariance[i][j]))throw new Error('COVARIANCE_NONFINITE');v+=g[i]*covariance[i][j]*g[j];}}if(v< -1e-12)throw new Error('NEGATIVE_PROPAGATED_VARIANCE');return Math.max(0,v);}
function validityCertificate(input){
 const {modelId,modelVersion,domain,units,assumptions,evidenceIds,numerical,validation,baseline}=input||{};for(const [k,v] of Object.entries({modelId,modelVersion,domain,units,assumptions}))if(v===undefined)throw new Error(`MISSING_${k.toUpperCase()}`);
 const ass=validateAssumptions(assumptions,{evidenceIds});const reasons=[];if(!ass.valid)reasons.push(...ass.failures);if(validation!==true)reasons.push('VALIDATION_NOT_PROVEN');if(baseline!==true)reasons.push('BASELINE_SUPERIORITY_NOT_PROVEN');if(numerical!==true)reasons.push('NUMERICAL_SAFETY_NOT_PROVEN');
 const payload={kind:'fiberos.validity-certificate',version:1,modelId,modelVersion,domain:stable(domain),units:stable(units),assumptions:stable(assumptions),evidenceIds:stable(evidenceIds||[]),numerical,validation,baseline,reasons,status:reasons.length?'INVALID':'VALID'};return Object.freeze({...payload,certificateHash:sha256(payload)});
}
function verifyCertificate(c){if(!c||c.kind!=='fiberos.validity-certificate'||typeof c.certificateHash!=='string')return {valid:false,reason:'INVALID_CERTIFICATE'};const p={...c};delete p.certificateHash;return Object.freeze({valid:sha256(p)===c.certificateHash,status:c.status});}
module.exports={stable,sha256,unitSignature,sameDimensions,assertSameDimensions,interval,intervalAdd,intervalMul,validateDomain,validateAssumptions,finiteDifferenceJacobian,conditionNumber1,assessNumericalStability,gaussianVariance,validityCertificate,verifyCertificate};

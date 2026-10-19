'use strict';

function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function squareMatrix(A,n='matrix'){if(!Array.isArray(A)||!A.length||A.some(r=>!Array.isArray(r)||r.length!==A.length))throw new TypeError(`${n} must be square`);return A;}
function symmetrize(A){return A.map((r,i)=>r.map((v,j)=>(Number(v)+Number(A[j][i]))/2));}
function cholesky(A){
  squareMatrix(A); const S=symmetrize(A); const n=S.length; const L=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++) for(let j=0;j<=i;j++){
    let sum=finite(S[i][j],`matrix[${i}][${j}]`);
    for(let k=0;k<j;k++) sum-=L[i][k]*L[j][k];
    if(i===j){ if(!(sum>1e-14)) throw new RangeError('matrix must be positive definite'); L[i][j]=Math.sqrt(sum); }
    else L[i][j]=sum/L[j][j];
  }
  return L;
}
function inverse(A){
  squareMatrix(A); const n=A.length; const M=A.map((r,i)=>r.map((v,j)=>finite(v,`matrix[${i}][${j}]`)).concat(Array.from({length:n},(_,k)=>k===i?1:0)));
  for(let c=0;c<n;c++){
    let p=c; for(let r=c+1;r<n;r++) if(Math.abs(M[r][c])>Math.abs(M[p][c])) p=r;
    if(Math.abs(M[p][c])<1e-15) throw new RangeError('singular matrix');
    [M[c],M[p]]=[M[p],M[c]]; const q=M[c][c]; for(let j=0;j<2*n;j++) M[c][j]/=q;
    for(let r=0;r<n;r++) if(r!==c){const f=M[r][c]; if(f!==0) for(let j=0;j<2*n;j++) M[r][j]-=f*M[c][j];}
  }
  return M.map(r=>r.slice(n));
}
function quadraticForm(x,A){
  squareMatrix(A); if(x.length!==A.length) throw new TypeError('dimension mismatch'); let s=0;
  for(let i=0;i<x.length;i++){const xi=finite(x[i],`x[${i}]`); for(let j=0;j<x.length;j++) s+=xi*finite(A[i][j],`matrix[${i}][${j}]`)*finite(x[j],`x[${j}]`);} return s;
}
function covarianceVarianceGradient(gradient,covariance){
  if(!Array.isArray(gradient)||!Array.isArray(covariance)||gradient.length!==covariance.length) throw new TypeError('dimension mismatch');
  cholesky(covariance); const v=quadraticForm(gradient,covariance); if(v<0 && v>-1e-12) return 0; if(v<0) throw new RangeError('negative propagated variance'); return v;
}
function gaussianProbabilityPositive(mean,std,threshold=0){const m=finite(mean,'mean'),s=finite(std,'std'),t=finite(threshold,'threshold'); if(s<0)throw new RangeError('std must be >= 0'); if(s===0)return m>t?1:m===t?0.5:0; const z=(m-t)/s; return 1-require('./opticalPhysics').normalCdf(-z);}
module.exports={cholesky,inverse,quadraticForm,covarianceVarianceGradient,gaussianProbabilityPositive};

'use strict';
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function squareMatrix(A,n){if(!Array.isArray(A)||!A.length||A.some(r=>!Array.isArray(r)||r.length!==A.length))throw new TypeError(`${n} must be square`);return A;}
function inverse(A){
  squareMatrix(A,'matrix'); const n=A.length; const M=A.map((r,i)=>r.map((v,j)=>finite(v,`matrix[${i}][${j}]`)).concat(Array.from({length:n},(_,k)=>k===i?1:0)));
  for(let c=0;c<n;c++){
    let p=c; for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
    if(Math.abs(M[p][c])<1e-15)throw new RangeError('singular matrix');
    [M[c],M[p]]=[M[p],M[c]]; const q=M[c][c]; for(let j=0;j<2*n;j++)M[c][j]/=q;
    for(let r=0;r<n;r++)if(r!==c){const f=M[r][c];if(f!==0)for(let j=0;j<2*n;j++)M[r][j]-=f*M[c][j];}
  }
  return M.map(r=>r.slice(n));
}
function cholesky(A){
  squareMatrix(A,'matrix'); const n=A.length; const L=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++){ for(let j=0;j<=i;j++){ let sum=A[i][j]; for(let k=0;k<j;k++)sum-=L[i][k]*L[j][k]; if(i===j){if(!(sum>1e-14))throw new RangeError('matrix must be positive definite'); L[i][j]=Math.sqrt(sum);} else L[i][j]=sum/L[j][j]; }}
  return L;
}
function quadraticForm(x,A){squareMatrix(A,'matrix');if(x.length!==A.length)throw new TypeError('dimension mismatch');let s=0;for(let i=0;i<x.length;i++){const xi=finite(x[i],`x[${i}]`);for(let j=0;j<x.length;j++)s+=xi*finite(A[i][j],`matrix[${i}][${j}]`)*finite(x[j],`x[${j}]`);}return s;}
function generalizedLeastSquares(values,covariance){
  if(!Array.isArray(values)||!values.length)throw new TypeError('values required');
  const S=squareMatrix(covariance,'covariance');if(S.length!==values.length)throw new TypeError('dimension mismatch');
  cholesky(S);
  const inv=inverse(S);let denom=0,num=0;for(let i=0;i<values.length;i++){const vi=finite(values[i],`values[${i}]`);for(let j=0;j<values.length;j++){const w=inv[i][j];denom+=w;num+=w*vi;}}
  if(!(denom>0))throw new RangeError('non-positive information'); const mean=num/denom,variance=1/denom;
  return Object.freeze({mean,variance,stdDev:Math.sqrt(variance),information:denom});
}
module.exports={inverse,cholesky,quadraticForm,generalizedLeastSquares};

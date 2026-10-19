#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {verifyBearerTokenAsync}=require('../../packages/security/src/jwt');

async function main(){
  const env={...process.env,NODE_ENV:'production'};
  for(const k of ['OIDC_JWKS_URL','OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_ALLOWED_HOSTS','OIDC_TEST_BEARER']){
    if(!String(env[k]||'').trim()) throw new Error('REQUIRED_ENV_MISSING:'+k);
  }
  const result=await verifyBearerTokenAsync(env.OIDC_TEST_BEARER,env);
  assert.equal(result.ok,true,'OIDC/JWKS token verification failed: '+String(result.error||'unknown'));
  assert.equal(result.verified,true,'OIDC result was not cryptographically verified');
  assert.equal(result.principal.sub.length>0,true);
  console.log(JSON.stringify({
    ok:true,
    evidenceClass:'LIVE_EXTERNAL_OIDC_JWKS',
    productionCertification:false,
    issuer:env.OIDC_ISSUER,
    audience:env.OIDC_AUDIENCE,
    subjectPresent:true,
    verified:true
  },null,2));
}
main().catch(e=>{console.error(JSON.stringify({ok:false,error:e.message,code:e.code||null},null,2));process.exitCode=1});

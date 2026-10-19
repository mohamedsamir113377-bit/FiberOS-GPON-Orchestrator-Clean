#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),API=path.join(ROOT,'services','api','src');
function walk(dir){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())out.push(...walk(f));else if(e.name.endsWith('.js'))out.push(f);}return out;}
const failures=[],reviews=[];
for(const file of walk(API)){
  const text=fs.readFileSync(file,'utf8'),rel=path.relative(ROOT,file);
  if(/\beval\s*\(|\bnew\s+Function\s*\(/.test(text))failures.push(rel+': dynamic code execution primitive');
  if(/child_process[\s\S]{0,500}(?:body|req|request|input)\./.test(text))failures.push(rel+': request-derived child-process surface');
  if(/(?:fetch|axios\.(?:get|post|request))\s*\([\s\S]{0,300}(?:body|req|request|input)\./.test(text))reviews.push(rel+': outbound URL source requires SSRF review');
  if(/\b(?:body|input|request)\.(?:tenantId|tenant_id)\b/.test(text)&&!/(TENANT_ID_FORBIDDEN|TENANT_AUTHORITY_FORBIDDEN)/.test(text))
    failures.push(rel+': direct client tenant field without explicit rejection guard');
  const mutation=/method\s*===\s*['"](?:POST|PUT|PATCH|DELETE)['"]/.test(text);
  const oidcAuthHandshake=rel.endsWith('/routes/auth/oidc.js') &&
    text.includes("OIDC_STATE_INVALID") &&
    text.includes("CSRF_TOKEN_REQUIRED") &&
    text.includes("originAllowed");
  if(mutation && !oidcAuthHandshake && !/requireVerifiedPrincipal|requireAnyRole|withPrincipal/.test(text))
    failures.push(rel+': mutation-bearing source lacks visible auth/database boundary');
  if(oidcAuthHandshake) {
    if(!text.includes("cookies.fiberos_oidc_state !== state")) failures.push(rel+': OIDC callback must bind authorization state to the browser session');
    if(!text.includes("CSRF_TOKEN_REQUIRED")) failures.push(rel+': OIDC logout must require the session CSRF token');
    if(!text.includes("CSRF_ORIGIN_REJECTED")) failures.push(rel+': OIDC logout must enforce the configured origin');
  }
}
if(failures.length){console.error('STATIC_SECURITY_SURFACE_FAIL');for(const f of failures)console.error(' - '+f);process.exit(1);}
for(const r of reviews)console.warn('STATIC_SECURITY_SURFACE_REVIEW: '+r);
console.log('STATIC_SECURITY_SURFACE_PASS: high-confidence forbidden primitives and unguarded tenant fields were not detected.');

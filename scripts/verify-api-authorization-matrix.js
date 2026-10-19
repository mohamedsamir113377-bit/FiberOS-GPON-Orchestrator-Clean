#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),API=path.join(ROOT,'services','api','src');
const matrix=JSON.parse(fs.readFileSync(path.join(ROOT,'config','api-authorization-matrix.v1.json'),'utf8'));
function walk(dir){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())out.push(...walk(f));else if(e.name.endsWith('.js'))out.push(f);}return out;}
const sources=walk(API).map(file=>({file,text:fs.readFileSync(file,'utf8')}));
const failures=[];
for(const family of matrix.routeFamilies){
  const members=sources.filter(x=>x.text.includes(family.pattern));
  if(!members.length){failures.push(family.family+': route family pattern not found');continue;}
  for(const m of members){
    const mutation=/method\s*===\s*['"](?:POST|PUT|PATCH|DELETE)['"]/.test(m.text);
    if(mutation&&!/requireVerifiedPrincipal|requireAnyRole|withPrincipal/.test(m.text))
      failures.push(family.family+': mutation source lacks visible auth/database boundary: '+path.relative(ROOT,m.file));
    const directTenant=/\b(?:body|input|request)\.(?:tenantId|tenant_id)\b/.test(m.text);
    if(directTenant&&!/(TENANT_ID_FORBIDDEN|TENANT_AUTHORITY_FORBIDDEN|tenant[^\n]{0,50}forbidden)/i.test(m.text))
      failures.push(family.family+': client tenant field is not visibly rejected: '+path.relative(ROOT,m.file));
  }
}
if(failures.length){console.error('API_AUTHORIZATION_MATRIX_FAIL');for(const f of failures)console.error(' - '+f);process.exit(1);}
console.log('API_AUTHORIZATION_MATRIX_PASS: route-family authority boundaries are statically represented.');

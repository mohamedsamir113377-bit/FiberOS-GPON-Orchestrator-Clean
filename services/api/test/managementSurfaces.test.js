'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('management surfaces are centrally wired and explicitly authorized',()=>{
  const server=read('services/api/src/server.js');
  const policy=read('services/api/src/routeAuthorizationPolicy.js');
  for(const route of [
    '/v1/audit/events',
    '/v1/notifications/center',
    '/v1/migration-center/overview',
    '/v1/workflows/overview',
    '/v1/operations/workload-balance',
    '/v1/security/rbac/effective',
    '/v1/subcontractors/overview',
    '/v1/smart-inventory/overview',
    '/v1/operations/timeline','/v1/organization/operating-model',
    '/v1/security/zero-trust/readiness','/v1/contact-center/languages',
    '/v1/enterprise/fiber-dna/'
  ]){
    assert.ok(server.includes(route),'server missing '+route);
    assert.ok(route === '/v1/enterprise/fiber-dna/' ? policy.includes('enterprise\\/fiber-dna') : policy.includes(route),'policy missing '+route);
  }
});

test('notification enqueue carries the database-required tenant_id',()=>{
  const source=read('services/api/src/productization.js');
  assert.match(source,/insert into outbox_events\(tenant_id,aggregate_type,aggregate_id,event_type,payload\)/);
  assert.match(source,/values \(\$1::uuid,'communication',\$2,\$3,\$4::jsonb\)/);
  assert.match(source,/\[tenantId, aggregateId, 'communication\.requested\.' \+ channel, JSON\.stringify\(payload\)\]/);
});

test('organization operating model exposes every root-to-fruit contract without inventing tenant departments',()=>{
  const { ORGANIZATION_DEPARTMENT_PROFILES, ENTERPRISE_DEPARTMENT_TYPES, ORGANIZATION_COVERAGE_FIELDS } = require('../src/routes/managementSurfaces');
  const expected=['NETWORK_OPERATIONS','CONSTRUCTION','FIELD','CALL_CENTER','WAREHOUSE','ENGINEERING'];
  assert.deepEqual(Object.keys(ORGANIZATION_DEPARTMENT_PROFILES).sort(),expected.sort());
  for(const code of expected){
    const p=ORGANIZATION_DEPARTMENT_PROFILES[code];
    for(const key of ['roles','workflowSurfaces','slaSurfaces','queueSurfaces']) assert.ok(key in p,code+' missing '+key);
  }
  assert.deepEqual(ORGANIZATION_COVERAGE_FIELDS,['departmentIdentity','authorityPositions','scopeAuthority','workflow','sla','kpi','dashboard','queue','evidence','events','audit','escalation','executiveRollup']);
  assert.deepEqual(ENTERPRISE_DEPARTMENT_TYPES,[
    'corporate','sector','regional','central','team','network','field','warehouse',
    'data_noc','planning','engineering','quality','hse','procurement','finance',
    'hr','customer','security','other'
  ]);
});

test('organization operating model does not depend on unauthorized dashboard-table reads and fails closed on scope-read errors',()=>{
  const source=read('services/api/src/routes/managementSurfaces.js');
  assert.doesNotMatch(source,/from enterprise_dashboard_contracts/);
  assert.doesNotMatch(source,/enterprise_scope_grants[\s\S]{0,500}\.catch\(\(\)=>\(\{rows:\[\]\}\)\)/);
  assert.match(source,/status\s*=\s*!departmentTypeKnown\s*\?\s*'INVALID_DEPARTMENT_TYPE'/);
});


test('organization authority positions are a tenant-backed hierarchy and detect cycles',()=>{
  const { buildAuthorityPath } = require('../src/routes/managementSurfaces');
  const p1={id:'p1',title:'Executive',authority_level:100,department_id:'d1',user_id:'u1',manager_position_id:null};
  const p2={id:'p2',title:'Manager',authority_level:80,department_id:'d1',user_id:'u2',manager_position_id:'p1'};
  const p3={id:'p3',title:'Lead',authority_level:60,department_id:'d1',user_id:'u3',manager_position_id:'p2'};
  const index=new Map([p1,p2,p3].map(p=>[p.id,p]));
  assert.deepEqual(buildAuthorityPath(p3,index).map(x=>x.id),['p1','p2','p3']);

  const cycleA={...p2,manager_position_id:'p3'};
  const cycleIndex=new Map([p2,p3,cycleA].map(p=>[p.id,p]));
  const cyclePath=buildAuthorityPath(cycleA,cycleIndex);
  assert.ok(cyclePath.includes('[CYCLE_DETECTED]'));
});

test('management surfaces preserve explicit truth boundaries',()=>{
  const source=read('services/api/src/routes/managementSurfaces.js');
  assert.match(source,/deliveryAuthority:\s*'EXTERNAL_PROVIDER_WORKER_ONLY'/);
  assert.match(source,/notAuditLog\s*:\s*true/);
  assert.match(source,/clientCannotAuthorCanonicalPayload\s*:\s*true/);
  assert.match(source,/productionEvidenceStillRequired/);
});

test('command center UI is wired to the executable governance surfaces',()=>{
  const html=require('node:fs').readFileSync(require('node:path').join(root,'apps/ops-web/public/enterprise-command.html'),'utf8');
  const js=require('node:fs').readFileSync(require('node:path').join(root,'apps/ops-web/public/enterprise-command.js'),'utf8');
  for(const endpoint of [
    '/v1/audit/events','/v1/notifications/center','/v1/migration-center/overview',
    '/v1/workflows/overview','/v1/security/rbac/effective','/v1/subcontractors/overview',
    '/v1/smart-inventory/overview','/v1/operations/workload-balance',
    '/v1/operations/timeline','/v1/security/zero-trust/readiness'
  ]) assert.ok(js.includes(endpoint),'command UI missing '+endpoint);
  assert.ok(html.includes('Management &amp; Governance'));
  assert.ok(js.includes('Promise.allSettled'));
  assert.ok(js.includes('LIVE_DATA_UNAVAILABLE'));
});

test('executive report and memory query remain explicit database-bound surfaces',()=>{
  const routes=read('services/api/src/routes/managementSurfaces.js');
  assert.match(routes,/async function memoryQuery/);
  assert.match(routes,/async function executiveReport/);
  assert.match(routes,/text\/csv; charset=utf-8/);
  assert.match(routes,/attachment; filename="fiberos-executive-radar\.csv"/);
  assert.match(routes,/DATABASE_BACKED_TRUTH_FABRIC/);
});


test('department KPI scope enforcement is delegated to the canonical database authority boundary',()=>{
  const source=read('services/api/src/routes/departmentKpis.js');
  assert.match(source,/departmentKpiScopeAllowed\(client, department\)/);
  assert.match(source,/fiberos_enterprise_department_scope_allowed\(\$1, 'department_kpi:read'\)/);
  assert.doesNotMatch(source,/departmentKpiScopeAllowed\(client, tid, department\)/);
  assert.match(source,/const tenantWide = requireAnyRole\(principal, \['exec','sysadmin'\]\)\.ok/);
  assert.match(source,/DEPARTMENT_SCOPE_REQUIRED/);

  const migration160=read('sql/migrations/160_department_scope_authority.sql');
  const migration161=read('sql/migrations/161_department_scope_authority_cycle_hardening.sql');
  for(const source of [migration160,migration161]){
    assert.match(source,/fiberos_enterprise_department_scope_allowed/);
    assert.match(source,/SECURITY DEFINER/);
    assert.match(source,/SET search_path = pg_catalog, public, auth/);
    assert.match(source,/auth\.uid\(\)/);
    assert.match(source,/ep\.active = true/);
    assert.match(source,/ep\.valid_from <= now\(\)/);
    assert.match(source,/ep\.valid_to IS NULL OR ep\.valid_to > now\(\)/);
    assert.match(source,/sg\.scope_type = 'department'/);
    assert.match(source,/p_capability = ANY\(sg\.capabilities\)/);
    assert.match(source,/sg\.valid_from <= now\(\)/);
    assert.match(source,/sg\.valid_to IS NULL OR sg\.valid_to > now\(\)/);
    assert.match(source,/REVOKE ALL ON FUNCTION public\.fiberos_enterprise_department_scope_allowed/);
    assert.match(source,/GRANT EXECUTE ON FUNCTION public\.fiberos_enterprise_department_scope_allowed/);
  }
  assert.match(migration161,/p_capability = 'department_kpi:read'/);
  assert.match(migration161,/NOT parent\.id = ANY\(child\.path\)/);
});

test('department KPI scope helper sends only the requested department and fails closed on non-true results',async()=>{
  const { departmentKpiScopeAllowed, DEPARTMENT_KPI_SCOPE_CAPABILITY } = require('../src/routes/departmentKpis');
  assert.equal(DEPARTMENT_KPI_SCOPE_CAPABILITY,'department_kpi:read');
  const calls=[];
  const allowClient={query:async(sql,params)=>{calls.push({sql,params});return {rows:[{allowed:true}]};}};
  assert.equal(await departmentKpiScopeAllowed(allowClient,'FIELD'),true);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/fiberos_enterprise_department_scope_allowed\(\$1, 'department_kpi:read'\)/);
  assert.deepEqual(calls[0].params,['FIELD']);
  const denyClient={query:async()=>({rows:[{allowed:false}]})};
  assert.equal(await departmentKpiScopeAllowed(denyClient,'FIELD'),false);
  const nullClient={query:async()=>({rows:[]})};
  assert.equal(await departmentKpiScopeAllowed(nullClient,'FIELD'),false);
});

test('department KPI role boundary keeps executive bypass explicit and does not widen manager roles',()=>{
  const source=read('services/api/src/routes/departmentKpis.js');
  assert.match(source,/\['exec','sysadmin'\]/);
  assert.match(source,/\['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc'\]/);
  assert.match(source,/scopeAuthority: tenantWide \? 'TENANT_WIDE_EXECUTIVE_ADMIN' : 'ACTIVE_POSITION_ENTERPRISE_GRANT_DESCENDANT_DEPARTMENT'/);
});

test('organization scope coverage excludes future enterprise grants',()=>{
  const source=read('services/api/src/routes/managementSurfaces.js');
  assert.match(source,/sg\.valid_from<=now\(\)/);
});


test('organization operating model does not inherit the broader dispatcher management role',()=>{
  const routes=read('services/api/src/routes/managementSurfaces.js');
  assert.match(routes,/organization:\s*\['ops_manager',\s*'area_supervisor',\s*'exec',\s*'sysadmin'\]/);
  assert.match(routes,/\['\/v1\/organization\/operating-model',\s*ROLES\.organization/);
  assert.doesNotMatch(routes,/\['\/v1\/organization\/operating-model', ROLES\.management/);
});

test('organization operating model redacts position identity outside executive/admin visibility',()=>{
  const routes=read('services/api/src/routes/managementSurfaces.js');
  assert.match(routes,/const exposePositionIdentity\s*=\s*\['exec',\s*'sysadmin'\]/);
  assert.match(routes,/identityRedacted:true/);
});


test('department-scoped KPI grants cannot read tenant-wide aggregates until source attribution exists',()=>{
  const source=read('services/api/src/routes/departmentKpis.js');
  const grantCheck=source.indexOf("if (!tenantWide && !(await departmentKpiScopeAllowed(client, department)))");
  const closedPath=source.indexOf("error: 'DEPARTMENT_KPI_DATA_SCOPE_UNAVAILABLE'");
  const dataQueries=source.indexOf('const [', closedPath);
  assert.ok(grantCheck >= 0, 'department scope grant must be checked');
  assert.ok(closedPath > grantCheck, 'granted non-executive users must still be subject to data-scope enforcement');
  assert.ok(dataQueries > closedPath, 'the fail-closed response must precede KPI source queries');
  assert.match(source, /return sendJson\(res, send, 503, \{[\s\S]*?error: 'DEPARTMENT_KPI_DATA_SCOPE_UNAVAILABLE'/);
  assert.match(source, /FAIL_CLOSED_UNTIL_DEPARTMENT_ATTRIBUTION_IS_VERIFIED/);
  assert.match(source, /const tenantWide = requireAnyRole\(principal, \['exec','sysadmin'\]\)\.ok/);
});

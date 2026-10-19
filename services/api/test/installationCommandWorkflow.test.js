'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('installation workflow has all three operational types',()=>{
  const sql=read('sql/migrations/125_installation_command_workflows.sql');
  for(const type of ['NEW_INSTALLATION','MIGRATION','ROUTER_INSTALLATION']) assert.ok(sql.includes(type));
  assert.ok(sql.includes('FORCE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('fiberos_installation_job_guard'));
});


test('customer intake captures required field categories without client tenant authority',()=>{
  const js=read('services/api/src/routes/installation.js');
  for(const token of ['serviceNumber','customerName','internetProviderName','followupMobile1','identityType','addressRegion','addressStreet','addressBuildingNumber','cabinetCode','boxCode','site_location']) assert.ok(js.includes(token),token);
  assert.ok(!js.includes('tenantId=body.tenantId'));
});

test('workflow exposes verification, dispatch, technician acceptance, evidence and feedback',()=>{
  const js=read('services/api/src/routes/installation.js');
  for(const action of ['verify','schedule','dispatch','accept','start','evidence','feedback','complete','tracking']) assert.ok(js.includes(action),action);
  assert.ok(js.includes('ST_DWithin'));
  assert.ok(js.includes('WHATSAPP'));
});

test('client-hash completion is impossible in production',()=>{
  const js=read('services/api/src/routes/installation.js');
  assert.match(js,/function allowClientHashCompletion\(\)\{[\s\S]*?NODE_ENV[\s\S]*?!==['"]production['"]/);
  assert.match(js,/allowClientHashCompletion\(\) && \(storageStatus==='CLIENT_HASH_ONLY' \|\| storageStatus==='STORAGE_UNVERIFIED'\)/);
});

test('router completion requires label scan, installation video, optical power and customer acceptance',()=>{
  const js=read('services/api/src/routes/installation.js');
  for(const token of ['ROUTER_LABEL_SCAN','ROUTER_INSTALLATION_VIDEO','OPTICAL_POWER','CUSTOMER_ACCEPTANCE']) assert.ok(js.includes(token),token);
});

test('migration 125 is registered in the production chain',()=>{
  assert.ok(read('sql/migrations/PRODUCTION_MIGRATIONS.txt').includes('125_installation_command_workflows.sql'));
  assert.ok(read('sql/migrations/PRODUCTION_MIGRATIONS.extra.sha256').includes('125_installation_command_workflows.sql'));
});


test('customer tracking is tokenized and narrowly public',()=>{
  const route=read('services/api/src/routes/installation.js');
  const auth=read('services/api/src/authorizationMiddleware.js');
  const policy=read('services/api/src/routeAuthPolicy.js');
  assert.ok(route.includes('customer_tracking_token_hash'));
  assert.ok(route.includes('trackingPagePath'));
  assert.ok(auth.includes('isPublicTracking'));
  assert.ok(auth.includes('TOKENIZED_PUBLIC_TRACKING'));
  assert.ok(policy.includes('/v1/public/installations/tracking/'));
});

test('server parses installation POST bodies',()=>{
  const server=read('services/api/src/server.js');
  assert.ok(server.includes("path.startsWith('/v1/installations/')"));
});


test('customer notification is tied to technician acceptance rather than dispatch alone',()=>{
  const js=read('services/api/src/routes/installation.js');
  const dispatchPart=js.slice(js.indexOf("if(action==='dispatch')"),js.indexOf("if(action==='accept')"));
  const acceptPart=js.slice(js.indexOf("if(action==='accept')"),js.indexOf("if(action==='start')"));
  assert.doesNotMatch(dispatchPart,/CUSTOMER_TECHNICIAN_TRACKING_LINK/);
  assert.match(acceptPart,/CUSTOMER_TECHNICIAN_TRACKING_LINK/);
});

test('installation command UI controls match its JavaScript evidence contract',()=>{
  const html=read('apps/ops-web/public/installation-command.html');
  const js=read('apps/ops-web/public/installation-command.js');
  for(const id of ['cableChecklist','routerChecklist','rxDbm','techGps']) { const count=(html.split('id="'+id+'"').length-1)+(html.split("id='"+id+"'").length-1); assert.equal(count,1,id); }
  assert.ok(js.includes("field('landlineNumber')"));
  assert.ok(!js.includes("Boolean($('cableChecklist').checked)"));
  assert.ok(!js.includes("function captureTechGps()"));
  assert.ok(js.includes("field('cableChecklist')==='true'"));
});

test('installation authorization uses the canonical principal role',()=>{
  const js=read('services/api/src/routes/installation.js');
  assert.ok(js.includes("String(principal?.role||'')"));
  assert.ok(!js.includes('Array.isArray(principal?.roles)'));
});

test('release metadata tracks the exact migration tip',()=>{
  const manifest=JSON.parse(read('SALES_PACKAGE_MANIFEST.json'));
  const contract=JSON.parse(read('config/commercial-release-contract.v1.json'));
  const inventory=JSON.parse(read('config/rls-tenant-sensitive-inventory.json'));
  const migrations=read('sql/migrations/PRODUCTION_MIGRATIONS.txt').trim().split(/\r?\n/);
  const migrationCount=migrations.length;
  const migrationRange=`001-${migrations.at(-1).slice(0,3)}`;
  assert.equal(manifest.databaseMigrations,migrationRange);
  assert.equal(contract.migrationRange,migrationRange);
  assert.equal(inventory.migrationCount,migrationCount);
  assert.equal(inventory.source.migrationCount,migrationCount);
});

test('migration 128 preserves token-bound public tracking RLS',()=>{
  const sql=read('sql/migrations/128_public_tracking_rls_bridge.sql');
  for(const token of ['technicians_public_tracking_select','technician_positions_public_tracking_select','TO fiberos_app','fiberos.public_tracking_token_hash','customer_tracking_revoked','customer_tracking_expires_at','j.tenant_id = technician_positions.tenant_id']) assert.ok(sql.includes(token),token);
  const legacy=read('sql/migrations/PRODUCTION_MIGRATIONS.sha256');
  const extra=read('sql/migrations/PRODUCTION_MIGRATIONS.extra.sha256');
  const list=read('sql/migrations/PRODUCTION_MIGRATIONS.txt');
  assert.ok(list.includes('128_public_tracking_rls_bridge.sql'));
  assert.ok(!legacy.includes('128_public_tracking_rls_bridge.sql'));
  assert.ok(extra.includes('128_public_tracking_rls_bridge.sql'));
});

test('migration 127 closes database lifecycle authority and router guard visibility',()=>{
  const sql=read('sql/migrations/127_installation_lifecycle_db_authority.sql');
  for(const token of ['fiberos_installation_lifecycle_guard','trg_installation_lifecycle_guard','router_installation_details_guard_owner_select','FOR SELECT','TO fiberos_owner']) assert.ok(sql.includes(token),token);
  assert.ok(read('sql/migrations/PRODUCTION_MIGRATIONS.txt').includes('127_installation_lifecycle_db_authority.sql'));
  const legacy=read('sql/migrations/PRODUCTION_MIGRATIONS.sha256');
  const extra=read('sql/migrations/PRODUCTION_MIGRATIONS.extra.sha256');
  assert.ok(!legacy.includes('127_installation_lifecycle_db_authority.sql'));
  assert.ok(extra.includes('127_installation_lifecycle_db_authority.sql'));
  assert.equal(fs.existsSync(path.join(root,'docs/status/website-site-build.workflow.original.yml')),false);
});

#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createPool } = require('../../packages/db/src');
const { withPrincipal } = require('../../packages/db/src/session');

const ROOT = path.resolve(__dirname, '../..');
const INVENTORY_PATH = path.join(ROOT, 'config', 'rls-tenant-sensitive-inventory.json');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const UA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010';
const SERVICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000011';
const TECH_A = '33333333-3333-4333-8333-333333333333'; // same as live-postgres-rls TA (user_id unique)
const TICKET_A = '55555555-5555-4555-8555-555555555555';

function mustDb(url, label) {
  const db = createPool({ ...process.env, DATABASE_URL: url });
  if (!db.configured) throw new Error(label + ':' + (db.reason || 'DB_NOT_CONFIGURED'));
  return db;
}

async function adminQuery(sql, params = []) {
  const db = mustDb(process.env.ADMIN_URL, 'ADMIN_DB');
  const client = await db.pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
    await db.end();
  }
}

async function appAs(sub, role, fn) {
  const db = mustDb(process.env.APP_URL, 'APP_DB');
  try {
    return await withPrincipal(db, { sub, role }, fn);
  } finally {
    await db.end();
  }
}

async function seedMutationFixtures() {
  await adminQuery(
    "insert into auth.users(id,email) values ($1,$2) on conflict(id) do nothing",
    [UA, 'runtime-adversarial-a@example.invalid']
  );
  await adminQuery(
    "insert into public.user_preferences(user_id,tenant_id,preferred_locale) values ($1,$2,'en') " +
    "on conflict(user_id) do update set tenant_id=excluded.tenant_id,preferred_locale=excluded.preferred_locale",
    [UA, A]
  );
  await adminQuery(
    "insert into public.technicians(id,user_id,tenant_id,name,skills,current_gps,is_active) " +
    "values ($1,$2,$3,'Runtime Adversarial Tech',array['fiber'],ST_SetSRID(ST_MakePoint(31.2357,30.0444),4326)::geography,true) " +
    "on conflict(id) do update set user_id=excluded.user_id,tenant_id=excluded.tenant_id,is_active=true",
    [TECH_A, UA, A]
  );
  await adminQuery(
    "insert into public.services(id,tenant_id,customer_ref) values ($1,$2,$3),($4,$5,$6) " +
    "on conflict(id) do update set tenant_id=excluded.tenant_id,customer_ref=excluded.customer_ref",
    [SERVICE_A, A, 'runtime-adversarial-a', SERVICE_B, B, 'runtime-adversarial-b']
  );
  await adminQuery(
    "insert into public.tickets(id,tenant_id,status,type,technician_id,location_coordinates) " +
    "values ($1,$2,'pending','runtime-adversarial',$3,ST_SetSRID(ST_MakePoint(31.2357,30.0444),4326)::geography) " +
    "on conflict(id) do update set tenant_id=excluded.tenant_id,status='pending',type=excluded.type,technician_id=excluded.technician_id,location_coordinates=excluded.location_coordinates",
    [TICKET_A, A, TECH_A]
  );
  await adminQuery("update public.tickets set service_id=$1 where id=$2", [SERVICE_A, TICKET_A]);
}

async function roleGraphAudit() {
  const rows = await adminQuery(
    "select r.rolname,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,pg_has_role(r.rolname,'fiberos_policy_reader','SET') AS can_set_policy_reader,r.rolbypassrls," +
    "coalesce((select array_agg(m.rolname order by m.rolname) from pg_auth_members am join pg_roles m on m.oid=am.roleid where am.member=r.oid),ARRAY[]::text[]) as memberships " +
    "from pg_roles r where r.rolname in ('fiberos_owner','fiberos_app','fiberos_migrator','fiberos_runtime','fiberos_worker','authenticated','anon') " +
    "order by r.rolname"
  );

  for (const row of rows.rows) {
    if (typeof row.memberships === 'string') {
      row.memberships = row.memberships === '{}' ? [] : row.memberships.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
    } else if (!Array.isArray(row.memberships)) {
      row.memberships = [];
    }
  }
  const by = Object.fromEntries(rows.rows.map((r) => [r.rolname, r]));
  for (const role of Object.values(by)) {
    assert.equal(role.rolsuper, false, role.rolname + ' must not be SUPERUSER');
    assert.equal(role.rolbypassrls || role.can_set_policy_reader, false, role.rolname + ' must not BYPASSRLS or SET policy_reader');
    assert.equal(role.rolcreaterole, false, role.rolname + ' must not CREATEROLE');
    assert.equal(role.rolcreatedb, false, role.rolname + ' must not CREATEDB');
  }

  assert.equal(by.fiberos_owner.rolcanlogin, false, 'fiberos_owner must be NOLOGIN');
  assert.deepEqual(by.fiberos_owner.memberships, [], 'fiberos_owner must have no memberships');

  assert.equal(by.fiberos_app.rolcanlogin, false, 'fiberos_app must be NOLOGIN');
  assert.ok(by.fiberos_app.memberships.includes('authenticated'), 'fiberos_app must inherit authenticated');

  assert.equal(by.fiberos_migrator.rolcanlogin, true, 'fiberos_migrator must be LOGIN');
  assert.equal(by.fiberos_migrator.rolinherit, false, 'fiberos_migrator must be NOINHERIT');
  assert.deepEqual(by.fiberos_migrator.memberships, ['fiberos_owner'], 'migrator membership must be owner only');

  assert.equal(by.fiberos_runtime.rolcanlogin, true, 'fiberos_runtime must be LOGIN');
  assert.equal(by.fiberos_runtime.rolinherit, false, 'fiberos_runtime must be NOINHERIT');
  assert.deepEqual(by.fiberos_runtime.memberships, ['fiberos_app'], 'runtime membership must be app only');

  assert.equal(by.fiberos_worker.rolcanlogin, true, 'fiberos_worker must be LOGIN');
  assert.equal(by.fiberos_worker.rolinherit, false, 'fiberos_worker must be NOINHERIT');
  assert.deepEqual(by.fiberos_worker.memberships, [], 'worker must have no role memberships');

  assert.equal(by.authenticated.rolcanlogin, false, 'authenticated must be NOLOGIN');
  assert.equal(by.anon.rolcanlogin, false, 'anon must be NOLOGIN');

  const createLeaks = await adminQuery(
    "select rolname from pg_roles " +
    "where rolname in ('fiberos_app','fiberos_runtime','fiberos_worker','fiberos_migrator','authenticated','anon') " +
    "and has_schema_privilege(rolname,'public','CREATE') order by rolname"
  );
  assert.deepEqual(createLeaks.rows, [], 'non-owner application identities must not CREATE in public');

  return { roles: rows.rows, publicCreateLeaks: createLeaks.rows };
}

async function sensitiveTableAudit() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const sensitive = inventory.tables.filter((x) => x && x.tenantSensitive).map((x) => x.table);

  const rows = await adminQuery(
    "select c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) as owner " +
    "from pg_class c join pg_namespace n on n.oid=c.relnamespace " +
    "where n.nspname='public' and c.relkind in ('r','p') and c.relname = any($1::text[]) order by c.relname",
    [sensitive]
  );

  const missing = sensitive.filter((t) => !rows.rows.some((r) => r.relname === t));
  assert.deepEqual(missing, [], 'inventory must match live tenant-sensitive tables');

  const weak = rows.rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity || r.owner !== 'fiberos_owner');
  assert.deepEqual(weak, [], 'all tenant-sensitive tables must be owner-bound and FORCE RLS');

  const grants = await adminQuery(
    "select table_name,grantee,privilege_type " +
    "from information_schema.role_table_grants " +
    "where table_schema='public' and grantee in ('fiberos_app','fiberos_runtime','fiberos_worker','authenticated') " +
    "and table_name = any($1::text[]) order by table_name,grantee,privilege_type",
    [sensitive]
  );

  const workerLeaks = grants.rows.filter((r) => r.grantee === 'fiberos_worker' && r.table_name !== 'outbox_events');
  assert.deepEqual(workerLeaks, [], 'worker must have no sensitive table privilege outside outbox_events');

  return { inventoryCount: sensitive.length, liveCount: rows.rows.length, weak, workerLeaks, relevantGrants: grants.rows };
}

async function securityDefinerAudit() {
  const rows = await adminQuery(
    "select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args," +
    "pg_get_userbyid(p.proowner) as owner,coalesce(p.proconfig,ARRAY[]::text[]) as config,coalesce(p.proacl,ARRAY[]::aclitem[]) as acl " +
    "from pg_proc p join pg_namespace n on n.oid=p.pronamespace " +
    "where n.nspname='public' and p.prosecdef and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.refclassid='pg_extension'::regclass and d.deptype='e') " +
    "order by p.proname,pg_get_function_identity_arguments(p.oid)"
  );

  const findings = [];
  for (const row of rows.rows) {
    const config = Array.isArray(row.config) ? row.config : [];
    const acl = Array.isArray(row.acl) ? row.acl.map(String) : [];
    const hasSearchPath = config.some((x) => /^search_path=/i.test(String(x)));
    const publicExecute = acl.some((x) => x.startsWith('=X/') || x.startsWith('=X'));
    // These scoped helpers use the NOLOGIN BYPASSRLS policy reader so FORCE RLS cannot
    // block them (migration 113; migrations 174–176; bootstrap role-grant script).
    // All other SECURITY DEFINER functions must also remain owned by fiberos_owner.
    const allowedPolicyReaderOwner =
      row.owner === 'fiberos_policy_reader' &&
      (row.proname === 'fiberos_field_technician_scope' ||
        row.proname === 'fiberos_current_tenant_id' ||
        row.proname === 'fiberos_guard_fk_tenant_match' ||
        row.proname === 'fiberos_guard_composite_fk_tenant_match' ||
        // Migration 185: boolean-only, tenant-bound area-supervisor predicates.
        row.proname === 'fiberos_area_supervisor_technician_scope' ||
        row.proname === 'fiberos_area_supervisor_ticket_scope' ||
        row.proname === 'fiberos_current_user_ticket_scope' ||
        row.proname === 'fiberos_area_supervisor_call_scope' ||
        row.proname === 'fiberos_area_supervisor_conversation_scope' ||
        row.proname === 'fiberos_area_supervisor_incident_scope');
    const ownerBad = row.owner !== 'fiberos_owner' && !allowedPolicyReaderOwner;
    if (!hasSearchPath || publicExecute || ownerBad) {
      findings.push({ ...row, hasSearchPath, publicExecute, ownerBad });
    }
  }
  assert.deepEqual(findings, [], 'FiberOS SECURITY DEFINER functions must be owner-bound, search_path-bound, and non-public');
  return { count: rows.rows.length, functions: rows.rows };
}

async function effectivePrivilegeAudit() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const sensitive = inventory.tables.filter((x) => x && x.tenantSensitive).map((x) => x.table);
  const roles = ['authenticated','fiberos_app','fiberos_runtime','fiberos_worker'];
  const dangerousPrivileges = ['TRIGGER','REFERENCES'];
  const privilegeRows = await adminQuery(
    "select r.rolname,t.table_name,p.privilege_type " +
    "from unnest($1::text[]) as r(rolname) " +
    "cross join unnest($2::text[]) as t(table_name) " +
    "cross join (values ('TRIGGER'),('REFERENCES')) as p(privilege_type) " +
    "where has_table_privilege(r.rolname,'public.' || t.table_name,p.privilege_type) " +
    "order by r.rolname,t.table_name,p.privilege_type",
    [roles, sensitive]
  );
  const findings = privilegeRows.rows;
  const workerRows = await adminQuery(
    "select t.table_name,p.privilege_type " +
    "from unnest($1::text[]) as t(table_name) " +
    "cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) as p(privilege_type) " +
    "where t.table_name <> 'outbox_events' " +
    "and has_table_privilege('fiberos_worker','public.' || t.table_name,p.privilege_type) " +
    "order by t.table_name,p.privilege_type",
    [sensitive]
  );
  const workerLeaks = workerRows.rows;

  assert.deepEqual(findings, [], 'runtime application identities must not hold TRIGGER/REFERENCES on tenant-sensitive tables');
  assert.deepEqual(workerLeaks, [], 'worker effective privileges must remain isolated from tenant-sensitive tables');

  return { dangerousPrivilegeLeaks: findings, workerEffectivePrivilegeLeaks: workerLeaks };
}

async function multiTenantFkAudit() {
  const rows = await adminQuery(
    "select con.conname,cc.relname as child_table,pp.relname as parent_table,pg_get_constraintdef(con.oid) as definition," +
    "exists(select 1 from pg_attribute ca where ca.attrelid=cc.oid and ca.attname='tenant_id' and ca.attnum=any(con.conkey)) as child_has_tenant_key," +
    "exists(select 1 from pg_attribute pa where pa.attrelid=pp.oid and pa.attname='tenant_id' and pa.attnum=any(con.confkey)) as parent_has_tenant_key " +
    "from pg_constraint con join pg_class cc on cc.oid=con.conrelid join pg_namespace cn on cn.oid=cc.relnamespace " +
    "join pg_class pp on pp.oid=con.confrelid join pg_namespace pn on pn.oid=pp.relnamespace " +
    "where con.contype='f' and cn.nspname='public' and pn.nspname='public' " +
    "and exists(select 1 from pg_attribute ca2 where ca2.attrelid=cc.oid and ca2.attname='tenant_id' and not ca2.attisdropped) " +
    "and exists(select 1 from pg_attribute pa2 where pa2.attrelid=pp.oid and pa2.attname='tenant_id' and not pa2.attisdropped) " +
    "order by cc.relname,pp.relname,con.conname"
  );

  const consistencySignals = [];
  for (const row of rows.rows) {
    consistencySignals.push({
      ...row,
      coveredByCompositeTenantKey: row.child_has_tenant_key && row.parent_has_tenant_key
    });
  }

  const staticProtected = await adminQuery(
    "select c.relname as table_name,string_agg(distinct t.tgname,',' order by t.tgname) as triggers " +
    "from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace " +
    "where n.nspname='public' and not t.tgisinternal " +
    "and pg_get_triggerdef(t.oid) ilike '%fiberos_enforce_%tenant%consistency%' " +
    "group by c.relname order by c.relname"
  );

  return {
    totalTenantBearingFks: rows.rows.length,
    compositeTenantFks: consistencySignals.filter((x) => x.coveredByCompositeTenantKey).length,
    nonCompositeTenantFks: consistencySignals.filter((x) => !x.coveredByCompositeTenantKey).length,
    triggerProtectedTables: staticProtected.rows,
    reviewRequired: consistencySignals.filter((x) => !x.coveredByCompositeTenantKey)
  };
}

async function expectBlocked(name, fn, tokens) {
  let blocked = false;
  let error = null;
  try {
    await fn();
  } catch (e) {
    error = { code: e && e.code || null, message: String(e && e.message || e) };
    const haystack = (error.code || '') + ' ' + error.message;
    blocked = tokens.some((token) => haystack.toLowerCase().includes(token.toLowerCase()));
  }
  assert.equal(blocked, true, name + ' must be blocked: ' + JSON.stringify(error));
  return { name, blocked, error };
}

async function crossTenantMutationAudit() {
  await seedMutationFixtures();

  const gucBypass = await expectBlocked(
    'ticket.status.custom-guc-bypass',
    () => appAs(UA, 'field_tech', async (c) => {
      await c.query("select set_config('fiberos.lifecycle_transition','allowed',true)");
      return c.query("update public.tickets set status='in_progress' where id=$1", [TICKET_A]);
    }),
    ['TICKET_STATUS_CHANGE_REQUIRES_LIFECYCLE_AUTHORITY','row-level security','permission denied']
  );

  const results = [];
  results.push(gucBypass);
  results.push(await expectBlocked(
    'ticket.service_id',
    () => appAs(UA, 'ops_manager', (c) => c.query('update public.tickets set service_id=$1 where id=$2', [SERVICE_B, TICKET_A])),
    ['TENANT_MISMATCH_TICKETS_SERVICE_ID','row-level security','permission denied']
  ));
  results.push(await expectBlocked(
    'service.tenant_id',
    () => appAs(UA, 'ops_manager', (c) => c.query('update public.services set tenant_id=$1 where id=$2', [B, SERVICE_A])),
    ['row-level security','permission denied']
  ));
  results.push(await expectBlocked(
    'ticket.tenant_id',
    () => appAs(UA, 'ops_manager', (c) => c.query('update public.tickets set tenant_id=$1 where id=$2', [B, TICKET_A])),
    ['row-level security','permission denied','TICKET_TENANT_SCOPE_VIOLATION','TENANT_MISMATCH_TICKET_SERVICE','TENANT_MISMATCH_TICKETS_TECHNICIAN_ID']
  ));
  return results;
}

async function ledgerConcurrencyAudit() {
  const head = await appAs(UA, 'field_tech', async (c) => (await c.query('select fiberos_hash_ledger_head() as head')).rows[0].head);
  assert.equal(typeof head, 'string', 'ledger head must be text');
  assert.equal(head.length, 64, 'ledger head must be 64 chars');

  const attempts = [
    ['1111111111111111111111111111111111111111111111111111111111111111','runtime-ledger-race-a'],
    ['2222222222222222222222222222222222222222222222222222222222222222','runtime-ledger-race-b']
  ];
  const results = await Promise.allSettled(attempts.map(([hash, eventType]) =>
    appAs(UA, 'field_tech', (c) => c.query(
      'select fiberos_append_hash_ledger($1::char(64),$2::char(64),$3::bigint,$4::text,$5::text,$6::jsonb) as block_index',
      [head, hash, Date.now(), eventType, UA, JSON.stringify({ adversarial: true })]
    ))
  ));

  const success = results.filter((x) => x.status === 'fulfilled');
  const rejected = results.filter((x) => x.status === 'rejected');
  assert.equal(success.length, 1, 'exactly one ledger append may win from the same stale head');
  assert.equal(rejected.length, 1, 'exactly one stale ledger append must fail');
  assert.match(String(rejected[0].reason && (rejected[0].reason.message || rejected[0].reason)), /LEDGER_HEAD_CHANGED_RETRY|unique|duplicate/i);

  return {
    initialHead: head,
    successes: success.length,
    rejections: rejected.length,
    rejection: { code: rejected[0].reason && rejected[0].reason.code || null, message: String(rejected[0].reason && rejected[0].reason.message || rejected[0].reason) }
  };
}

async function main() {
  const roleGraph = await roleGraphAudit();
  const sensitiveTables = await sensitiveTableAudit();
  const securityDefiners = await securityDefinerAudit();
  const effectivePrivileges = await effectivePrivilegeAudit();
  const multiTenantFks = await multiTenantFkAudit();
  const crossTenantMutations = await crossTenantMutationAudit();
  const ledgerConcurrency = await ledgerConcurrencyAudit();

  console.log(JSON.stringify({
    ok: true,
    evidenceClass: 'EPHEMERAL_CI_RUNTIME_ADVERSARIAL_DB_AUDIT',
    productionCertification: false,
    roleGraph,
    sensitiveTables,
    securityDefiners,
    effectivePrivileges,
    multiTenantFks,
    crossTenantGucBypass: 'covered by crossTenantMutationAudit',
    crossTenantMutations,
    ledgerConcurrency,
    note: 'Runtime evidence is limited to the pinned PostgreSQL/PostGIS CI database; reviewRequired FKs are reported, not automatically treated as defects.'
  }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message || e), code: e && e.code || null }, null, 2));
  process.exitCode = 1;
});

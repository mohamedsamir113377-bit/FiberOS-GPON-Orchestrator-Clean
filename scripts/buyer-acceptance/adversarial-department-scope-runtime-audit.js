#!/usr/bin/env node
'use strict';

/**
 * Runtime adversarial audit for the department KPI scope authority boundary.
 *
 * Required environment:
 *   ADMIN_URL=<privileged audit connection>
 *   APP_URL=<same production-shaped app connection used by withPrincipal>
 *
 * This script is evidence-producing only when executed against the target
 * PostgreSQL/PostGIS environment. Source presence is not runtime proof.
 */

const assert = require('node:assert/strict');
const { createPool } = require('../../packages/db/src');
const { withPrincipal } = require('../../packages/db/src/session');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const PARENT_A = '44444444-4444-4444-8444-444444444441';
const CHILD_A = '44444444-4444-4444-8444-444444444442';
const PARENT_B = '55555555-5555-4555-8555-555555555551';
const CHILD_B = '55555555-5555-4555-8555-555555555552';
const POSITION_A = '66666666-6666-4666-8666-666666666661';
const POSITION_B = '77777777-7777-4777-8777-777777777771';
const GRANT_A = '88888888-8888-4888-8888-888888888881';
const GRANT_B = '99999999-9999-4999-8999-999999999991';

const PARENT_CODE = 'RUNTIME_SCOPE_PARENT';
const CHILD_CODE = 'RUNTIME_SCOPE_CHILD';
const CHILD_B_ONLY_CODE = 'RUNTIME_SCOPE_B_ONLY';

function db(url, label) {
  const pool = createPool({ ...process.env, DATABASE_URL: url });
  if (!pool.configured) throw new Error(label + ':' + (pool.reason || 'DB_NOT_CONFIGURED'));
  return pool;
}

async function adminQuery(sql, params = []) {
  const pool = db(process.env.ADMIN_URL, 'ADMIN_DB');
  const client = await pool.pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
    await pool.end();
  }
}

async function appAs(userId, role, fn) {
  const pool = db(process.env.APP_URL, 'APP_DB');
  try {
    return await withPrincipal(pool, { sub: userId, role }, fn);
  } finally {
    await pool.end();
  }
}

async function authority(userId, departmentCode, capability = 'department_kpi:read') {
  return appAs(userId, 'ops_manager', async client => {
    const result = await client.query(
      'select public.fiberos_enterprise_department_scope_allowed($1,$2) as allowed',
      [departmentCode, capability]
    );
    return result.rows[0]?.allowed === true;
  });
}

async function cleanup() {
  await adminQuery(
    'delete from public.enterprise_scope_grants where id = any($1::uuid[])',
    [[GRANT_A, GRANT_B]]
  );
  await adminQuery(
    'delete from public.enterprise_positions where id = any($1::uuid[])',
    [[POSITION_A, POSITION_B]]
  );
  await adminQuery(
    'delete from public.enterprise_departments where id = any($1::uuid[])',
    [[CHILD_A, CHILD_B, PARENT_A, PARENT_B]]
  );
}

async function seed() {
  const tenants = await adminQuery(
    'select id from public.tenants where id = any($1::uuid[]) order by id',
    [[TENANT_A, TENANT_B]]
  );
  assert.equal(tenants.rows.length, 2, 'required adversarial tenants A/B must already exist');

  await cleanup();

  await adminQuery(
    'insert into public.enterprise_departments(id,tenant_id,code,name,department_type,parent_id,active) ' +
    "values ($1,$2,$3,'Runtime Scope Parent A','sector',null,true),($4,$2,$5,'Runtime Scope Child A','team',$1,true)",
    [PARENT_A, TENANT_A, PARENT_CODE, CHILD_A, CHILD_CODE]
  );
  await adminQuery(
    'insert into public.enterprise_departments(id,tenant_id,code,name,department_type,parent_id,active) ' +
    "values ($1,$2,$3,'Runtime Scope Parent B','sector',null,true),($4,$2,$5,'Runtime Scope Child B','team',$1,true)",
    [PARENT_B, TENANT_B, PARENT_CODE, CHILD_B, CHILD_B_ONLY_CODE]
  );

  await adminQuery(
    'insert into public.enterprise_positions(id,tenant_id,department_id,user_id,title,authority_level,manager_position_id,active,valid_from,valid_to) ' +
    "values ($1,$2,$3,$4,'Runtime Scope Authority A',100,null,true,now()-interval '1 day',null),($5,$6,$7,$8,'Runtime Scope Authority B',100,null,true,now()-interval '1 day',null)",
    [POSITION_A, TENANT_A, PARENT_A, USER_A, POSITION_B, TENANT_B, PARENT_B, USER_B]
  );
  await adminQuery(
    'insert into public.enterprise_scope_grants(id,tenant_id,position_id,scope_type,scope_id,capabilities,valid_from,valid_to,granted_by) ' +
    "values ($1,$2,$3,'department',$4,ARRAY['department_kpi:read'],now()-interval '1 day',null,$5),($6,$7,$8,'department',$9,ARRAY['department_kpi:read'],now()-interval '1 day',null,$10)",
    [GRANT_A, TENANT_A, POSITION_A, PARENT_A, USER_A, GRANT_B, TENANT_B, POSITION_B, PARENT_B, USER_B]
  );
}

async function run() {
  await seed();

  const evidence = [];

  await adminQuery(
    'delete from public.enterprise_scope_grants where id=$1',
    [GRANT_A]
  );
  evidence.push({
    scenario: 'missing-grant',
    allowed: await authority(USER_A, CHILD_CODE),
    expected: false
  });

  await adminQuery(
    'insert into public.enterprise_scope_grants(id,tenant_id,position_id,scope_type,scope_id,capabilities,valid_from,valid_to,granted_by) ' +
    "values ($1,$2,$3,'department',$4,ARRAY['department_kpi:read'],now()-interval '1 day',null,$5)",
    [GRANT_A, TENANT_A, POSITION_A, PARENT_A, USER_A]
  );
  const inherited = await authority(USER_A, CHILD_CODE);
  assert.equal(inherited, true, 'active parent department grant must cover active descendant');
  evidence.push({ scenario: 'active-parent-grant-covers-descendant', allowed: inherited, expected: true });

  await adminQuery(
    "update public.enterprise_scope_grants set valid_to=now()-interval '1 second' where id=$1",
    [GRANT_A]
  );
  const expired = await authority(USER_A, CHILD_CODE);
  assert.equal(expired, false, 'expired scope grant must deny');
  evidence.push({ scenario: 'expired-grant', allowed: expired, expected: false });

  await adminQuery(
    "update public.enterprise_scope_grants set valid_from=now()+interval '1 hour',valid_to=null where id=$1",
    [GRANT_A]
  );
  const future = await authority(USER_A, CHILD_CODE);
  assert.equal(future, false, 'future scope grant must deny');
  evidence.push({ scenario: 'future-grant', allowed: future, expected: false });

  await adminQuery(
    "update public.enterprise_scope_grants set valid_from=now()-interval '1 day',valid_to=null,capabilities=ARRAY['department_kpi:write'] where id=$1",
    [GRANT_A]
  );
  const wrongCapability = await authority(USER_A, CHILD_CODE);
  assert.equal(wrongCapability, false, 'non-read capability must not authorize KPI read');
  evidence.push({ scenario: 'wrong-capability', allowed: wrongCapability, expected: false });

  await adminQuery(
    "update public.enterprise_scope_grants set capabilities=ARRAY['department_kpi:read'],valid_from=now()-interval '1 day' where id=$1",
    [GRANT_A]
  );
  await adminQuery(
    'update public.enterprise_positions set active=false where id=$1',
    [POSITION_A]
  );
  const inactivePosition = await authority(USER_A, CHILD_CODE);
  assert.equal(inactivePosition, false, 'inactive enterprise position must deny');
  evidence.push({ scenario: 'inactive-position', allowed: inactivePosition, expected: false });

  await adminQuery(
    "update public.enterprise_positions set active=true,valid_from=now()+interval '1 hour' where id=$1",
    [POSITION_A]
  );
  const futurePosition = await authority(USER_A, CHILD_CODE);
  assert.equal(futurePosition, false, 'future enterprise position must deny');
  evidence.push({ scenario: 'future-position', allowed: futurePosition, expected: false });

  await adminQuery(
    "update public.enterprise_positions set valid_from=now()-interval '1 day' where id=$1",
    [POSITION_A]
  );
  const activeAgain = await authority(USER_A, CHILD_CODE);
  assert.equal(activeAgain, true, 'restored active/valid position and grant must authorize');
  evidence.push({ scenario: 'restored-active-position', allowed: activeAgain, expected: true });

  await adminQuery(
    'update public.enterprise_departments set active=false where id=$1',
    [PARENT_A]
  );
  const inactiveParent = await authority(USER_A, CHILD_CODE);
  assert.equal(inactiveParent, false, 'inactive parent must not extend scope to a descendant');
  evidence.push({ scenario: 'inactive-parent', allowed: inactiveParent, expected: false });

  await adminQuery(
    'update public.enterprise_departments set active=true where id=$1',
    [PARENT_A]
  );
  const tenantAStillScoped = await authority(USER_A, CHILD_CODE);
  assert.equal(tenantAStillScoped, true, 'tenant A authority must remain bound to tenant A department state');
  const crossTenantOnlyCode = await authority(USER_A, CHILD_B_ONLY_CODE);
  assert.equal(crossTenantOnlyCode, false, 'a department code that exists only in tenant B must deny for tenant A');
  evidence.push({ scenario: 'tenant-isolation-b-only-code', allowed: crossTenantOnlyCode, expected: false });

  return {
    ok: true,
    evidenceClass: 'RUNTIME_DEPARTMENT_SCOPE_AUTHORITY_ADVERSARIAL',
    productionCertification: false,
    scenarios: evidence
  };
}

run()
  .then(async result => {
    console.log(JSON.stringify(result, null, 2));
    await cleanup();
  })
  .catch(async error => {
    try { await cleanup(); } catch (cleanupError) {
      console.error(JSON.stringify({
        ok: false,
        error: String(error && error.message || error),
        code: error && error.code || null,
        cleanupError: String(cleanupError && cleanupError.message || cleanupError)
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.error(JSON.stringify({
      ok: false,
      error: String(error && error.message || error),
      code: error && error.code || null
    }, null, 2));
    process.exitCode = 1;
  });

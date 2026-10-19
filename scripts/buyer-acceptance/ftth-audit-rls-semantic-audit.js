'use strict';

const assert = require('node:assert/strict');
const { createPool } = require('../../packages/db/src');
const { withPrincipal } = require('../../packages/db/src/session');

// Dedicated identifiers keep this audit's persistent CI fixtures independent
// from the shared tenant/user constants in live-postgres-rls.js.
const TENANT_A = '77777777-7777-4777-8777-777777777001';
const TENANT_B = '77777777-7777-4777-8777-777777777002';
const USER_A = '77777777-7777-4777-8777-777777777011';
const USER_B = '77777777-7777-4777-8777-777777777012';
const PACKAGE_A = '77777777-7777-4777-8777-777777777021';
const PACKAGE_B = '77777777-7777-4777-8777-777777777022';
const TRANSITION_A = '77777777-7777-4777-8777-777777777031';
const TRANSITION_B = '77777777-7777-4777-8777-777777777032';
const DECISION_A = '77777777-7777-4777-8777-777777777041';
const DECISION_B = '77777777-7777-4777-8777-777777777042';
const COMMAND_A = '77777777-7777-4777-8777-777777777051';
const COMMAND_B = '77777777-7777-4777-8777-777777777052';

function database(url) {
  const pool = createPool({ ...process.env, DATABASE_URL: url });
  if (!pool.configured) throw new Error(pool.reason || 'DB_NOT_CONFIGURED');
  return pool;
}

async function queryAdmin(sql, params = []) {
  const pool = database(process.env.RUNTIME_ADMIN_DATABASE_URL);
  try {
    return await pool.query(sql, params);
  } finally {
    await pool.end();
  }
}

async function asUser(sub, role, fn) {
  const pool = database(process.env.RUNTIME_APP_DATABASE_URL);
  try {
    return await withPrincipal(pool, { sub, role }, fn);
  } finally {
    await pool.end();
  }
}

async function seedFixtures() {
  await queryAdmin(
    `INSERT INTO public.tenants (id, name, slug)
     VALUES ($1, 'FTTH Audit Tenant A', 'runtime-ftth-audit-a-124'),
            ($2, 'FTTH Audit Tenant B', 'runtime-ftth-audit-b-124')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B]
  );
  await queryAdmin(
    `INSERT INTO auth.users (id, email)
     VALUES ($1, 'runtime-ftth-audit-a@example.invalid'),
            ($2, 'runtime-ftth-audit-b@example.invalid')
     ON CONFLICT (id) DO NOTHING`,
    [USER_A, USER_B]
  );
  await queryAdmin(
    `INSERT INTO public.user_preferences (user_id, tenant_id, preferred_locale)
     VALUES ($1, $2, 'en'), ($3, $4, 'en')
     ON CONFLICT (user_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`,
    [USER_A, TENANT_A, USER_B, TENANT_B]
  );
  await queryAdmin(
    `INSERT INTO public.ftth_work_packages
       (id, tenant_id, code, work_type, created_by)
     VALUES ($1, $2, 'runtime-rls-a', 'other', $3),
            ($4, $5, 'runtime-rls-b', 'other', $6)
     ON CONFLICT (id) DO UPDATE
       SET tenant_id = EXCLUDED.tenant_id,
           code = EXCLUDED.code,
           work_type = EXCLUDED.work_type,
           created_by = EXCLUDED.created_by`,
    [PACKAGE_A, TENANT_A, USER_A, PACKAGE_B, TENANT_B, USER_B]
  );
  await queryAdmin(
    `INSERT INTO public.ftth_work_state_transitions
       (transition_id, work_package_id, from_state, to_state, actor_id,
        occurred_at, source, policy_version, transition_hash)
     VALUES ($1, $2, 'planned', 'ready', $3, now(), 'runtime-test', 'test-v1', $4),
            ($5, $6, 'planned', 'ready', $7, now(), 'runtime-test', 'test-v1', $8)
     ON CONFLICT (transition_id) DO UPDATE
       SET work_package_id = EXCLUDED.work_package_id,
           actor_id = EXCLUDED.actor_id,
           transition_hash = EXCLUDED.transition_hash`,
    [TRANSITION_A, PACKAGE_A, USER_A, 'runtime-rls-transition-a',
      TRANSITION_B, PACKAGE_B, USER_B, 'runtime-rls-transition-b']
  );
  await queryAdmin(
    `INSERT INTO public.ftth_command_decisions
       (decision_id, command_request_id, decision_type, actor_id, actor_scope, tenant_id, reason)
       VALUES ($1, $2, 'APPROVE', $3, 'runtime-test', $4, 'ftth-audit-fixture-a'),
              ($5, $6, 'APPROVE', $7, 'runtime-test', $8, 'ftth-audit-fixture-b')
     ON CONFLICT (decision_id) DO UPDATE
       SET command_request_id = EXCLUDED.command_request_id,
           actor_id = EXCLUDED.actor_id,
           tenant_id = EXCLUDED.tenant_id,
           reason = EXCLUDED.reason`,
    [DECISION_A, COMMAND_A, USER_A, TENANT_A,
      DECISION_B, COMMAND_B, USER_B, TENANT_B]
  );
}

async function assertInsertDenied(label, insert) {
  let error;
  try {
    await insert();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `${label}: direct authenticated INSERT must be denied`);
  assert.equal(error.code, '42501', `${label}: INSERT must fail with insufficient privilege/RLS denial`);
  assert.match(String(error.message), /row-level security|permission denied/i,
    `${label}: denial must be caused by the database security boundary`);
}

async function main() {
  assert.ok(process.env.RUNTIME_ADMIN_DATABASE_URL, 'RUNTIME_ADMIN_DATABASE_URL is required');
  assert.ok(process.env.RUNTIME_APP_DATABASE_URL, 'RUNTIME_APP_DATABASE_URL is required');
  await seedFixtures();

  const schema = await queryAdmin(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
            array_agg(p.cmd ORDER BY p.cmd) AS policy_commands,
            array_agg(p.policyname ORDER BY p.policyname) AS policy_names
       FROM pg_class AS c
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
       LEFT JOIN pg_policies AS p ON p.schemaname = n.nspname AND p.tablename = c.relname
      WHERE n.nspname = 'public'
        AND c.relname IN ('ftth_command_decisions', 'ftth_work_state_transitions')
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY c.relname`
  );
  assert.equal(schema.rows.length, 2, 'both FTTH audit tables must exist');
  for (const row of schema.rows) {
    assert.equal(row.relrowsecurity, true, `${row.relname}: RLS must be enabled`);
    assert.equal(row.relforcerowsecurity, true, `${row.relname}: FORCE RLS must be enabled`);
    assert.deepEqual(row.policy_commands, ['SELECT'],
      `${row.relname}: only the intended tenant-scoped SELECT policy may be present`);
  }

  const decisionRowsA = await asUser(USER_A, 'field_tech', (client) => client.query(
    `SELECT decision_id, tenant_id
       FROM public.ftth_command_decisions
      WHERE decision_id = ANY($1::uuid[])
      ORDER BY decision_id`, [[DECISION_A, DECISION_B]]
  ));
  assert.deepEqual(decisionRowsA.rows.map((row) => row.decision_id), [DECISION_A],
    'tenant A must read its decision and must not read tenant B decision');
  assert.equal(decisionRowsA.rows[0].tenant_id, TENANT_A);

  const transitionRowsA = await asUser(USER_A, 'field_tech', (client) => client.query(
    `SELECT transition_id
       FROM public.ftth_work_state_transitions
      WHERE transition_id = ANY($1::uuid[])
      ORDER BY transition_id`, [[TRANSITION_A, TRANSITION_B]]
  ));
  assert.deepEqual(transitionRowsA.rows.map((row) => row.transition_id), [TRANSITION_A],
    'tenant A must read only transitions whose parent work package belongs to tenant A');

  await assertInsertDenied('ftth_command_decisions', () => asUser(USER_A, 'field_tech', (client) =>
    client.query(
      `INSERT INTO public.ftth_command_decisions
         (decision_id, command_request_id, decision_type, actor_id, actor_scope, tenant_id)
       VALUES ($1, $2, 'APPROVE', $3, 'runtime-test', $4)`,
      ['77777777-7777-4777-8777-777777777043',
        '77777777-7777-4777-8777-777777777053', USER_A, TENANT_A]
    )
  ));
  await assertInsertDenied('ftth_work_state_transitions', () => asUser(USER_A, 'field_tech', (client) =>
    client.query(
      `INSERT INTO public.ftth_work_state_transitions
         (transition_id, work_package_id, from_state, to_state, actor_id,
          occurred_at, source, policy_version, transition_hash)
       VALUES ($1, $2, 'ready', 'in_progress', $3, now(), 'runtime-test', 'test-v1', $4)`,
      ['77777777-7777-4777-8777-777777777033', PACKAGE_A, USER_A, 'runtime-ftth-audit-transition-c']
    )
  ));

  const decisionUpdate = await asUser(USER_A, 'field_tech', (client) => client.query(
    'UPDATE public.ftth_command_decisions SET reason = $1 WHERE decision_id = $2',
    ['unauthorized-update', DECISION_A]
  ));
  const decisionDelete = await asUser(USER_A, 'field_tech', (client) => client.query(
    'DELETE FROM public.ftth_command_decisions WHERE decision_id = $1', [DECISION_A]
  ));
  const transitionUpdate = await asUser(USER_A, 'field_tech', (client) => client.query(
    'UPDATE public.ftth_work_state_transitions SET to_state = $1 WHERE transition_id = $2',
    ['unauthorized-update', TRANSITION_A]
  ));
  const transitionDelete = await asUser(USER_A, 'field_tech', (client) => client.query(
    'DELETE FROM public.ftth_work_state_transitions WHERE transition_id = $1', [TRANSITION_A]
  ));
  for (const [label, result] of [
    ['command decision UPDATE', decisionUpdate],
    ['command decision DELETE', decisionDelete],
    ['work-state transition UPDATE', transitionUpdate],
    ['work-state transition DELETE', transitionDelete]
  ]) {
    assert.equal(result.rowCount, 0, `${label} must be blocked by row security`);
  }

  console.log(JSON.stringify({
    ok: true,
    evidenceClass: 'EPHEMERAL_CI_RUNTIME',
    productionCertification: false,
    tables: schema.rows,
    tenantAVisibleDecisionRows: decisionRowsA.rowCount,
    tenantAVisibleTransitionRows: transitionRowsA.rowCount,
    crossTenantReadsBlocked: true,
    authenticatedInsertsBlocked: true,
    updatesBlocked: true,
    deletesBlocked: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack || String(error));
  process.exitCode = 1;
});

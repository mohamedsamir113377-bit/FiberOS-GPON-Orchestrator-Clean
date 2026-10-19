'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleDepartmentKpis, technicianRolesForTravelKpi, departmentKpiScopeAllowed } = require('../src/routes/departmentKpis');

test('technician travel KPI exposes only persisted role-assignment families', () => {
  assert.deepEqual(technicianRolesForTravelKpi('FIELD'), [
    'technician','team_lead','fiber_splicer','welder','cable_worker'
  ]);
  assert.deepEqual(technicianRolesForTravelKpi('NETWORK_OPERATIONS'), ['dispatcher','qc']);
  for (const department of ['CONSTRUCTION','CALL_CENTER','WAREHOUSE','ENGINEERING']) {
    assert.equal(technicianRolesForTravelKpi(department), null);
  }
});

test('department KPI scope delegates tenant and principal authority to the database session boundary', async () => {
  let captured;
  const allowed = await departmentKpiScopeAllowed({
    query: async (sql, values) => {
      captured = { sql, values };
      return { rows: [{ allowed: true }] };
    }
  }, 'FIELD');

  assert.equal(allowed, true);
  assert.deepEqual(captured.values, ['FIELD']);
  assert.match(captured.sql, /fiberos_enterprise_department_scope_allowed\(\$1, 'department_kpi:read'\)/);
  assert.doesNotMatch(captured.sql, /SELECT .*enterprise_positions/);
  assert.doesNotMatch(captured.sql, /user_preferences/);

  const denied = await departmentKpiScopeAllowed(
    { query: async () => ({ rows: [{ allowed: false }] }) },
    'WAREHOUSE'
  );
  assert.equal(denied, false);
});

test('department KPI scope helper fails closed when the database authority boundary errors', async () => {
  await assert.rejects(
    () => departmentKpiScopeAllowed({
      query: async () => {
        throw Object.assign(new Error('DB_SCOPE_AUTHORITY_UNAVAILABLE'), { code: 'DB_SCOPE_AUTHORITY_UNAVAILABLE' });
      }
    }, 'FIELD'),
    /DB_SCOPE_AUTHORITY_UNAVAILABLE/
  );
});

test('migration 158 grants the API read-only tenant-scoped access to enterprise scope', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const migration = fs.readFileSync(path.join(__dirname, '../../../sql/migrations/158_department_kpi_enterprise_scope.sql'), 'utf8');
  for (const table of ['enterprise_departments','enterprise_positions','enterprise_scope_grants']) {
    assert.match(migration, new RegExp('CREATE POLICY ' + table + '_app_scope_read'));
    assert.match(migration, new RegExp('ON public\\.' + table));
  }
  assert.match(migration, /GRANT SELECT/);
  assert.match(migration, /TO fiberos_app/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE/);
});

test('department KPI route is wired and fails closed without a database', async () => {
  const previousLab = process.env.FIBEROS_LAB_MODE;
  const previousVerify = process.env.JWT_VERIFY;
  process.env.FIBEROS_LAB_MODE = 'true';
  process.env.JWT_VERIFY = 'false';

  try {
    let sent = null;
    const out = await handleDepartmentKpis(
      { url: '/v1/operations/department-kpis/FIELD', method: 'GET' },
      {},
      {
        method: 'GET',
        path: '/v1/operations/department-kpis/FIELD',
        principal: { authenticated: true, role: 'ops_manager' },
        db: { configured: false },
        send: (_res, status, body) => {
          sent = { status, body };
          return sent;
        }
      }
    );

    assert.equal(out.status, 503);
    assert.equal(out.body.error, 'DATABASE_REQUIRED');
  } finally {
    if (previousLab === undefined) delete process.env.FIBEROS_LAB_MODE;
    else process.env.FIBEROS_LAB_MODE = previousLab;
    if (previousVerify === undefined) delete process.env.JWT_VERIFY;
    else process.env.JWT_VERIFY = previousVerify;
  }
});

test('department KPI route ignores unrelated paths', async () => {
  const out = await handleDepartmentKpis(
    { url: '/v1/operations/other', method: 'GET' },
    {},
    {
      method: 'GET',
      path: '/v1/operations/other',
      principal: null,
      db: null,
      send: () => {
        throw new Error('UNEXPECTED_SEND');
      }
    }
  );
  assert.equal(out, null);
});

test('department KPI endpoint denies an unowned department before reading KPI data', async () => {
  const previousLab = process.env.FIBEROS_LAB_MODE;
  const previousVerify = process.env.JWT_VERIFY;
  process.env.FIBEROS_LAB_MODE = 'true';
  process.env.JWT_VERIFY = 'false';
  let kpiQueryRan = false;
  const client = {
    query: async (sql) => {
      if (sql.includes('from user_preferences')) return { rows: [{ tenant_id: 'tenant-derived-id' }] };
      if (sql.includes('fiberos_enterprise_department_scope_allowed')) return { rows: [{ allowed: false }] };
      if (sql.includes('from public.tickets')) kpiQueryRan = true;
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  try {
    const out = await handleDepartmentKpis(
      { url: '/v1/operations/department-kpis/WAREHOUSE', method: 'GET' },
      {},
      {
        method: 'GET',
        path: '/v1/operations/department-kpis/WAREHOUSE',
        principal: { authenticated: true, role: 'dispatcher' },
        db: { configured: true, pool: { connect: async () => client } },
        send: (_res, status, body) => ({ status, body })
      }
    );
    assert.equal(out.status, 403);
    assert.equal(out.body.error, 'DEPARTMENT_SCOPE_REQUIRED');
    assert.equal(kpiQueryRan, false);
  } finally {
    if (previousLab === undefined) delete process.env.FIBEROS_LAB_MODE;
    else process.env.FIBEROS_LAB_MODE = previousLab;
    if (previousVerify === undefined) delete process.env.JWT_VERIFY;
    else process.env.JWT_VERIFY = previousVerify;
  }
});

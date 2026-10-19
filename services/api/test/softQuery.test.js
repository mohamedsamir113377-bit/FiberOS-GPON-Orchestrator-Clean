'use strict';
// R4: regression test for the C-2 fix. Before R3, a failing enrichment
// query resolved to `{rows:[]}` with nothing to distinguish it from a
// genuinely empty result — this test pins that behavior so it can't
// silently regress back to that.
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleOperations, softQuery } = require('../src/routes/operations');
const degraded = require('../../../packages/observability/src/degradedReads');

test('softQuery: a successful query returns plain rows, not degraded', async () => {
  const client = { query: async () => ({ rows: [{ id: 1 }] }) };
  const result = await softQuery(client, 'test.success', 'select 1', []);
  assert.deepEqual(result.rows, [{ id: 1 }]);
  assert.equal(result.degraded, undefined);
});

test('softQuery: a failing query never resolves to a bare {rows:[]} — it must be tagged degraded', async () => {
  const client = { query: async () => { throw new Error('connection terminated'); } };
  const result = await softQuery(client, 'test.failure', 'select 1', []);
  assert.deepEqual(result.rows, []);
  assert.equal(result.degraded, true, 'a failed read must never look identical to a real empty result');
});

test('softQuery: a failing query increments the shared degraded-read counter', async () => {
  degraded.resetForTest();
  const client = { query: async () => { throw new Error('boom'); } };
  await softQuery(client, 'test.counter', 'select 1', []);
  await softQuery(client, 'test.counter', 'select 1', []);
  assert.equal(degraded.getCount('test.counter'), 2);
});

test('operations snapshot: a failed calls query must surface dataDegraded', async () => {
  degraded.resetForTest();
  let response;
  const previousEnv = {
    JWT_VERIFY: process.env.JWT_VERIFY,
    FIBEROS_LAB_MODE: process.env.FIBEROS_LAB_MODE,
    NODE_ENV: process.env.NODE_ENV
  };
  process.env.JWT_VERIFY = 'false';
  process.env.FIBEROS_LAB_MODE = 'true';
  process.env.NODE_ENV = 'test';

  try {
    const tenantId = '00000000-0000-0000-0000-000000000010';
    const principal = {
      authenticated: true,
      verified: true,
      role: 'ops_manager',
      sub: '00000000-0000-0000-0000-000000000001'
    };

    const client = {
      async query(sql) {
        const q = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
        if (q === 'begin' || q === 'commit' || q === 'rollback') return { rows: [] };
        if (q.startsWith('select set_config(') || q === 'set local role fiberos_app') return { rows: [] };
        if (q.includes('from user_preferences')) return { rows: [{ tenant_id: tenantId }] };
        if (q.includes('from incidents')) return { rows: [] };
        if (q.includes('from tickets')) return { rows: [] };
        if (q.includes('from call_sessions')) throw new Error('connection terminated');
        return { rows: [] };
      },
      release() {}
    };

    const db = {
      configured: true,
      pool: { connect: async () => client }
    };

    await handleOperations({}, {}, {
      method: 'GET',
      path: '/v1/operations/realtime/snapshot',
      body: null,
      principal,
      db,
      send: (_res, status, body) => { response = { status, body }; }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.dataDegraded, true);
    assert.deepEqual(response.body.snapshot.calls, []);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('operations event runtime validation rejects client-supplied tenant authority before database mutation', async () => {
  let response;
  const previousEnv = {
    JWT_VERIFY: process.env.JWT_VERIFY,
    FIBEROS_LAB_MODE: process.env.FIBEROS_LAB_MODE,
    NODE_ENV: process.env.NODE_ENV
  };
  process.env.JWT_VERIFY = 'false';
  process.env.FIBEROS_LAB_MODE = 'true';
  process.env.NODE_ENV = 'test';

  try {
    const principal = {
      authenticated: true,
      verified: true,
      role: 'ops_manager',
      sub: '00000000-0000-0000-0000-000000000001'
    };
    const db = {
      configured: true,
      pool: { connect: async () => { throw new Error('database must not be touched'); } }
    };

    await handleOperations({}, {}, {
      method: 'POST',
      path: '/v1/events/runtime/validate',
      body: {
        event_id: '00000000-0000-0000-0000-000000000010',
        aggregate_type: 'ticket',
        tenant_id: '00000000-0000-0000-0000-000000000099'
      },
      principal,
      db,
      send: (_res, status, body) => { response = { status, body }; }
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'TENANT_ID_FORBIDDEN');
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

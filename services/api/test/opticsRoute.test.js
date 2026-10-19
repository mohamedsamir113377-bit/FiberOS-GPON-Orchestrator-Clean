'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  handleOpticsMeasurementSubmit
} = require('../src/routes/optics');

function buildDb({ tenantId, technicianId = null }) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params: params || [] });
      const q = String(sql).trim().toLowerCase();
      if (q === 'begin' || q === 'commit' || q === 'rollback' ||
          q.startsWith("select set_config('request.jwt.claim.sub'") ||
          q.startsWith("select set_config('request.jwt.claim.role'") ||
          q.startsWith("select set_config('request.jwt.claims'") ||
          q.startsWith("select set_config('app.tenant_id'") ||
          q.startsWith("select set_config('statement_timeout'") ||
          q === 'set local role fiberos_app') {
        return { rowCount: 0, rows: [] };
      }
      if (q.includes('select public.fiberos_current_tenant_id()')) {
        return { rowCount: 1, rows: [{ tenant_id: tenantId }] };
      }
      if (q.includes('select id from technicians')) {
        return technicianId
          ? { rowCount: 1, rows: [{ id: technicianId }] }
          : { rowCount: 0, rows: [] };
      }
      if (q.startsWith('insert into optical_measurements')) {
        return {
          rowCount: 1,
          rows: [{
            id: 1,
            measurement_type: params[1],
            value_numeric: params[2],
            unit: params[3],
            source: params[4],
            measured_at: params[7],
            asset_id: params[8],
            port_id: params[9]
          }]
        };
      }
      throw new Error('UNEXPECTED_TEST_QUERY:' + sql);
    },
    release() {}
  };
  return {
    configured: true,
    pool: { connect: async () => client },
    calls
  };
}

test('field technician measurement resolves measured_by to tenant-scoped technicians.id', async () => {
  const userSub = '11111111-1111-4111-8111-111111111111';
  const technicianId = '22222222-2222-4222-8222-222222222222';
  const tenantId = '33333333-3333-4333-8333-333333333333';
  const db = buildDb({ tenantId, technicianId });

  const result = await handleOpticsMeasurementSubmit(
    {
      measurementType: 'rx_power',
      valueNumeric: -20,
      unit: 'dBm',
      source: 'field_reading'
    },
    { authenticated: true, verified: true, role: 'field_tech', sub: userSub },
    db
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.persisted, true);

  const insert = db.calls.find(c => c.sql.toLowerCase().startsWith('insert into optical_measurements'));
  assert.ok(insert);
  assert.equal(insert.params[0], tenantId);
  assert.equal(insert.params[6], technicianId);
  assert.notEqual(insert.params[6], userSub);
});

test('field technician measurement fails closed when technician identity cannot be resolved', async () => {
  const db = buildDb({
    tenantId: '33333333-3333-4333-8333-333333333333',
    technicianId: null
  });

  const result = await handleOpticsMeasurementSubmit(
    {
      measurementType: 'rx_power',
      valueNumeric: -20,
      unit: 'dBm',
      source: 'field_reading'
    },
    {
      authenticated: true,
      verified: true,
      role: 'field_tech',
      sub: '11111111-1111-4111-8111-111111111111'
    },
    db
  );

  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'TECHNICIAN_IDENTITY_NOT_RESOLVED');
});

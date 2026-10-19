'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../public/ops-contracts');

test('crisis response tolerates missing, malformed, and null incident collections', () => {
  assert.deepEqual(contracts.crisisResponse(null), { mode: null, affectedCustomers: null, incidents: [] });
  assert.deepEqual(contracts.crisisResponse({ incidents: {} }).incidents, []);
  assert.deepEqual(contracts.crisisResponse({ incidents: [null, 'bad', { severity: 'P1', title: 'x' }] }).incidents, [
    { severity: 'P1', title: 'x', state: '', affected_customers: null }
  ]);
});

test('executive response tolerates missing financial/operations objects without inventing zeroes', () => {
  assert.deepEqual(contracts.executiveResponse({}), { issuedAmountMinor: null, openTickets: null });
  assert.deepEqual(contracts.executiveResponse({ financial: { issuedAmountMinor: 'not-a-number' }, operations: null }), {
    issuedAmountMinor: null,
    openTickets: null
  });
  assert.deepEqual(contracts.executiveResponse({ financial: { issuedAmountMinor: 500 }, operations: { openTickets: 2 } }), {
    issuedAmountMinor: 500,
    openTickets: 2
  });
});

test('assurance, fleet, and snapshot collections normalize to safe arrays', () => {
  assert.deepEqual(contracts.assuranceResponse({ capabilities: {}, summary: null }), {
    summary: { total: null, counts: { REAL: null } },
    capabilities: []
  });
  assert.deepEqual(contracts.fleetRows({ fleet: {} }), []);
  assert.deepEqual(contracts.snapshotTickets({ snapshot: { tickets: null }, tickets: 'bad' }), []);
});

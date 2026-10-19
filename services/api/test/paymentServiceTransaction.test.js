'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/operationsIntelligence.js'),
  'utf8'
);

test('payment service rejects non-payment roles before opening a database transaction', async () => {
  const { startPaymentCycle, transitionPaymentCycle } = require('../src/operationsIntelligence');
  const db = {
    configured: true,
    pool: {
      connect: async () => { throw new Error('DATABASE_MUST_NOT_BE_ACCESSED'); }
    }
  };

  await assert.rejects(
    startPaymentCycle(db, { sub: 'user-a', role: 'field_tech' }, { invoiceId: '11111111-1111-4111-8111-111111111111' }),
    error => error && error.code === 'PAYMENT_AUTHORITY_FORBIDDEN'
  );

  await assert.rejects(
    transitionPaymentCycle(db, { sub: 'user-a', role: 'field_tech' }, '22222222-2222-4222-8222-222222222222', { toState: 'approved' }),
    error => error && error.code === 'PAYMENT_AUTHORITY_FORBIDDEN'
  );
});

test('payment service delegates transaction ownership to withPrincipal', () => {
  const paymentBlocks = [
    source.slice(source.indexOf('async function startPaymentCycle'), source.indexOf('async function transitionPaymentCycle')),
    source.slice(source.indexOf('async function transitionPaymentCycle'), source.indexOf('async function openReworkCase')),
  ];

  for (const block of paymentBlocks) {
    assert.doesNotMatch(block, /client\.query\(['"]BEGIN['"]\)/);
    assert.doesNotMatch(block, /client\.query\(['"]COMMIT['"]\)/);
    assert.doesNotMatch(block, /client\.query\(['"]ROLLBACK['"]\)/);
    assert.match(block, /withPrincipal\(db, principal, async client/);
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(require.resolve('../public/evaluation-mode.js'), 'utf8');

function load(url, { fetchImpl = async () => new Response('ORIGINAL', { status: 200 }), storedStart = null } = {}) {
  let localValue = storedStart == null ? null : String(storedStart);
  const document = {
    readyState: 'loading',
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => ({ className: '', innerHTML: '', textContent: '', prepend() {}, insertBefore() {} }),
    body: { prepend() {} }
  };
  const sandbox = {
    console, URL, Date, Math, Response, Request, Headers,
    setTimeout, clearTimeout, document,
    location: new URL(url),
    localStorage: {
      getItem: () => localValue,
      setItem: (_k, value) => { localValue = String(value); }
    }
  };
  sandbox.window = sandbox;
  sandbox.fetch = fetchImpl;
  vm.runInNewContext(SOURCE, sandbox, { filename: 'evaluation-mode.js' });
  return sandbox;
}

test('normal mode never intercepts fetch', async () => {
  const sandbox = load('https://demo.example/ops/');
  const response = await sandbox.fetch('https://demo.example/health');
  assert.equal(await response.text(), 'ORIGINAL');
  assert.equal(sandbox.__FIBEROS_EVALUATION_MODE__, undefined);
});

test('evaluation mode serves deterministic operational routes and stateful POST flows', async () => {
  const sandbox = load('https://demo.example/ops/?mode=evaluation');
  assert.equal(sandbox.__FIBEROS_EVALUATION_MODE__.days, 30);
  assert.equal(sandbox.__FIBEROS_EVALUATION_MODE__.expiresAt - sandbox.__FIBEROS_EVALUATION_MODE__.startedAt, 30 * 86400000);

  let response = await sandbox.fetch('https://demo.example/health');
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.evaluationMode, true);
  assert.equal(body.syntheticData, true);
  assert.equal(body.externalRuntimeConnected, false);

  response = await sandbox.fetch('https://demo.example/v1/call-center/sessions', {
    method: 'POST', body: JSON.stringify({ direction: 'inbound', callerNumber: '+000', customerRef: 'DEMO' })
  });
  body = await response.json();
  assert.match(body.session.id, /^DEMO-CALL-/);
  assert.equal(body.demo, true);

  const sessionId = body.session.id;
  response = await sandbox.fetch('https://demo.example/v1/call-center/sessions/' + sessionId + '/ivr', {
    method: 'POST', body: JSON.stringify({ action: '1' })
  });
  body = await response.json();
  assert.equal(body.action, '1');
  assert.match(body.nextPrompt, /fault/i);

  response = await sandbox.fetch('https://demo.example/v1/call-center/queue/assign', { method: 'POST', body: '{}' });
  body = await response.json();
  assert.equal(body.assigned, true);
  assert.equal(body.demo, true);

  response = await sandbox.fetch('https://demo.example/v1/ftth-advisory/exception-board', {
    method: 'POST', body: JSON.stringify({ tickets: [{ ticketId: 'X', slaBreached: true, openConflict: true }] })
  });
  body = await response.json();
  assert.equal(body.result[0].severity, 'HIGH');

  response = await sandbox.fetch('https://demo.example/v1/tickets/close-field', {
    method: 'POST', body: JSON.stringify({ ticketId: 'DEMO-T-101' })
  });
  body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.persisted, false);
});

test('evaluation mode can reuse a previously recorded start time', () => {
  const start = Date.now() - 3 * 86400000;
  const sandbox = load('https://demo.example/ops/?mode=evaluation', { storedStart: start });
  assert.equal(sandbox.__FIBEROS_EVALUATION_MODE__.startedAt, start);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContactIntelligence } = require('../src');

const callId = '11111111-1111-4111-8111-111111111111';
const call = { id: callId, provider: 'generic', direction: 'inbound', status: 'active', ivr_state: 'initial', service_id: null, ticket_id: null, started_at: '2026-09-27T12:00:00.000Z' };
function clientFor(handler) { return { query: handler }; }

test('contact intelligence rejects caller-supplied tenant scope and malformed session IDs', async () => {
  const client = clientFor(async () => ({ rows: [] }));
  await assert.rejects(buildContactIntelligence(client, { callSessionId: callId, tenantId: 'tenant-b' }), /CONTACT_INTELLIGENCE_TENANT_ID_FORBIDDEN/);
  await assert.rejects(buildContactIntelligence(client, { callSessionId: 'not-a-uuid' }), /CONTACT_INTELLIGENCE_CALL_SESSION_ID_INVALID/);
});

test('missing call sessions fail explicitly without synthesizing an empty intelligence result', async () => {
  await assert.rejects(buildContactIntelligence(clientFor(async () => ({ rows: [] })), { callSessionId: callId }), /CONTACT_INTELLIGENCE_CALL_SESSION_NOT_FOUND/);
});

test('database failures propagate instead of being converted into false complete data', async () => {
  const failure = Object.assign(new Error('db unavailable'), { code: 'ECONNREFUSED' });
  const client = clientFor(async query => {
    if (query.text.includes('FROM call_sessions')) return { rows: [call] };
    throw failure;
  });
  await assert.rejects(buildContactIntelligence(client, { callSessionId: callId }), error => error === failure);
});

test('successful response is read-only, advisory-only, and explicitly disclaims telephony execution', async () => {
  const client = clientFor(async query => {
    if (query.text.includes('FROM call_sessions')) return { rows: [call] };
    if (query.text.includes('FROM call_events')) return { rows: [{ event_type: 'created', occurred_at: '2026-09-27T12:00:00.000Z' }] };
    throw new Error('unexpected query');
  });
  const result = await buildContactIntelligence(client, { callSessionId: callId });
  assert.equal(result.readOnly, true);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.telephonyConfirmed, false);
  assert.equal(result.availability, 'COMPLETE');
  assert.match(result.resultSha256, /^[a-f0-9]{64}$/);
});


test('call correlation graph uses explicit links and surfaces ambiguity',()=>{const {buildCorrelationGraph}=require('../src');const out=buildCorrelationGraph({callSession:{id:'c-1',service_id:'s-1',ticket_id:'t-1'},ticket:{id:'t-1',service_id:'s-1',technician_id:'tech-1'},incidents:[{id:'i-1',state:'OPEN',serviceId:'s-1',ticketId:'t-1',primary_asset_id:'a-1'},{id:'i-2',state:'OPEN',serviceId:'s-1',ticketId:'t-1',primary_asset_id:'a-2'}]});assert.equal(out.status,'AMBIGUOUS_ACTIVE_INCIDENTS');assert.ok(out.edges.some(e=>e.relation==='SERVER_TICKET_LINK'));assert.ok(out.edges.some(e=>e.relation==='PRIMARY_ASSET'));});

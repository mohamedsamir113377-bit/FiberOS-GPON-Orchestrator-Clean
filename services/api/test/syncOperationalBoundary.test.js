'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {handleSyncBatch}=require('../src/routes/sync');
const {createEnvelope}=require('../../../packages/sync/src');

test('sync rejects a client-supplied hash that does not match the canonical envelope',async()=>{
 const op={clientId:'field-device-1',operationId:'op-001',type:'ticket.transition',aggregateType:'ticket',aggregateId:'00000000-0000-0000-0000-000000000001',payload:{toStatus:'in_progress'},createdAt:'2026-10-06T00:00:00.000Z',requestHash:'0'.repeat(64)};
 const out=await handleSyncBatch({operations:[op]},{authenticated:true,verified:true,sub:'00000000-0000-0000-0000-000000000002',role:'field_tech'},null);
 assert.equal(out.status,409);
 assert.equal(out.body.error,'SYNC_REQUEST_HASH_MISMATCH');
});

test('sync refuses to claim acceptance when persistence is unavailable',async()=>{
 const canonical=createEnvelope({clientId:'field-device-1',operationId:'op-002',type:'ticket.transition',aggregateType:'ticket',aggregateId:'00000000-0000-0000-0000-000000000001',payload:{toStatus:'in_progress'},createdAt:'2026-10-06T00:00:00.000Z'});
 const op={...canonical};
 const out=await handleSyncBatch({operations:[op]},{authenticated:true,verified:true,sub:'00000000-0000-0000-0000-000000000002',role:'field_tech'},null);
 assert.equal(out.status,503);
 assert.equal(out.body.accepted,false);
});

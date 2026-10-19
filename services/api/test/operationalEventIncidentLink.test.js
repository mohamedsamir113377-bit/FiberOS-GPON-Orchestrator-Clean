'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../../..');

test('canonical event to incident linkage is tenant-bound, explicit and append-only',()=>{
 const m=fs.readFileSync(path.join(ROOT,'sql/migrations/156_operational_event_incident_links.sql'),'utf8');
 assert.match(m,/REFERENCES outbox_events\(event_id\) ON DELETE RESTRICT/);
 assert.match(m,/REFERENCES incidents\(id\) ON DELETE RESTRICT/);
 assert.match(m,/TENANT_MISMATCH_OPERATIONAL_EVENT/);
 assert.match(m,/TENANT_MISMATCH_INCIDENT/);
 assert.match(m,/OPERATIONAL_EVENT_INCIDENT_LINK_APPEND_ONLY/);
 assert.match(m,/UNIQUE\(tenant_id,event_id,incident_id,link_role\)/);
 assert.match(m,/fiberos_current_tenant_id\(\)/);
});

test('incident route accepts only an explicit operationalEventId and never fabricates an event',()=>{
 const route=fs.readFileSync(path.join(ROOT,'services/api/src/routes/operations.js'),'utf8');
 assert.match(route,/linkOperationalEventToIncident/);
 assert.match(route,/b\.operationalEventId/);
 assert.match(route,/OPERATIONAL_EVENT_NOT_CANONICAL/);
 assert.doesNotMatch(route,/insert into outbox_events/);
});

test('incident linker requires a real canonical event and real incident',async()=>{
 const {linkOperationalEventToIncident}=require(path.join(ROOT,'packages/operational-context/src/incidentLink.js'));
 const calls=[];
 const client={async query(sql,params){
  calls.push({sql,params});
  if(sql.includes('select event_id,tenant_id')) return {rows:[{event_id:params[0],tenant_id:params[1],canonical_event_version:'fiberos.operational-event.v1',correlation_id:'cc:test',causation_id:null,idempotency_key:'cc:test:handoff:0001',integrity_sha256:'a'.repeat(64)}]};
  if(sql.includes('select id,tenant_id,incident_key')) return {rows:[{id:params[0],tenant_id:params[1],incident_key:'INC-1',state:'declared',severity:'P2'}]};
  if(sql.includes('insert into operational_event_incident_links')) return {rows:[{id:'link-1',tenant_id:params[0],event_id:params[1],incident_id:params[2],link_role:params[3],created_by:params[4],created_at:'2026-10-08T00:00:00.000Z'}]};
  throw new Error('UNEXPECTED_QUERY');
 }};
 const r=await linkOperationalEventToIncident(client,{tenantId:'tenant-1',eventId:'event-1',incidentId:'incident-1',actorId:'actor-1'});
 assert.equal(r.replayed,false);
 assert.equal(r.link.event_id,'event-1');
 assert.equal(r.link.incident_id,'incident-1');
 assert.equal(calls.length,3);
});

test('incident linker treats exact replay as idempotent and rejects an absent event',async()=>{
 const {linkOperationalEventToIncident}=require(path.join(ROOT,'packages/operational-context/src/incidentLink.js'));
 const replayClient={async query(sql,params){
  if(sql.includes('select event_id,tenant_id'))return {rows:[{event_id:params[0],tenant_id:params[1],canonical_event_version:'fiberos.operational-event.v1',correlation_id:'cc:test',causation_id:null,idempotency_key:'cc:test:handoff:0002',integrity_sha256:'a'.repeat(64)}]};
  if(sql.includes('select id,tenant_id,incident_key'))return {rows:[{id:params[0],tenant_id:params[1],incident_key:'INC-1',state:'declared',severity:'P2'}]};
  if(sql.includes('insert into operational_event_incident_links'))return {rows:[]};
  if(sql.includes('select id,tenant_id,event_id,incident_id,link_role'))return {rows:[{id:'link-existing',tenant_id:params[0],event_id:params[1],incident_id:params[2],link_role:params[3],created_by:null,created_at:'2026-10-08T00:00:00.000Z'}]};
  throw new Error('UNEXPECTED_QUERY');
 }};
 const replay=await linkOperationalEventToIncident(replayClient,{tenantId:'tenant-1',eventId:'event-1',incidentId:'incident-1'});
 assert.equal(replay.replayed,true);
 assert.equal(replay.link.id,'link-existing');
 const missingClient={async query(sql){if(sql.includes('select event_id,tenant_id'))return {rows:[]};throw new Error('UNEXPECTED_QUERY');}};
 await assert.rejects(()=>linkOperationalEventToIncident(missingClient,{tenantId:'tenant-1',eventId:'missing-event',incidentId:'incident-1'}),e=>e&&e.code==='OPERATIONAL_EVENT_NOT_FOUND');
});

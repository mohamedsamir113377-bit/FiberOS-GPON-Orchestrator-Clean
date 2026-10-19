'use strict';
const {describe,it}=require('node:test');const assert=require('node:assert/strict');
const P=require('../../../packages/reality-acquisition-policy/src');const R=require('../src/routes/realityCommand');
describe('reality command boundary',()=>{
 it('exposes direct and field source choices',()=>{assert.ok(R.SOURCE_CATALOG.some(x=>x.sourceKey==='nms_rx'));assert.ok(R.SOURCE_CATALOG.some(x=>x.sourceKey==='field_power_photo'));});
 it('keeps field photo non-numeric',()=>{const p=P.validateFieldPhotoProof({latitude:30,longitude:31,contentSha256:'b'.repeat(64),actorId:'u',capturedAt:'2026-10-08T00:00:00Z'});assert.equal(p.numericAuthority,false);assert.equal(p.imageBytesInspected,false);});
 it('rejects unsupported entity before SQL table composition',async()=>{await assert.rejects(()=>R.validateEntityScope({query:async()=>({rows:[]})},'t','bad','00000000-0000-4000-8000-000000000000'),/ENTITY_TYPE_INVALID/);});
 it('contains the canonical event transaction boundary for reality operation plans',async()=>{
   const fs=require('node:fs'); const source=fs.readFileSync(require('node:path').join(__dirname,'../src/routes/realityCommand.js'),'utf8');
   assert.match(source,/appendOperationalEvent/);
   assert.match(source,/on conflict\(tenant_id,request_key\) do nothing returning/);
   assert.match(source,/appendOperationalEvent/);
   assert.match(source,/UNVERIFIED_POLICY_SELECTION/);
 });
});

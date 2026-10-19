const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('fault workflow has explicit call-center -> visit -> geo-dispatch -> technician lifecycle',()=>{
 const sql=read('sql/migrations/132_fault_workflows.sql'); const js=read('services/api/src/routes/faults.js');
 for(const token of ['CALL_CENTER_REVIEW','SCHEDULED','DISPATCHED','TECHNICIAN_ACCEPTED','IN_PROGRESS','AWAITING_CUSTOMER_CONFIRMATION','RESOLVED']){assert.ok(sql.includes(token));assert.ok(js.includes(token));}
 assert.ok(js.includes('t.current_gps'));assert.ok(js.includes('t.current_gps_captured_at'));assert.ok(js.includes('ST_Distance'));assert.ok(js.includes("t.current_gps_captured_at>=now()-interval '15 minutes'"));assert.ok(js.includes("syntheticData:false"));
});
test('fault workflow is tenant isolated and fail-closed for unverified delivery/storage',()=>{
 const sql=read('sql/migrations/132_fault_workflows.sql'); const js=read('services/api/src/routes/faults.js');
 for(const token of ['ENABLE ROW LEVEL SECURITY','FORCE ROW LEVEL SECURITY','fiberos_enterprise_tenant_ok','fault_jobs_public_tracking_select'])assert.ok(sql.includes(token));
 assert.ok(js.includes("'UNVERIFIED'"));assert.ok(js.includes('CLIENT_HASH_ONLY'));assert.ok(js.includes('STORAGE_VERIFIED'));
 assert.ok(js.includes('UNVERIFIED'));
});
test('fault optical evidence is required only for fiber-related fault classes',()=>{
 const js=read('services/api/src/routes/faults.js');assert.match(js,/OPTICAL_LOSS.*NO_SYNC.*DROP_DAMAGE.*INTERMITTENT/);assert.match(js,/FAULT_PHOTO/);
});

test('fault database authority guard covers public tracking and resolution evidence',()=>{
 const sql=read('sql/migrations/133_fault_command_authority.sql');
 for(const token of ['GRANT SELECT ON public.fault_jobs TO fiberos_app','technicians_public_fault_tracking_select','technician_positions_public_fault_tracking_select','FAULT_CUSTOMER_ACCEPTANCE_REQUIRED','FAULT_PHOTO_EVIDENCE_REQUIRED','FAULT_OPTICAL_EVIDENCE_REQUIRED','fiberos.evidence_provider_verified','FAULT_EVIDENCE_PROVIDER_VERIFICATION_REQUIRED']) assert.ok(sql.includes(token),token);
});

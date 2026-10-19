'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('migration 120 contains the executable offline sync and full lifecycle edges',()=>{
 const file=fs.readFileSync(path.join(__dirname,'../../../sql/migrations/120_operational_cycle_execution_closure.sql'),'utf8');
 assert.match(file,/fiberos_process_sync_batch/);
 assert.match(file,/ticket\.transition/);
 assert.match(file,/v_from='rejected' AND v_to='in_progress'/);
 assert.match(file,/v_from='manager_review' AND v_to='pending_signature'/);
 assert.match(file,/v_from='pending_signature'[\s\S]*v_to IN\('completed'/);
 assert.match(file,/OPERATION_ID_REUSED_WITH_DIFFERENT_HASH/);
 assert.match(file,/UNSUPPORTED_OPERATION_TYPE/);
});

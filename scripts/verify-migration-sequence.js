#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const MIG_DIR = path.join(ROOT, 'sql', 'migrations');
const files = fs.readdirSync(MIG_DIR).filter(f=>/^\d{3}_.+\.sql$/.test(f)).sort();
const actualIds = files.map(f=>f.slice(0,3));
const errors=[];
const hardening184Path = path.join(MIG_DIR, '184_harden_field_scope_and_contact_center_tenant_policies.sql');
if (fs.existsSync(hardening184Path)) {
  const hardening184 = fs.readFileSync(hardening184Path, 'utf8');
  if (/SET\s+row_security\s*=\s*off/i.test(hardening184)) errors.push('migration 184 must not set row_security = off');
  if (!/SECURITY\s+DEFINER/i.test(hardening184)) errors.push('migration 184 must retain SECURITY DEFINER on the field technician scope predicate');
  if (!/SET\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*auth/i.test(hardening184)) errors.push('migration 184 must keep the pinned field-scope search_path');
  if (/c\.tenant_id\s*=\s*tenant_id/i.test(hardening184)) errors.push('migration 184 must not reintroduce the ambiguous contact-center tenant comparison');
  const policies = [...hardening184.matchAll(/CREATE\s+POLICY\s+(cc_messages_customer(?:_insert)?)\b[\s\S]*?(?=CREATE\s+POLICY|CREATE\s+OR\s+REPLACE|COMMIT;)/gi)];
  for (const name of ['cc_messages_customer', 'cc_messages_customer_insert']) {
    const policy = policies.find(m => m[1].toLowerCase() === name);
    if (!policy) errors.push('migration 184 must recreate policy ' + name);
    else if (!/c\.tenant_id\s*=\s*(?:public\.)?contact_center_conversation_messages\.tenant_id/i.test(policy[0])) errors.push(name + ' must compare conversation tenant_id to outer message tenant_id explicitly');
  }
}
const expectedCount = files.length;
if(expectedCount===0) errors.push('no numbered migrations found');
for(let i=0;i<expectedCount;i++){
  const expected=String(i+1).padStart(3,'0');
  if(actualIds[i]!==expected) errors.push(`migration sequence mismatch at index ${i}: expected ${expected}, found ${actualIds[i]||'missing'}`);
}
const list=fs.readFileSync(path.join(MIG_DIR,'PRODUCTION_MIGRATIONS.txt'),'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
if(JSON.stringify(list)!==JSON.stringify(files)) errors.push('PRODUCTION_MIGRATIONS.txt does not exactly match numbered SQL migration filenames');
const legacy=fs.readFileSync(path.join(MIG_DIR,'PRODUCTION_MIGRATIONS.sha256'),'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
const extraPath=path.join(MIG_DIR,'PRODUCTION_MIGRATIONS.extra.sha256');
const extra=fs.existsSync(extraPath)?fs.readFileSync(extraPath,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean):[];
const expected=files.map(file=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(MIG_DIR,file))).digest('hex')}  ${file}`);
const legacyExpected=expected.filter(line=>Number(line.match(/\b(\d{3})_[^ ]+\.sql$/)?.[1]||0)<=116);
const extraExpected=expected.filter(line=>Number(line.match(/\b(\d{3})_[^ ]+\.sql$/)?.[1]||0)>=117);
if(JSON.stringify(legacy)!==JSON.stringify(legacyExpected)) errors.push('PRODUCTION_MIGRATIONS.sha256 does not exactly match current 001-116 migration bytes');
if(JSON.stringify(extra)!==JSON.stringify(extraExpected)) errors.push('PRODUCTION_MIGRATIONS.extra.sha256 does not exactly match migration bytes beyond legacy ledger');
if(errors.length){for(const e of errors) console.error(`MIGRATION_SEQUENCE_FAIL: ${e}`);process.exit(1)}
console.log(`MIGRATION_SEQUENCE PASS: ${files.length} migrations, contiguous 001-${actualIds[actualIds.length-1]}, filename list and SHA-256 ledgers exact.`);

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operationsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'operations.js'),
  'utf8'
);
const runtimeGrantSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'sql', 'bootstrap', '20_runtime_role_grants.sql'),
  'utf8'
);

const inboundCallStart = operationsSource.indexOf('async function inboundCall(');
const inboundCallEnd = operationsSource.indexOf('\nasync function handleOperations(', inboundCallStart);
assert.ok(inboundCallStart >= 0 && inboundCallEnd > inboundCallStart, 'inboundCall handler must remain discoverable');
const inboundCallSource = operationsSource.slice(inboundCallStart, inboundCallEnd);

test('telco webhook route does not bypass the database authority with direct table DML', () => {
  assert.match(inboundCallSource, /fiberos_webhook_provider_context\(\$1\)/);
  assert.match(inboundCallSource, /fiberos_record_telco_webhook\(/);
  assert.equal(
    /select\s+id,\s+tenant_id,\s+signing_secret_ref\s+from\s+telco_webhook_providers/i.test(inboundCallSource),
    false
  );
  assert.equal(
    /insert\s+into\s+telco_webhook_replay_guard/i.test(inboundCallSource),
    false
  );
  assert.equal(
    /insert\s+into\s+call_sessions/i.test(inboundCallSource),
    false
  );
});

test('webhook DB authority is executable by runtime but does not grant direct table access', () => {
  assert.match(runtimeGrantSource, /CREATE OR REPLACE FUNCTION fiberos_webhook_provider_context\(/);
  assert.match(runtimeGrantSource, /CREATE OR REPLACE FUNCTION fiberos_record_telco_webhook\(/);
  assert.match(runtimeGrantSource, /GRANT EXECUTE ON FUNCTION fiberos_webhook_provider_context\(text\) TO fiberos_runtime/);
  assert.match(runtimeGrantSource, /GRANT EXECUTE ON FUNCTION fiberos_record_telco_webhook\(uuid,text,text,text,text,text\) TO fiberos_runtime/);
  assert.match(runtimeGrantSource, /current_user = 'fiberos_owner'/);
  assert.match(runtimeGrantSource, /current_setting\('fiberos\.webhook_ingest', true\) = 'allowed'/);
  assert.match(runtimeGrantSource, /GET DIAGNOSTICS replay_rows = ROW_COUNT/);

  const directRuntimeDml = /^\s*GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)(?:\s*,\s*(?:SELECT|INSERT|UPDATE|DELETE))*\s+ON\s+(?:telco_webhook_providers|call_sessions)\b[^;]*\bTO\s+fiberos_runtime\b/im;
  assert.equal(directRuntimeDml.test(runtimeGrantSource), false);
});

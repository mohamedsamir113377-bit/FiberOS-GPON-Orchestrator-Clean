'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'sql', 'migrations', '102_hash_ledger_rpc_privilege_closure.sql'),
  'utf8'
);

test('hash-ledger RPC authority is executable only by fiberos_app after the final privilege closure', () => {
  assert.match(
    migration,
    /REVOKE ALL\s+ON FUNCTION fiberos_append_hash_ledger\(char\(64\),char\(64\),bigint,text,text,jsonb\)\s+FROM PUBLIC, anon, authenticated, fiberos_app/
  );
  assert.match(
    migration,
    /GRANT EXECUTE\s+ON FUNCTION fiberos_append_hash_ledger\(char\(64\),char\(64\),bigint,text,text,jsonb\)\s+TO fiberos_app/
  );
  assert.match(
    migration,
    /REVOKE ALL\s+ON FUNCTION fiberos_hash_ledger_head\(\)\s+FROM PUBLIC, anon, authenticated, fiberos_app/
  );
  assert.match(
    migration,
    /GRANT EXECUTE\s+ON FUNCTION fiberos_hash_ledger_head\(\)\s+TO fiberos_app/
  );
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE\s+ON FUNCTION fiberos_(?:append_hash_ledger|hash_ledger_head)[^\n]*\s+TO authenticated/
  );
});

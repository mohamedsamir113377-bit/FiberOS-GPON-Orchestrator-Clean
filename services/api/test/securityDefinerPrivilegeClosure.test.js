'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'sql', 'migrations', '103_security_definer_execution_surface_closure.sql'),
  'utf8'
);

test('internal SECURITY DEFINER and trigger authorities are not directly executable by authenticated clients', () => {
  for (const signature of [
    'fiberos_transition_ticket\\(uuid,text\\)',
    'fiberos_audit_append\\(uuid,uuid,text,text,text,uuid,char\\(64\\)\\)',
    'fiberos_guard_ticket_tenant_scope\\(\\)',
    'fiberos_guard_ticket_status_change\\(\\)',
    'fiberos_guard_incident_transition\\(\\)',
    'fiberos_guard_incident_event_authority\\(\\)',
    'fiberos_enforce_operational_tenant_consistency\\(\\)',
    'fiberos_enforce_evidence_tenant_consistency\\(\\)',
    'fiberos_enforce_field_close_idempotency_tenant_consistency\\(\\)'
  ]) {
    assert.match(
      migration,
      new RegExp('REVOKE ALL\\s+\\n?\\s*ON FUNCTION '+signature+'\\s+\\n?\\s*FROM PUBLIC, anon, authenticated, fiberos_app')
    );
  }

  assert.match(
    migration,
    /GRANT EXECUTE\s+ON FUNCTION fiberos_transition_ticket\(uuid,text\)\s+TO fiberos_app/
  );
  assert.match(
    migration,
    /GRANT EXECUTE\s+ON FUNCTION fiberos_audit_append\(uuid,uuid,text,text,text,uuid,char\(64\)\)\s+TO fiberos_app/
  );
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE\s+ON FUNCTION fiberos_(?:transition_ticket|audit_append)[^\n]*\s+TO authenticated/
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ticketMigration = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'sql', 'migrations', '104_ticket_self_scope_authority.sql'),
  'utf8'
);
const incidentMigration = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'sql', 'migrations', '105_incident_role_authority.sql'),
  'utf8'
);
const operationsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'operations.js'),
  'utf8'
);

test('field_tech ticket lifecycle is bound to the authenticated technician identity', () => {
  assert.match(ticketMigration, /v_role\s*=\s*'field_tech'\s+AND NOT EXISTS/);
  assert.match(ticketMigration, /JOIN technicians tech\s+ON tech\.id = t\.technician_id/);
  assert.match(ticketMigration, /tech\.user_id = auth\.uid\(\)/);
  assert.match(ticketMigration, /t\.tenant_id = v_tenant/);
  assert.match(ticketMigration, /TICKET_TECHNICIAN_SCOPE_REQUIRED/);
  assert.match(ticketMigration, /USING ERRCODE = '42501'/);
  assert.match(ticketMigration, /FOR UPDATE/);
  assert.match(ticketMigration, /AND status=v_from/);
  assert.match(ticketMigration, /GRANT EXECUTE ON FUNCTION fiberos_transition_ticket\(uuid,text\) TO fiberos_app/);
  assert.doesNotMatch(ticketMigration, /GRANT EXECUTE ON FUNCTION fiberos_transition_ticket[^\n]* TO authenticated/);
});

test('incident lifecycle DB authority enforces the same role boundary as the API', () => {
  assert.match(
    incidentMigration,
    /v_role IS NULL OR v_role NOT IN \('ops_manager','area_supervisor','dispatcher','sysadmin'\)/
  );
  assert.match(incidentMigration, /INCIDENT_ROLE_FORBIDDEN/);
  assert.match(incidentMigration, /BEFORE INSERT OR UPDATE OF state ON incidents/);
  assert.match(incidentMigration, /INCIDENT_INITIAL_STATE_REJECTED/);
  assert.match(incidentMigration, /INCIDENT_TRANSITION_REJECTED/);
  assert.match(
    incidentMigration,
    /REVOKE ALL\s+ON FUNCTION fiberos_guard_incident_transition\(\)\s+FROM PUBLIC, anon, authenticated, fiberos_app/
  );
  assert.match(
    operationsSource,
    /String\(e && e\.message \|\| e\) === 'INCIDENT_ROLE_FORBIDDEN'/
  );
  assert.match(
    operationsSource,
    /error:'INCIDENT_ROLE_FORBIDDEN'/
  );
});

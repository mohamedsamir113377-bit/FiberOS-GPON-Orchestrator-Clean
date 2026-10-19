'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const routePath = path.resolve(__dirname, '../src/routes/tickets.js');
const lifecyclePath = path.resolve(__dirname, '../src/routes/lifecycle.js');
const operationsPath = path.resolve(__dirname, '../src/operationsIntelligence.js');
const operationsRoutePath = path.resolve(__dirname, '../src/routes/operations.js');
const fieldClosePath = path.resolve(__dirname, '../src/routes/fieldClose.js');
const ledgerAppendPath = path.resolve(__dirname, '../../../packages/domain/src/ledgerAppend.js');
const ledgerMigrationPath = path.resolve(__dirname, '../../../sql/migrations/095_hash_ledger_authority_force_rls.sql');
const ledgerHeadMigrationPath = path.resolve(__dirname, '../../../sql/migrations/096_hash_ledger_head_authority.sql');
const route = fs.readFileSync(routePath, 'utf8');
const lifecycle = fs.readFileSync(lifecyclePath, 'utf8');
const operations = fs.readFileSync(operationsPath, 'utf8');
const operationsRoute = fs.readFileSync(operationsRoutePath, 'utf8');
const fieldClose = fs.readFileSync(fieldClosePath, 'utf8');
const fieldCloseExecutable = fieldClose.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const ledgerAppend = fs.readFileSync(ledgerAppendPath, 'utf8');
const ledgerMigration = fs.readFileSync(ledgerMigrationPath, 'utf8');
const ledgerHeadMigration = fs.readFileSync(ledgerHeadMigrationPath, 'utf8');
const migrationPath = path.resolve(__dirname, '../../../sql/migrations/088_fix_ticket_transition_function.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const finalTicketAuthorityMigrationPath = path.resolve(__dirname, '../../../sql/migrations/104_ticket_self_scope_authority.sql');
const finalTicketAuthorityMigration = fs.readFileSync(finalTicketAuthorityMigrationPath, 'utf8');
const ticketTenantAuthorityMigrationPath = path.resolve(__dirname, '../../../sql/migrations/089_harden_ticket_lifecycle_execution.sql');
const ticketTenantAuthorityMigration = fs.readFileSync(ticketTenantAuthorityMigrationPath, 'utf8');
const fieldCloseDmlClosureMigrationPath = path.resolve(__dirname, '../../../sql/migrations/107_field_close_direct_dml_authority_closure.sql');
const fieldCloseDmlClosureMigration = fs.readFileSync(fieldCloseDmlClosureMigrationPath, 'utf8');

assert.match(fieldCloseDmlClosureMigration, /GRANT SELECT, UPDATE ON tickets TO fiberos_app;/, 'trusted API role must retain field-close ticket field updates after client UPDATE revocation');
assert.match(fieldCloseDmlClosureMigration, /GRANT SELECT, INSERT ON evidence TO fiberos_app;/, 'trusted API role must retain evidence inserts');
assert.match(fieldCloseDmlClosureMigration, /GRANT SELECT, INSERT ON optical_measurements TO fiberos_app;/, 'trusted API role must retain measurement inserts');
assert.match(fieldCloseDmlClosureMigration, /GRANT SELECT, INSERT ON outbox_events TO fiberos_app;/, 'trusted API role must retain outbox inserts');
assert.match(fieldCloseDmlClosureMigration, /GRANT SELECT, INSERT ON field_close_idempotency TO fiberos_app;/, 'trusted API role must retain idempotency inserts');
assert.match(fieldCloseDmlClosureMigration, /GRANT USAGE, SELECT ON SEQUENCE optical_measurements_id_seq, outbox_events_id_seq TO fiberos_app;/, 'trusted API role must retain identity sequence access');

const incidentAuthorityMigrationPath = path.resolve(__dirname, '../../../sql/migrations/097_incident_db_authority.sql');
const incidentAuthorityMigration = fs.readFileSync(incidentAuthorityMigrationPath, 'utf8');
const incidentInitialStateMigrationPath = path.resolve(__dirname, '../../../sql/migrations/098_incident_initial_state_authority.sql');
const operationalTenantIntegrityMigrationPath = path.resolve(__dirname, '../../../sql/migrations/099_operational_tenant_fk_integrity.sql');
const operationalTenantIntegrityMigration = fs.readFileSync(operationalTenantIntegrityMigrationPath, 'utf8');
const incidentInitialStateMigration = fs.readFileSync(incidentInitialStateMigrationPath, 'utf8');
const reworkRlsMigrationPath = path.resolve(__dirname, '../../../sql/migrations/094_rework_force_rls_owner_policies.sql');
const reworkRlsMigration = fs.readFileSync(reworkRlsMigrationPath, 'utf8');
const migrationApplyPath = path.resolve(__dirname, '../../../scripts/buyer-acceptance/apply-production-migrations-ci.sh');
const migrationApply = fs.readFileSync(migrationApplyPath, 'utf8');
const evidencePath = path.resolve(__dirname, '../src/routes/evidence.js');
const evidence = fs.readFileSync(evidencePath, 'utf8');

test('rework FORCE RLS migration restores only owner-scoped authority policies', () => {
  assert.match(reworkRlsMigration, /ALTER TABLE rework_cases FORCE ROW LEVEL SECURITY/);
  assert.match(reworkRlsMigration, /ALTER TABLE rework_case_events FORCE ROW LEVEL SECURITY/);
  assert.match(reworkRlsMigration, /FOR SELECT TO fiberos_owner/);
  assert.match(reworkRlsMigration, /FOR INSERT TO fiberos_owner/);
  assert.match(reworkRlsMigration, /FOR UPDATE TO fiberos_owner/);
  assert.doesNotMatch(reworkRlsMigration, /TO authenticated/);
  assert.doesNotMatch(reworkRlsMigration, /TO fiberos_app/);
  assert.match(reworkRlsMigration, /actor_id = auth\.uid\(\)/);
  assert.match(reworkRlsMigration, /tenant_id = fiberos_session_tenant_id\(\)/);
});

test('hash ledger application writes go through DB authority instead of direct table DML', () => {
  assert.match(ledgerAppend, /fiberos_append_hash_ledger\(/);
  assert.match(ledgerAppend, /fiberos_hash_ledger_head\(\)/);
  assert.doesNotMatch(ledgerAppend, /insert into hash_ledger/i);
  assert.doesNotMatch(ledgerAppend, /select block_hash from hash_ledger/i);
});

test('hash ledger authority is FORCE-RLS compatible and actor-bound', () => {
  assert.match(ledgerMigration, /hash_ledger_owner_select/);
  assert.match(ledgerMigration, /hash_ledger_owner_insert/);
  assert.match(ledgerMigration, /actor_id = auth\.uid\(\)::text/);
  assert.match(ledgerMigration, /GRANT EXECUTE ON FUNCTION fiberos_append_hash_ledger.*authenticated, fiberos_app/);
  assert.doesNotMatch(ledgerMigration, /GRANT (INSERT|UPDATE|DELETE).*fiberos_app/);
  assert.match(ledgerHeadMigration, /fiberos_hash_ledger_head/);
  assert.match(ledgerHeadMigration, /pg_advisory_xact_lock\(86204401\)/);
  assert.match(ledgerHeadMigration, /GRANT EXECUTE ON FUNCTION fiberos_hash_ledger_head\(\) TO authenticated, fiberos_app/);
});

test('ticket API delegates current-state locking and transition authority to PostgreSQL', () => {
  assert.doesNotMatch(route, /select\s+status\s+from\s+tickets\s+where\s+id\s*=\s*\$1::uuid\s+for\s+update/i);
  assert.match(route, /fiberos_transition_ticket\(\$1::uuid,\s*\$2::text\)/);
  assert.doesNotMatch(route, /require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/packages\/domain\/src\/ticketLifecycle['"]\)/);
});

test('ticket DB authority owns tenant scope, row lock, role authorization, and compare-and-update', () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /v_tenant\s*:=\s*fiberos_current_tenant_id\(\)/);
  assert.match(migration, /tenant_id=v_tenant/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /v_role\s*:=\s*auth\.jwt\(\)->'app_metadata'->>'role'/);
  assert.match(migration, /AND status=v_from/);
  assert.match(migration, /REVOKE ALL ON FUNCTION fiberos_transition_ticket\(uuid,text\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION fiberos_transition_ticket\(uuid,text\) TO authenticated/);
});

test('ticket API treats client fromStatus as advisory only', () => {
  assert.match(route, /clientDeclaredFrom\s*=\s*body\.from\s*\|\|\s*body\.fromStatus\s*\|\|\s*null/);
  assert.match(route, /clientFromIgnored/);
  assert.doesNotMatch(route, /step\(trueFrom|step\(.*principal.*role/);
});

test('lifecycle API delegates authoritative state, locking, and role decisions to PostgreSQL', () => {
  assert.doesNotMatch(lifecycle, /select\s+status\s+from\s+tickets\s+where\s+id\s*=\s*\$1::uuid\s+for\s+update/i);
  assert.match(lifecycle, /fiberos_transition_ticket\(\$1::uuid,\s*\$2::text\)/);
  assert.doesNotMatch(lifecycle, /step\(trueFrom/);
});

test('rework close helper delegates locking and authorization to the DB authority function', () => {
  assert.doesNotMatch(operations, /select\s+id\s+from\s+rework_cases[\s\S]{0,180}for\s+update/i);
  assert.match(operations, /fiberos_close_rework_case\(\$1,\$2,\$3\)/);
});

test('fieldClose keeps its justified ticket lock but delegates final lifecycle mutation to PostgreSQL', () => {
  assert.match(fieldClose, /select status, technician_id, ST_Y\(location_coordinates::geometry\)[\s\S]{0,220}for update/i);
  assert.match(fieldClose, /fiberos_transition_ticket\(\$1::uuid,\s*\$2::text\)/);
  assert.match(fieldClose, /const maxMeters = Number\(cfg\.realityGateMaxMeters\)/);
  assert.doesNotMatch(fieldCloseExecutable, /body\.maxMeters/);
  assert.doesNotMatch(fieldCloseExecutable, /body\.photo\.ageSeconds/);
});

test('fieldClose close gate normalizes lifecycle target before policy checks', () => {
  assert.match(fieldCloseExecutable, /const target = normalizeStatus\(toStatus/);
  assert.doesNotMatch(fieldCloseExecutable, /const target = String\(toStatus/);
});

const serverPath = path.resolve(__dirname, '../src/server.js');
const server = fs.readFileSync(serverPath, 'utf8');

test('production migration runner executes migrations under fiberos_owner', () => {
  assert.match(migrationApply, /SET ROLE fiberos_owner;/);
  assert.match(reworkRlsMigration, /SECURITY DEFINER/);
});

test('evidence route normalizes optical field provenance before persistence', () => {
  assert.match(evidence, /toEvidenceSource\(source\)/);
  assert.match(evidence, /toEvidenceSource\(opticalCheck\.source \|\| source \|\| 'field'\)/);
  assert.doesNotMatch(evidence, /\(opticalCheck\.source \|\| source \|\| 'field'\),/);
});

test('operational foreign-key relations are tenant-consistent at the DB boundary', () => {
  assert.match(operationalTenantIntegrityMigration, /fiberos_enforce_operational_tenant_consistency/);
  for (const code of [
    'TENANT_MISMATCH_TICKET_SERVICE',
    'TENANT_MISMATCH_CALL_SERVICE',
    'TENANT_MISMATCH_CALL_TICKET',
    'TENANT_MISMATCH_CALL_AGENT',
    'TENANT_MISMATCH_CALL_EVENT_SESSION',
    'TENANT_MISMATCH_INCIDENT_ASSET',
    'TENANT_MISMATCH_INCIDENT_EVENT_INCIDENT',
    'TENANT_MISMATCH_DISPATCH_TICKET',
    'TENANT_MISMATCH_QUEUE_SESSION',
    'TENANT_MISMATCH_QUEUE_AGENT'
  ]) assert.match(operationalTenantIntegrityMigration, new RegExp(code));
  for (const trigger of [
    'trg_ticket_operational_tenant_consistency',
    'trg_call_session_operational_tenant_consistency',
    'trg_call_event_operational_tenant_consistency',
    'trg_incident_operational_tenant_consistency',
    'trg_incident_event_operational_tenant_consistency',
    'trg_dispatch_operational_tenant_consistency',
    'trg_queue_assignment_operational_tenant_consistency'
  ]) assert.match(operationalTenantIntegrityMigration, new RegExp(trigger));
});

test('incident lifecycle and audit actors are DB-authoritative', () => {
  assert.match(incidentAuthorityMigration, /ALTER TABLE incidents FORCE ROW LEVEL SECURITY/);
  assert.match(incidentAuthorityMigration, /ALTER TABLE incident_events FORCE ROW LEVEL SECURITY/);
  assert.match(incidentAuthorityMigration, /fiberos_guard_incident_transition/);
  assert.match(incidentInitialStateMigration, /IF TG_OP = 'INSERT'/);
  assert.match(incidentInitialStateMigration, /INCIDENT_INITIAL_STATE_REJECTED/);
  assert.match(incidentAuthorityMigration, /INCIDENT_TRANSITION_REJECTED/);
  assert.match(incidentAuthorityMigration, /fiberos_guard_incident_event_authority/);
  assert.match(incidentAuthorityMigration, /INCIDENT_EVENT_ACTOR_MISMATCH/);
  assert.match(operationsRoute, /authority:'DB_INCIDENT_STATE_AUTHORITY'/);
  assert.doesNotMatch(operationsRoute, /const transitions=\{open:\['investigating','declared'\]/);
});

test('server lifecycle route does not duplicate target-role authorization before DB authority', () => {
  assert.doesNotMatch(server, /completed requires manager-class role/);
  assert.doesNotMatch(server, /requireAnyRole\(p, \['ops_manager', 'qc', 'sysadmin', 'area_supervisor'\]\)/);
});

test('fieldClose does not trust client-declared NMS provenance', () => {
  assert.match(fieldCloseExecutable, /clientClaimsNms/);
  assert.match(fieldCloseExecutable, /NMS_PROVENANCE_ATTESTATION_REQUIRED/);
});

test('fieldClose does not accept client policy overrides for persisted validation', () => {
  assert.match(fieldCloseExecutable, /const policy = \{ requireFieldOrNms: true \}/);
  assert.doesNotMatch(fieldCloseExecutable, /const policy = body\.policy/);
});

test('evidence writes derive tenant from the authenticated DB session', () => {
  assert.match(evidence, /insert into evidence \(tenant_id, ticket_id, kind/);
  assert.match(evidence, /values \(fiberos_current_tenant_id\(\), \$1::uuid/);
  assert.doesNotMatch(evidence, /body\.tenantId|body\.tenant_id/);
});

test('evidence API kinds match the persisted database contract', () => {
  assert.match(evidence, /const kind = body\.kind \|\| 'other'/);
  assert.match(evidence, /EVIDENCE_KIND_INVALID/);
  assert.doesNotMatch(evidence, /const kind = body\.kind \|\| 'generic'/);
  assert.doesNotMatch(evidence, /new Set\(\['rx_reading', 'otdr_sor', 'optical', 'rx_power'\]\)/);
});

test('evidence endpoint does not let authenticated users self-assert nms/system provenance', () => {
  assert.match(evidence, /EVIDENCE_SOURCE_ATTESTATION_REQUIRED/);
  assert.match(evidence, /const \{ toEvidenceSource \} = require\('\.\.\/\.\.\/\.\.\/\.\.\/packages\/domain\/src\/sourceMap'\)/);
  assert.match(evidence, /evidenceSource !== 'field' && evidenceSource !== 'ai_simulated'/);
  assert.match(evidence, /actor_id, content_hash/);
  assert.match(evidence, /auth\.uid\(\)/);
});

test('fieldClose configuration bounds fail closed instead of weakening policy', async () => {
  const { handleFieldClose } = require('../src/routes/fieldClose');
  const out = await handleFieldClose({ ticketId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099' }, { sub: 'test', authenticated: true, verified: true }, null, {
    realityGateMaxMeters: Number.NaN,
    photoMaxAgeSeconds: 900
  });
  assert.equal(out.status, 503);
  assert.equal(out.body.error, 'FIELD_CLOSE_CONFIGURATION_INVALID');
});


test('final ticket authority remains tenant-scoped and API-only at the final migration boundary', () => {
  assert.match(ticketTenantAuthorityMigration, /CREATE POLICY tickets_owner_transition_select ON tickets/);
  assert.match(ticketTenantAuthorityMigration, /USING \(tenant_id = fiberos_current_tenant_id\(\)\)/);
  assert.match(ticketTenantAuthorityMigration, /CREATE POLICY tickets_owner_transition_update ON tickets/);
  assert.match(ticketTenantAuthorityMigration, /WITH CHECK \(tenant_id = fiberos_current_tenant_id\(\)/);

  assert.match(finalTicketAuthorityMigration, /v_role = 'field_tech' AND NOT EXISTS/);
  assert.match(finalTicketAuthorityMigration, /t\.tenant_id = v_tenant/);
  assert.match(finalTicketAuthorityMigration, /tech\.user_id = auth\.uid\(\)/);
  assert.match(finalTicketAuthorityMigration, /TICKET_TECHNICIAN_SCOPE_REQUIRED/);
  assert.match(finalTicketAuthorityMigration, /REVOKE ALL ON FUNCTION fiberos_transition_ticket\(uuid,text\) FROM public, anon, authenticated, fiberos_app/);
  assert.match(finalTicketAuthorityMigration, /GRANT EXECUTE ON FUNCTION fiberos_transition_ticket\(uuid,text\) TO fiberos_app/);
});


test('field-close cross-tenant references are blocked at the final DB boundary', () => {
  const rootClosurePath = path.resolve(__dirname, '../../../sql/migrations/106_field_close_cross_tenant_reference_closure.sql');
  const rootClosure = fs.readFileSync(rootClosurePath, 'utf8');

  assert.match(rootClosure, /fiberos_enforce_ticket_close_measurement_tenant_consistency/);
  assert.match(rootClosure, /TENANT_MISMATCH_TICKET_CLOSE_MEASUREMENT/);
  assert.match(rootClosure, /m\.id = NEW\.close_measurement_id/);
  assert.match(rootClosure, /m\.tenant_id = NEW\.tenant_id/);
  assert.match(rootClosure, /trg_ticket_close_measurement_tenant_consistency/);

  assert.match(rootClosure, /fiberos_enforce_outbox_ticket_tenant_consistency/);
  assert.match(rootClosure, /NEW\.aggregate_type = 'ticket'/);
  assert.match(rootClosure, /t\.id = NEW\.aggregate_id::uuid/);
  assert.match(rootClosure, /t\.tenant_id = NEW\.tenant_id/);
  assert.match(rootClosure, /TENANT_MISMATCH_OUTBOX_TICKET/);
  assert.match(rootClosure, /OUTBOX_TICKET_AGGREGATE_ID_INVALID/);
});


test('fieldClose write chain is tenant-derived end to end and never accepts client tenant authority', () => {
  assert.match(fieldCloseExecutable, /select tenant_id from tickets where id = \$1::uuid/);
  assert.match(fieldCloseExecutable, /insert into field_close_idempotency \(tenant_id,ticket_id,idempotency_key/);
  assert.match(fieldCloseExecutable, /insert into evidence \(tenant_id, ticket_id, kind/);
  assert.match(fieldCloseExecutable, /insert into optical_measurements \(tenant_id,/);
  assert.match(fieldCloseExecutable, /update tickets[\s\S]{0,700}where id = \$4::uuid and tenant_id = \$5::uuid and status = \$6/);
  assert.match(fieldCloseExecutable, /appendOperationalEvent/);
  assert.match(fieldCloseExecutable, /appendLedgerBlock\(client,/);
  assert.doesNotMatch(fieldCloseExecutable, /body\\.(tenantId|tenant_id)/);
});

test('fieldClose emits the canonical operational event envelope into the existing outbox', () => {
  assert.match(fieldClose, /appendOperationalEvent/);
  assert.match(fieldClose, /field\.close\.validated/);
  assert.match(fieldClose, /appendOperationalEvent/);
  assert.match(fieldClose, /runtimeVerificationStatus: 'UNVERIFIED'/);
  assert.match(fieldClose, /LIVE_HARDWARE_VERIFICATION_REMAINS_EXTERNAL/);
}); 

test('incident commands bridge the existing append-only command log into the canonical outbox', () => {
  const realityCommandPath = path.resolve(__dirname, '../src/routes/realityCommand.js');
  const realityCommand = fs.readFileSync(realityCommandPath, 'utf8');
  assert.match(realityCommand, /insert into incident_command_events[\s\S]*returning id,occurred_at/);
  assert.match(realityCommand, /appendOperationalEvent/);
  assert.match(realityCommand, /incident\.command\./);
  assert.match(realityCommand, /select auth\.uid\(\) actor_id/);
  assert.match(realityCommand, /appendOperationalEvent/);
  assert.match(realityCommand, /on conflict\(tenant_id,idempotency_key\) do nothing returning/);
});

test('fieldClose DB session is installed before any ticket, evidence, measurement, idempotency, outbox, or ledger write', () => {
  const sessionPath = path.resolve(__dirname, '../../../packages/db/src/session.js');
  const session = fs.readFileSync(sessionPath, 'utf8');
  assert.match(session, /begin/);
  assert.match(session, /set local role fiberos_app/);
  assert.match(session, /set_config\('request\.jwt\.claims'/);
  assert.match(session, /await applyPrincipal\(client, principal\)/);
  assert.match(session, /await client\.query\('commit'\)/);
});

test('field-close integrity tables reject direct authenticated mutation while the trusted API role remains the server write boundary', () => {
  assert.match(fieldCloseDmlClosureMigration, /REVOKE UPDATE, DELETE, TRUNCATE[\s\S]{0,160}ON tickets[\s\S]{0,120}FROM PUBLIC, anon, authenticated/);
  assert.match(fieldCloseDmlClosureMigration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]{0,200}ON evidence, optical_measurements, outbox_events, field_close_idempotency[\s\S]{0,120}FROM PUBLIC, anon, authenticated/);
  assert.match(fieldCloseDmlClosureMigration, /REVOKE TRIGGER, REFERENCES[\s\S]{0,200}ON tickets, evidence, optical_measurements, outbox_events, field_close_idempotency/);
  assert.match(fieldCloseDmlClosureMigration, /pg_get_serial_sequence/);
  assert.doesNotMatch(fieldCloseDmlClosureMigration, /GRANT (INSERT|UPDATE|DELETE).*authenticated/i);
  assert.doesNotMatch(fieldCloseDmlClosureMigration, /GRANT (INSERT|UPDATE|DELETE).*anon/i);
});

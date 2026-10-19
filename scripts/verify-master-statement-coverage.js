'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'docs/MASTER_OPERATING_STATEMENT_COVERAGE_2026-10-07.md',
  'sql/migrations/137_master_operating_statement_deep_kernels.sql',
  'sql/migrations/138_reality_reference_tenant_guards.sql',
  'sql/migrations/139_service_path_and_optical_assurance_guards.sql',
  'sql/migrations/140_proof_state_control_kernels.sql',
  'sql/migrations/141_network_knowledge_and_reconciliation.sql',
  'sql/migrations/142_path_bound_optical_and_pon_telemetry_boundary.sql',
  'sql/migrations/143_runtime_shared_risk_app_read_boundary.sql',
  'packages/network-reality-kernel/src/index.js',
  'packages/network-reality-kernel/test/index.test.js',
  'packages/operations-trace/src/index.js',
  'packages/operations-trace/test/index.test.js',
  'packages/gis-reconciliation/src/index.js',
  'packages/gis-reconciliation/test/index.test.js',
  'packages/offline-field-queue/src/index.js',
  'packages/contact-center-intelligence/src/index.js',
  'packages/network-knowledge/src/index.js',
  'packages/network-knowledge/test/index.test.js',
  'packages/data-quality-engine/src/index.js',
  'packages/data-quality-engine/test/index.test.js',
  'packages/operations-kpi/src/index.js',
  'packages/operations-kpi/test/index.test.js',
  'packages/southbound-contract/src/ponTelemetryBoundary.js',
  'packages/engineering/test/resilienceSharedRisk.test.js',
  'services/api/src/routes/realityBoundary.js'
];

const failures = [];
for (const rel of requiredFiles) {
  if (!fs.existsSync(path.join(root, rel))) failures.push(`MISSING_FILE:${rel}`);
}

function read(rel) {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const matrix = read('docs/MASTER_OPERATING_STATEMENT_COVERAGE_2026-10-07.md');
for (const token of [
  'Canon',
  'Fibre/core continuity',
  'Structured service-path versioning',
  'Shared operational graph',
  'Asset-specific acceptance',
  'OLT/PON correlation',
  'Optical assurance',
  'Fault blast radius',
  'Building/riser hierarchy',
  'Civil/duct',
  'Continuous network self-audit',
  'Resilience/shared-risk',
  'Controlled agentic assistance',
  'Acceptance Tests 01–16',
  'FINAL HANDOFF CANDIDATE — NOT PRODUCTION READY'
]) {
  if (!matrix.includes(token)) failures.push(`MATRIX_MISSING:${token}`);

const resilience = read('packages/engineering/src/resilienceAdvanced.js');
if (!resilience.includes('dependenciesFromServicePathHops')) failures.push('SERVICE_PATH_RISK_BRIDGE_MISSING');
if (!resilience.includes('analyseSharedRiskFromServicePaths')) failures.push('SHARED_RISK_FROM_PATHS_MISSING');
const reality = read('packages/network-reality-kernel/src/index.js');
if (!reality.includes('compileOpticalAssuranceLedgerRecord')) failures.push('OPTICAL_LEDGER_COMPILE_MISSING');
const pon = read('packages/southbound-contract/src/ponTelemetryBoundary.js');
if (!pon.includes('connectivityProven')) failures.push('PON_BOUNDARY_CONNECTIVITY_FLAG_MISSING');
const m142 = read('sql/migrations/142_path_bound_optical_and_pon_telemetry_boundary.sql');
if (!m142.includes('service_path_version_id')) failures.push('M142_PATH_VERSION_MISSING');
if (!m142.includes('connectivity_proven boolean NOT NULL DEFAULT false')) failures.push('M142_CONNECTIVITY_FALSE_MISSING');
const m143 = read('sql/migrations/143_runtime_shared_risk_app_read_boundary.sql');
if (!m143.includes('GRANT SELECT ON public.network_service_path_versions TO fiberos_app')) failures.push('M143_APP_PATH_VERSION_READ_MISSING');
if (!m143.includes('network_service_path_hops_app_read')) failures.push('M143_APP_HOPS_POLICY_MISSING');
if (!m143.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')) failures.push('M143_APP_DML_REVOKE_MISSING');

}

const m137 = read('sql/migrations/137_master_operating_statement_deep_kernels.sql');
const m140 = read('sql/migrations/140_proof_state_control_kernels.sql');
if (!m137.includes('network_service_path_hops')) failures.push('PHASE3_SERVICE_PATH_HOPS_MISSING');
if (!m137.includes('network_asset_acceptance_gates')) failures.push('PHASE5_ACCEPTANCE_GATE_MISSING');
if (!m137.includes('network_telemetry_source_registry')) failures.push('PHASE6_TELEMETRY_BOUNDARY_MISSING');
if (!m137.includes('network_failure_domains')) failures.push('PHASE12_FAILURE_DOMAIN_MISSING');
if (!m137.includes('network_capability_claims')) failures.push('CLAIM_CARRYING_RELEASE_MISSING');
if (!m140.includes('network_proof_graph_nodes')) failures.push('PROOF_GRAPH_MISSING');
if (!m140.includes('network_state_transition_rules')) failures.push('STATE_KERNEL_MISSING');
if (!m140.includes('network_safety_budgets')) failures.push('SAFETY_BUDGET_MISSING');
const m141 = read('sql/migrations/141_network_knowledge_and_reconciliation.sql');
if (!m141.includes('network_knowledge_records')) failures.push('SECTION28_KNOWLEDGE_TABLE_MISSING');
if (!m141.includes('network_knowledge_evidence_required')) failures.push('SECTION28_EVIDENCE_GATE_MISSING');
if (!m141.includes('network_knowledge_model_output_requires_review')) failures.push('SECTION28_MODEL_REVIEW_GATE_MISSING');
if (!m141.includes('network_reconciliation_jobs')) failures.push('SECTION29_RECONCILIATION_JOB_MISSING');
if (!m141.includes('network_reconciliation_contradiction_has_no_selection')) failures.push('SECTION29_NO_SILENT_RESOLUTION_MISSING');
if (!m141.includes('network_department_kpi_bindings')) failures.push('SECTION33_KPI_BINDING_MISSING');
if (!m141.includes('network_department_kpi_deferred_requires_reason')) failures.push('SECTION33_DEFERRED_KPI_GATE_MISSING');
if (!m140.includes("CHECK (autonomous=false)")) failures.push('AUTONOMOUS_CONTROL_NOT_STRUCTURALLY_DISABLED');
const coverageSource = read('docs/MASTER_OPERATING_STATEMENT_COVERAGE_2026-10-07.md');
for (const token of ['End-to-end trace','GIS consistency','Call correlation','Offline sync','Recovery']) {
  if (!coverageSource.includes(token)) failures.push('SOURCE_CLOSURE_MATRIX_MISSING:'+token);
}

const registry = read('config/capability-registry.json');
if (!registry.includes('"network.master-statement-kernels"')) failures.push('CAPABILITY_REGISTRY_ENTRY_MISSING');
for (const capability of ['operations.reality-trace','gis.reconciliation','contact.call-incident-correlation','optical.assurance-provenance','offline.operation-envelope','operations.recovery-control','network.knowledge-system','data.quality-reconciliation-engine','kpi.department-resolution']) {
  if (!registry.includes('"key": "'+capability+'"')) failures.push('CAPABILITY_REGISTRY_ENTRY_MISSING:'+capability);
}

const migrationList = read('sql/migrations/PRODUCTION_MIGRATIONS.txt');
for (let i = 137; i <= 143; i++) {
  const names = {
    137:'137_master_operating_statement_deep_kernels.sql',
    138:'138_reality_reference_tenant_guards.sql',
    139:'139_service_path_and_optical_assurance_guards.sql',
    140:'140_proof_state_control_kernels.sql',
    141:'141_network_knowledge_and_reconciliation.sql',
    142:'142_path_bound_optical_and_pon_telemetry_boundary.sql',
    143:'143_runtime_shared_risk_app_read_boundary.sql'
  };
  if (!migrationList.includes(names[i])) failures.push(`MIGRATION_LIST_MISSING:${names[i]}`);
}

if (failures.length) {
  process.stderr.write(`MASTER_STATEMENT_COVERAGE_FAIL\n${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('MASTER_STATEMENT_COVERAGE_OK\n');
process.stdout.write('Source coverage is verified statically; runtime readiness is intentionally not inferred.\n');

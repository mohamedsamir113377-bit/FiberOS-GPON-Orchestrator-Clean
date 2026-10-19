'use strict';

/**
 * PASS-38 additive integration boundary registry.
 * Pure metadata/validation only. No network I/O, DB access, or authority elevation.
 */

const FORBIDDEN_CAPABILITIES = Object.freeze([
  'raw_sql',
  'shell_exec',
  'direct_production_db_credentials',
  'bypass_rls',
  'authoritative_ticket_close',
  'authoritative_payment_mutation',
  'unverified_provider_delivery'
]);

const BOUNDARIES = Object.freeze({
  AI: Object.freeze({
    id: 'AI',
    mode: 'ADVISORY_BY_DEFAULT',
    ingress: 'AUTHORIZED_FIBEROS_TOOL_GATEWAY',
    egress: 'NO_DIRECT_DB',
    forbidden: Object.freeze(['raw_sql', 'shell_exec', 'direct_production_db_credentials', 'authoritative_ticket_close'])
  }),
  GIS: Object.freeze({
    id: 'GIS',
    mode: 'TENANT_SCOPED_SPATIAL_SERVICE',
    ingress: 'AUTHORIZED_API',
    egress: 'POSTGIS_THROUGH_SERVER_DOMAIN',
    forbidden: Object.freeze(['tenant_boundary_bypass', 'direct_client_db'])
  }),
  VOICE: Object.freeze({
    id: 'VOICE',
    mode: 'PROVIDER_ADAPTER_AND_SESSION_STATE',
    ingress: 'SIGNED_PROVIDER_WEBHOOK_OR_AUTHORIZED_API',
    egress: 'FIBEROS_POLICY_BOUNDARY',
    forbidden: Object.freeze(['queued_as_delivered', 'accepted_as_connected', 'unsigned_webhook'])
  }),
  FTTH: Object.freeze({
    id: 'FTTH',
    mode: 'EVIDENCE_BOUND_ENGINEERING',
    ingress: 'VALIDATED_MEASUREMENT_CONTRACT',
    egress: 'AUTHORITATIVE_CLOSE_GATE',
    forbidden: Object.freeze(['invented_measurement', 'invented_otdr_offset', 'simulated_final_close'])
  })
});

function listBoundaries() {
  return Object.keys(BOUNDARIES).sort();
}

function getBoundary(id) {
  return BOUNDARIES[String(id || '').toUpperCase()] || null;
}

function assertCapabilityAllowed(capability) {
  const c = String(capability || '');
  if (FORBIDDEN_CAPABILITIES.includes(c)) {
    const error = new Error('SOVEREIGN_BOUNDARY_CAPABILITY_FORBIDDEN');
    error.code = 'SOVEREIGN_BOUNDARY_CAPABILITY_FORBIDDEN';
    throw error;
  }
  return true;
}

function summary() {
  return Object.freeze({
    schemaVersion: 'fiberos-sovereign-boundaries-v1',
    authority: 'FIBEROS_POLICY_BOUNDARY',
    productionClaim: 'PROHIBITED_UNTIL_MATRIX_EVIDENCE',
    boundaries: listBoundaries()
  });
}

module.exports = { BOUNDARIES, FORBIDDEN_CAPABILITIES, listBoundaries, getBoundary, assertCapabilityAllowed, summary };

'use strict';

const { ROLE_PERMISSIONS, normalizeRole } = require('../../../packages/security/src/authorization');

const ALL_ROLES = Object.freeze(Object.keys(ROLE_PERMISSIONS));
const AUTHENTICATED = Object.freeze({ roles: ALL_ROLES, mode: 'AUTHENTICATED' });

const rules = [
  { method: 'GET', path: '/v1/adapters', ...AUTHENTICATED },
  { method: 'GET', path: '/v1/reality-access/catalog', roles: ['ops_manager','area_supervisor','dispatcher','qc','exec','sysadmin'] },
  { method: 'GET', path: '/v1/reality-access/policy', roles: ['ops_manager','area_supervisor','dispatcher','qc','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/reality-access\/policy\/(service|asset|site)\/[^/]+$/, roles: ['ops_manager','area_supervisor','dispatcher','qc','exec','sysadmin'] },
  { method: 'POST', path: '/v1/reality-access/policy', roles: ['ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', path: '/v1/reality-access/plan', roles: ['technician','field_tech','team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/reality-access/resolve', roles: ['technician','field_tech','team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/reality-access/proof/field-photo', roles: ['technician','field_tech','team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/reality-command/evidence', roles: ['technician','field_tech','team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/reality-command/evidence/link', roles: ['team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/reality-command\/incidents\/[0-9a-fA-F-]{36}\/links$/, roles: ['ops_manager','area_supervisor','dispatcher','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/reality-command\/incidents\/[0-9a-fA-F-]{36}\/impact$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc'] },
  { method: 'GET', pathPattern: /^\/v1\/reality-command\/incidents\/[0-9a-fA-F-]{36}\/state$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc'] },
  { method: 'GET', path: '/v1/contact-center/runtime/status', roles: ['call_center','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/intelligence/graph', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/network-intelligence/shared-risk', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc'] },
  { method: 'POST', path: '/v1/intelligence/engineering', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/contact-center/intelligence', roles: ['call_center','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/ai/advise', roles: ['technician','team_lead','dispatcher','call_center','ops_manager','area_supervisor','exec','sysadmin','qc'] },

  { method: 'POST', path: '/v1/tickets/transition', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/tickets/lifecycle/step', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/tickets/close-field', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/evidence/submit', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/sync/batch', roles: ALL_ROLES },

  { method: 'POST', path: '/v1/optics/power-budget', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/optics/measurements', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/optics/validate', roles: ALL_ROLES },
  { method: 'GET', path: '/v1/fttx-engineering/catalog', roles: ALL_ROLES },
  { method: 'GET', path: '/v1/fttx-engineering/profile', roles: ALL_ROLES },
  { method: 'PUT', path: '/v1/fttx-engineering/profile', roles: ['ops_manager','area_supervisor','sysadmin','qc','exec'] },
  { method: 'POST', pathPattern: /^\/v1\/fttx-engineering\/evaluate\/[^/]+$/, roles: ALL_ROLES },
  { method: 'POST', path: '/v1/fttx-engineering/label/compose', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/fttx-engineering/label/parse', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/fttx-engineering/as-built/deviation', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/fttx-engineering/as-built/summarize', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/fttx-engineering/as-built/records', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/fttx-engineering/labels', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/fttx-engineering/fire-class/assert', roles: ALL_ROLES },
  { method: 'GET', path: '/v1/field-slots/types', roles: ALL_ROLES },
  { method: 'POST', path: '/v1/field-slots/validate', roles: ['dispatcher','ops_manager','area_supervisor','sysadmin','exec','call_center','team_lead'] },
  { method: 'POST', path: '/v1/field-slots/reserve', roles: ['dispatcher','ops_manager','area_supervisor','sysadmin','exec','call_center','team_lead'] },

  { method: 'POST', pathPattern: /^\/v1\/engineering\/[^/]+$/, roles: ALL_ROLES },
  { method: 'POST', pathPattern: /^\/v1\/reality-boundary\/[^/]+$/, roles: ALL_ROLES },
  { method: 'POST', pathPattern: /^\/v1\/(?:ftth-advisory|ftth)\/[^/]+$/, roles: ALL_ROLES },

  { method: 'GET', path: '/v1/gis/fleet', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', path: '/v1/gis/network-twin', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', path: '/v1/noc/3d/scene', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/twin/simulate', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/twin/impact', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/gis\/twin\/capacity\/[^/]+$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc'] },
  { method: 'POST', path: '/v1/gis/nearest-technicians', roles: ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/technician-density-cluster', roles: ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/snap-to-plant', roles: ['technician','team_lead','ops_manager','area_supervisor','dispatcher','qc','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/geotag-region', roles: ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/assets-between-distances', roles: ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/corridor-conflict', roles: ['ops_manager','area_supervisor','dispatcher','qc','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/interpolate-along', roles: ['technician','team_lead','ops_manager','area_supervisor','qc','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/locate-between', roles: ['technician','team_lead','ops_manager','area_supervisor','qc','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/otdr-to-map', roles: ['technician','team_lead','ops_manager','area_supervisor','qc','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/topology-integrity-scan', roles: ['ops_manager','area_supervisor','qc','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/simplify-segment', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/application-graph-route', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/gis/positions', roles: ['technician','team_lead','dispatcher','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', path: '/v1/routing/plan', roles: ['call_center','dispatcher','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/inventory/adjust', roles: ['warehouse','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/messaging/enqueue', roles: ['call_center','ops_manager','exec','sysadmin'] },
  { method: 'POST', path: '/v1/billing/payment-cycle', roles: ['cfo','exec','ops_manager','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/billing\/payment-cycle\/[^/]+\/transition$/, roles: ['cfo','exec','ops_manager','sysadmin'] },
  { method: 'POST', path: '/v1/ops/rework-cases', roles: ['qc','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/ops\/rework-cases\/[^/]+\/close$/, roles: ['qc','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/billing/invoices', roles: ['cfo','exec','ops_manager','call_center','sysadmin'] },
  { method: 'GET', path: '/v1/customer/tickets', mode: 'HANDLER_AUTHORITY' },
  { method: 'POST', path: '/v1/customer-portal/sla/clocks', roles: ['exec','cfo','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/customer-portal\/.*$/, roles: ['customer','contractor','exec','cfo','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/customer-portal\/.*$/, roles: ['customer','contractor','exec','cfo','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/contractor-commercial\/.*$/, roles: ['customer','contractor','ops_manager','area_supervisor','exec','cfo','sysadmin','qc'] },
  { method: 'POST', pathPattern: /^\/v1\/contractor-commercial\/.*$/, roles: ['customer','contractor','ops_manager','area_supervisor','exec','cfo','sysadmin','qc'] },

{ method: 'GET', pathPattern: /^\/v1\/operations\/department-kpis\/(NETWORK_OPERATIONS|CONSTRUCTION|FIELD|CALL_CENTER|WAREHOUSE|ENGINEERING)$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc'] },
  { method: 'GET', path: '/v1/organization/operating-model', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },

  { method: 'GET', path: '/v1/call-center/metrics', roles: ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/call-center/dispositions', roles: ['call_center','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', path: '/v1/call-center/sessions', roles: ['call_center','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/call-center\/sessions\/[^/]+\/ivr$/, roles: ['call_center','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', path: '/v1/call-center/queue/assign', roles: ['call_center','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', path: '/v1/call-center/queue/release', roles: ['call_center','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', path: '/v1/call-center/queue/status', roles: ['call_center','ops_manager','area_supervisor','dispatcher','sysadmin','exec'] },

  { method: 'GET', path: '/v1/command/rooms/overview', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', path: '/v1/warehouses/overview', roles: ['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/warehouses\/[^/]+\/stock$/, roles: ['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/warehouses/transfers', roles: ['warehouse','ops_manager','area_supervisor','dispatcher','sysadmin'] },
  { method: 'POST', path: '/v1/warehouses/reservations', roles: ['warehouse','ops_manager','area_supervisor','dispatcher','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/warehouses\/reservations\/[^/]+\/release$/, roles: ['warehouse','ops_manager','area_supervisor','dispatcher','sysadmin'] },

  { method: 'GET', path: '/v1/crisis/command-state', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/crisis/incidents', roles: ['ops_manager','area_supervisor','dispatcher','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/crisis\/incidents\/[^/]+\/impact$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', path: '/v1/dispatch/rank', roles: ['dispatcher','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/executive/financial-snapshot', roles: ['cfo','exec','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', path: '/v1/operations/sla-command', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','call_center','technician'] },
  { method: 'GET', path: '/v1/audit/events', roles: ['qc','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/notifications/center', roles: ['call_center','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/migration-center/overview', roles: ['ops_manager','area_supervisor','exec','sysadmin','dispatcher'] },
  { method: 'GET', path: '/v1/workflows/overview', roles: ['ops_manager','area_supervisor','exec','sysadmin','dispatcher'] },
  { method: 'GET', path: '/v1/operations/workload-balance', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', path: '/v1/security/rbac/effective', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/subcontractors/overview', roles: ['procurement','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/smart-inventory/overview', roles: ['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/operations/timeline', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', path: '/v1/security/zero-trust/readiness', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/executive/radar', roles: ['exec','cfo','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', path: '/v1/executive/radar/report', roles: ['exec','cfo','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', path: '/v1/executive/commercial-report', roles: ['exec','cfo','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', path: '/v1/commercial/cost-calibration', roles: ['cfo','exec','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', path: '/v1/commercial/cost-calibration/propose', roles: ['ops_manager','area_supervisor','cfo','exec','sysadmin'] },
  { method: 'POST', path: '/v1/commercial/cost-calibration/approve', roles: ['ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', path: '/v1/extensions/registry', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/extensions/validate', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/memory/recent', roles: ['exec','ops_manager','area_supervisor','sysadmin','qc'] },
  { method: 'GET', path: '/v1/memory/query', roles: ['exec','ops_manager','area_supervisor','sysadmin','qc'] },
  { method: 'GET', path: '/v1/security/trust/overview', roles: ['exec','ops_manager','area_supervisor','sysadmin','qc'] },
  { method: 'GET', path: '/v1/contracts/runtime', roles: ['exec','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', path: '/v1/company/operating-system', roles: ['exec','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', path: '/v1/cx/heatmap', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc'] },
  { method: 'GET', pathPattern: /^\/v1\/customer\/self-diagnostic\/[^/]+$/, ...AUTHENTICATED },
  { method: 'GET', pathPattern: /^\/v1\/enterprise\/fiber-dna\/[0-9a-fA-F-]{36}$/, roles: ['technician','field_tech','team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', path: '/v1/command/fabric/overview', roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', path: '/v1/assurance/capabilities', roles: ['ops_manager','area_supervisor','exec','sysadmin','dispatcher','call_center','technician'] },
  { method: 'POST', path: '/v1/contact-center/agents/presence', roles: ['call_center','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', path: '/v1/contact-center/languages', roles: ['customer','call_center','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/contact-center/speech/probe', roles: ['customer','call_center','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/contact-center/speech/select', roles: ['call_center','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', path: '/v1/contact-center/conversations', roles: ['customer','call_center','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/contact-center\/conversations\/[^/]+$/, roles: ['customer','call_center','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/contact-center\/conversations\/[^/]+\/language$/, roles: ['call_center','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/contact-center\/conversations\/[^/]+\/messages$/, roles: ['customer','call_center','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/contact-center\/customer-360\/[^/]+$/, roles: ['call_center','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/operations\/case-context\/[^/]+$/, roles: ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/network-intelligence\/topology\/[^/]+$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/network-intelligence\/path\/[^/]+$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/network-intelligence\/traverse\/[^/]+$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/network-intelligence\/impact\/[^/]+$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/network-intelligence\/customer-impact\/[^/]+$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/network-intelligence\/root-cause\/[^/]+$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/network-intelligence\/optical-health\/[^/]+$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc'] },
  { method: 'GET', pathPattern: /^\/v1\/network-intelligence\/capacity\/[^/]+$/, roles: ['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc'] },
  { method: 'GET', pathPattern: /^\/v1\/operations\/evidence-chain\/[^/]+$/, roles: ['technician','team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/operations\/trace\/contact-center\/conversations\/[^/]+$/, roles: ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/operations\/evidence-chain\/[^/]+\/certify$/, roles: ['technician','team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', path: '/v1/gis/fusion/layers', roles: ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin'] },
  { method: 'GET', path: '/v1/gis/deep-snapshot', roles: ['call_center','dispatcher','qc','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/gis\/tiles\/(network_asset|fiber_cable|duct|evidence|technician_position|technician|fault|installation|ticket_location)\/\d+\/\d+\/\d+\.pbf$/, roles: ['call_center','dispatcher','qc','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/gis/technician-track', roles: ['call_center','dispatcher','qc','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/events/processing/health', roles: ['ops_manager','exec','sysadmin'] },
  { method: 'POST', path: '/v1/events/runtime/validate', roles: ['ops_manager','exec','sysadmin'] },
  { method: 'GET', path: '/v1/events/runtime/recovery', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', path: '/v1/integration/readiness', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },
    { method: 'GET', path: '/v1/security/hardening/readiness', roles: ['ops_manager','area_supervisor','exec','sysadmin'] },
  // Installation command workflows — deny-by-default requires explicit rules
  { method: 'POST', path: '/v1/installations/intake', roles: ['call_center','ops_manager','area_supervisor','dispatcher','sysadmin'] },
  { method: 'POST', path: '/v1/faults/intake', roles: ['call_center','data_collector','ops_manager','area_supervisor','dispatcher','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/faults\/[0-9a-fA-F-]{36}\/(verify|feedback)$/, roles: ['call_center','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/faults\/[0-9a-fA-F-]{36}\/(schedule|dispatch)$/, roles: ['call_center','dispatcher','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/faults\/[0-9a-fA-F-]{36}\/(accept|start|evidence|resolve)$/, roles: ['technician','field_tech','team_lead','qc','ops_manager','area_supervisor','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/installations\/[0-9a-fA-F-]{36}$/, roles: ['call_center','dispatcher','technician','field_tech','team_lead','qc','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'GET', pathPattern: /^\/v1\/installations\/[0-9a-fA-F-]{36}\/tracking$/, roles: ['call_center','dispatcher','technician','field_tech','team_lead','qc','ops_manager','area_supervisor','exec','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/installations\/[0-9a-fA-F-]{36}\/verify$/, roles: ['call_center','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/installations\/[0-9a-fA-F-]{36}\/schedule$/, roles: ['call_center','dispatcher','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/installations\/[0-9a-fA-F-]{36}\/dispatch$/, roles: ['call_center','dispatcher','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/installations\/[0-9a-fA-F-]{36}\/accept$/, roles: ['technician','field_tech','team_lead','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/installations\/[0-9a-fA-F-]{36}\/start$/, roles: ['technician','field_tech','team_lead','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/installations\/[0-9a-fA-F-]{36}\/evidence$/, roles: ['technician','field_tech','team_lead','qc','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/installations\/[0-9a-fA-F-]{36}\/feedback$/, roles: ['call_center','ops_manager','area_supervisor','sysadmin'] },
  { method: 'POST', pathPattern: /^\/v1\/installations\/[0-9a-fA-F-]{36}\/complete$/, roles: ['technician','field_tech','team_lead','qc','ops_manager','area_supervisor','sysadmin'] }
].map(function (rule) {
  return Object.freeze({ ...rule, roles: rule.roles ? Object.freeze(rule.roles.slice()) : undefined });
});


function matchRule(path, method) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '/');
  for (const rule of rules) {
    if (rule.method !== m) continue;
    if (rule.path && rule.path === p) return rule;
    if (rule.pathPattern && rule.pathPattern.test(p)) return rule;
  }
  return null;
}

function routeAuthorizationPolicy(path, method) {
  return matchRule(path, method);
}

function allProtectedRouteRules() {
  return rules.slice();
}

function isKnownRole(role) {
  return ALL_ROLES.includes(normalizeRole(role));
}

module.exports = { routeAuthorizationPolicy, allProtectedRouteRules, ALL_ROLES, isKnownRole };

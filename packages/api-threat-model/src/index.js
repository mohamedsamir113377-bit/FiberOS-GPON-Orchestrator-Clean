'use strict';

/**
 * API threat model aligned with the OWASP API Security Top 10 (2023) and the
 * API-security-in-depth concepts of "API Security in Action" (N. Madden, Manning).
 * Pure policy evaluation: it decides, it never performs the call itself.
 */

const OWASP_API_TOP10_2023 = Object.freeze([
  Object.freeze({ id: 'API1', key: 'BOLA', label: 'Broken Object Level Authorization' }),
  Object.freeze({ id: 'API2', key: 'BROKEN_AUTH', label: 'Broken Authentication' }),
  Object.freeze({ id: 'API3', key: 'BOPLA', label: 'Broken Object Property Level Authorization' }),
  Object.freeze({ id: 'API4', key: 'RESOURCE_CONSUMPTION', label: 'Unrestricted Resource Consumption' }),
  Object.freeze({ id: 'API5', key: 'BFLA', label: 'Broken Function Level Authorization' }),
  Object.freeze({ id: 'API6', key: 'SENSITIVE_FLOWS', label: 'Unrestricted Access to Sensitive Business Flows' }),
  Object.freeze({ id: 'API7', key: 'SSRF', label: 'Server Side Request Forgery' }),
  Object.freeze({ id: 'API8', key: 'MISCONFIGURATION', label: 'Security Misconfiguration' }),
  Object.freeze({ id: 'API9', key: 'INVENTORY', label: 'Improper Inventory Management' }),
  Object.freeze({ id: 'API10', key: 'UNSAFE_CONSUMPTION', label: 'Unsafe Consumption of APIs' })
]);

function checkObjectLevelAuthorization({ callerTenantId, callerScopes, resource }) {
  if (!resource || resource.tenantId == null) throw new Error('ATM_RESOURCE_TENANT_REQUIRED');
  if (String(callerTenantId) !== String(resource.tenantId)) {
    return Object.freeze({ allowed: false, threat: 'API1', reason: 'CROSS_TENANT_OBJECT_ACCESS' });
  }
  const required = Array.isArray(resource.requiredScopes) ? resource.requiredScopes : [];
  const have = new Set(callerScopes || []);
  const missing = required.filter((s) => !have.has(s));
  if (missing.length) return Object.freeze({ allowed: false, threat: 'API3', reason: 'PROPERTY_SCOPE_MISSING', missing: Object.freeze(missing) });
  return Object.freeze({ allowed: true });
}

function checkFunctionLevelAuthorization({ callerRoles, requiredRoles }) {
  const need = Array.isArray(requiredRoles) ? requiredRoles : [];
  const have = new Set(callerRoles || []);
  const missing = need.filter((r) => !have.has(r));
  if (missing.length) return Object.freeze({ allowed: false, threat: 'API5', reason: 'FUNCTION_ROLE_MISSING', missing: Object.freeze(missing) });
  return Object.freeze({ allowed: true });
}

function checkResourceConsumption({ requested, limit }) {
  const r = Number(requested), l = Number(limit);
  if (!Number.isFinite(r) || r < 0) throw new Error('ATM_REQUESTED_INVALID');
  if (!Number.isFinite(l) || l <= 0) throw new Error('ATM_LIMIT_INVALID');
  if (r > l) return Object.freeze({ allowed: false, threat: 'API4', reason: 'RESOURCE_LIMIT_EXCEEDED', requested: r, limit: l });
  return Object.freeze({ allowed: true, remaining: Number((l - r).toFixed(4)) });
}

function checkOutboundTarget({ url, allowlist }) {
  let host;
  try { host = new URL(String(url)).hostname; } catch { return Object.freeze({ allowed: false, threat: 'API7', reason: 'URL_INVALID' }); }
  const blocked = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?)/i.test(host);
  if (blocked) return Object.freeze({ allowed: false, threat: 'API7', reason: 'SSRF_PRIVATE_TARGET_BLOCKED', host });
  const list = Array.isArray(allowlist) ? allowlist : [];
  if (list.length && !list.includes(host)) return Object.freeze({ allowed: false, threat: 'API7', reason: 'SSRF_NOT_ALLOWLISTED', host });
  return Object.freeze({ allowed: true, host });
}

function tokenBindingPolicy({ senderConstrained, proofPresent }) {
  const enforced = !!senderConstrained;
  return Object.freeze({
    bindingRequired: enforced,
    accepted: !enforced || !!proofPresent,
    mode: enforced ? 'DPOP_OR_MTLS' : 'BEARER_ONLY',
    threat: enforced && !proofPresent ? 'API2' : null
  });
}

function classifyThreat(findingKey) {
  const f = OWASP_API_TOP10_2023.find((t) => t.key === String(findingKey) || t.id === String(findingKey));
  if (!f) throw new Error('ATM_FINDING_UNKNOWN');
  return f;
}

module.exports = { OWASP_API_TOP10_2023, checkObjectLevelAuthorization, checkFunctionLevelAuthorization, checkResourceConsumption, checkOutboundTarget, tokenBindingPolicy, classifyThreat };

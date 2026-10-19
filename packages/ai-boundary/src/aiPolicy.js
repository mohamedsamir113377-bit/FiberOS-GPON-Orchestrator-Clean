/**
 * AI enablement policy — the single decision point for "may this process infer?".
 *
 * Every inference path (API route, AI gateway service, website advisory runtime)
 * must consult this module. A URL that happens to be configurable is a routing
 * hint only: it is NEVER evidence that the model is local. Locality has to be
 * attested through the outbound host/CIDR allowlist in packages/security/src/outboundPolicy.js.
 */
'use strict';

const ENABLE_VARS = Object.freeze(['AI_ENABLED', 'FIBEROS_AI_ENABLED']);
const INFERENCE_URL_VARS = Object.freeze(['FIBEROS_AI_INFERENCE_URL', 'AI_UPSTREAM_URL']);

function truthy(value) {
  return String(value == null ? '' : value).trim().toLowerCase() === 'true';
}

function isSet(value) {
  return String(value == null ? '' : value).trim() !== '';
}

/**
 * Resolve the AI policy for a process environment.
 * Conflicting enable flags fail closed: the process is treated as disabled.
 */
function resolveAiPolicy(env) {
  const source = env || process.env;
  const declaredBy = ENABLE_VARS.filter((name) => isSet(source[name]));
  const enabledFlags = declaredBy.map((name) => truthy(source[name]));
  const conflict = enabledFlags.length > 1 && enabledFlags.some(Boolean) && enabledFlags.some((v) => !v);
  const enabled = !conflict && enabledFlags.length > 0 && enabledFlags.every(Boolean);
  const inferenceEnvNames = INFERENCE_URL_VARS.filter((name) => isSet(source[name]));
  const inferenceValues = inferenceEnvNames.map((name) => String(source[name]).trim());
  const inferenceConflict = inferenceValues.length > 1 && new Set(inferenceValues).size > 1;
  return Object.freeze({
    aiEnabled: enabled,
    conflict,
    declaredBy: Object.freeze(declaredBy),
    authority: 'ADVISORY_ONLY',
    inferenceConfigured: inferenceEnvNames.length > 0,
    inferenceEnvNames: Object.freeze(inferenceEnvNames),
    inferenceConflict,
    // Explicitly not evidence: configuration cannot prove local execution.
    localityEvidence: 'NONE_FROM_CONFIGURATION',
    requiredAttestation: 'FIBEROS_SELF_HOSTED_HOSTS_OR_CIDRS'
  });
}

function assertAiEnabled(env) {
  const policy = resolveAiPolicy(env);
  if (!policy.aiEnabled) {
    const error = new Error(policy.conflict ? 'AI_ENABLE_FLAGS_CONFLICT' : 'AI_DISABLED');
    error.code = policy.conflict ? 'AI_ENABLE_FLAGS_CONFLICT' : 'AI_DISABLED';
    error.statusCode = 503;
    throw error;
  }
  return policy;
}

module.exports = Object.freeze({ ENABLE_VARS, INFERENCE_URL_VARS, resolveAiPolicy, assertAiEnabled });

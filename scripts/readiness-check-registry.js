/**
 * Readiness certification check-name registry.
 *
 * The gate may only ever report a check whose name appears in KNOWN_CHECK_NAMES.
 * An unknown name must never be silently treated as a pass, and a missing
 * required check must never be silently treated as satisfied — either would let
 * the readiness gate succeed while a real precondition was never evaluated.
 */
'use strict';

const KNOWN_CHECK_NAMES = Object.freeze([
  'node',
  'npm',
  'database',
  'secretsBoundary',
  'tlsIngress',
  'rlsTenantIsolation',
  'rateLimitBoundary',
  'replayDefense',
  'kernelBoundaryMode',
  'redisHighAvailability',
  'identityOidcJwks',
  'i18nProductionLocales',
  'healthMetricsAlerts',
  'backupRestore',
  'externalAdapters',
  'checkNamePolicy'
]);

const ALWAYS_REQUIRED_CHECKS = Object.freeze([
  'node',
  'npm',
  'database',
  'secretsBoundary',
  'tlsIngress',
  'rlsTenantIsolation',
  'rateLimitBoundary',
  'replayDefense',
  'kernelBoundaryMode',
  'identityOidcJwks',
  'i18nProductionLocales',
  'healthMetricsAlerts',
  'backupRestore',
  'externalAdapters',
  'checkNamePolicy'
]);

const CONDITIONAL_CHECK_NAMES = Object.freeze(['redisHighAvailability']);
const REQUIRED_CHECKS_ENV = 'FIBEROS_READINESS_REQUIRED_CHECKS';

function normalizeCheckName(value) {
  return String(value == null ? '' : value).trim();
}

function isKnownCheckName(value) {
  return KNOWN_CHECK_NAMES.includes(normalizeCheckName(value));
}

/**
 * Parse an operator-supplied required-check list.
 * Empty entries, unknown names and case mismatches all fail closed.
 */
function resolveRequiredChecks(env) {
  const source = env || process.env;
  const base = ALWAYS_REQUIRED_CHECKS.slice();
  const raw = String(source[REQUIRED_CHECKS_ENV] == null ? '' : source[REQUIRED_CHECKS_ENV]);
  if (!raw.trim()) return Object.freeze({ ok: true, required: Object.freeze(base), unknown: Object.freeze([]), empty: Object.freeze([]), error: null });
  const entries = raw.split(',').map((v) => v.trim());
  const empty = [];
  const unknown = [];
  const accepted = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === '') { empty.push(i); continue; }
    if (!KNOWN_CHECK_NAMES.includes(entry)) { unknown.push(entry); continue; }
    accepted.push(entry);
  }
  const ok = empty.length === 0 && unknown.length === 0;
  const required = ok ? Object.freeze([...new Set([...base, ...accepted])]) : Object.freeze(base);
  return Object.freeze({
    ok,
    required,
    unknown: Object.freeze(unknown),
    empty: Object.freeze(empty),
    error: ok ? null : (unknown.length ? 'READINESS_REQUIRED_CHECK_UNKNOWN' : 'READINESS_REQUIRED_CHECK_EMPTY')
  });
}

/**
 * Validate the emitted check set.
 * - any emitted name not in the registry -> unknown (hard fail)
 * - duplicated emitted name -> duplicates (hard fail)
 * - any required name absent from the emitted set -> missing (hard fail)
 */
function validateCheckNames(checks, options) {
  const list = Array.isArray(checks) ? checks : [];
  const opts = options || {};
  const acceptedSet = new Set(opts.knownCheckNames || KNOWN_CHECK_NAMES);
  const required = Array.isArray(opts.required) ? opts.required : ALWAYS_REQUIRED_CHECKS.slice();
  const names = list.map((check) => normalizeCheckName(check && check.name));
  const unknown = [...new Set(names.filter((name) => !acceptedSet.has(name)))].sort();
  const seen = new Set();
  const duplicates = [];
  for (const name of names) {
    if (seen.has(name)) duplicates.push(name);
    else seen.add(name);
  }
  const missing = required.filter((name) => !seen.has(name)).sort();
  return Object.freeze({
    ok: unknown.length === 0 && missing.length === 0 && duplicates.length === 0,
    unknown: Object.freeze(unknown),
    missing: Object.freeze([...new Set(missing)]),
    duplicates: Object.freeze([...new Set(duplicates)].sort()),
    accepted: Object.freeze([...seen].sort()),
    required: Object.freeze(required.slice())
  });
}

module.exports = Object.freeze({
  KNOWN_CHECK_NAMES,
  ALWAYS_REQUIRED_CHECKS,
  CONDITIONAL_CHECK_NAMES,
  REQUIRED_CHECKS_ENV,
  normalizeCheckName,
  isKnownCheckName,
  resolveRequiredChecks,
  validateCheckNames
});

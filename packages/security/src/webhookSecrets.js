'use strict';
const crypto = require('crypto');

function keyForProvider(providerKey) {
  return String(providerKey || '').trim();
}

function envNameForRef(secretRef) {
  const ref = String(secretRef || '').trim();
  if (!ref || !/^[A-Za-z0-9._:-]+$/.test(ref) || ref.length > 128) return null;
  return `FIBEROS_WEBHOOK_SECRET_${Buffer.from(ref, 'utf8').toString('base64url').toUpperCase().replace(/[^A-Z0-9_]/g,'_')}`;
}

function parseSecretMap(env) {
  const raw = String((env || process.env).FIBEROS_WEBHOOK_SECRETS_JSON || '').trim();
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

function resolveWebhookSecret(secretRef, env) {
  const e = env || process.env;
  const ref = keyForProvider(secretRef);
  if (!ref) return { ok: false, code: 'TELCO_SIGNING_SECRET_REF_REQUIRED' };

  const directName = envNameForRef(ref);
  const direct = directName ? String(e[directName] || '') : '';
  if (direct) {
    if (Buffer.byteLength(direct, 'utf8') < 32) return { ok: false, code: 'TELCO_SIGNING_SECRET_TOO_SHORT' };
    return { ok: true, secret: direct, provider: 'environment', source: directName };
  }

  const map = parseSecretMap(e);
  if (map === null) return { ok: false, code: 'TELCO_WEBHOOK_SECRETS_JSON_INVALID' };
  const mapped = map && typeof map[ref] === 'string' ? map[ref] : '';
  if (mapped) {
    if (Buffer.byteLength(mapped, 'utf8') < 32) return { ok: false, code: 'TELCO_SIGNING_SECRET_TOO_SHORT' };
    return { ok: true, secret: mapped, provider: 'environment-map', source: 'FIBEROS_WEBHOOK_SECRETS_JSON' };
  }
  return { ok: false, code: 'TELCO_SIGNING_SECRET_UNAVAILABLE' };
}

function secretFingerprint(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 16);
}

module.exports = { resolveWebhookSecret, envNameForRef, secretFingerprint };

'use strict';
const crypto = require('node:crypto');

const AI_ADVISE_PATH = '/v1/ai/advise';
const LEGACY_AI_ADVISE_PATH = '/v1/advise';

function canonicalAiPath(path) {
  if (path === AI_ADVISE_PATH || path === LEGACY_AI_ADVISE_PATH) return AI_ADVISE_PATH;
  return null;
}

function publicAiHealthResponse() {
  return Object.freeze({
    ok: true,
    service: 'fiberos-ai',
    authority: 'ADVISORY_ONLY',
    executionAuthorized: false
  });
}

function aiPrincipalRateKey(principal) {
  const subject = String(principal && principal.sub || '').trim();
  const tenant = String(principal && principal.tenant_id || '').trim();
  if (!subject) throw new Error('AI_RATE_LIMIT_PRINCIPAL_REQUIRED');
  return crypto.createHash('sha256')
    .update(`fiberos-ai|tenant:${tenant}|sub:${subject}`, 'utf8')
    .digest('hex');
}

module.exports = Object.freeze({
  AI_ADVISE_PATH,
  LEGACY_AI_ADVISE_PATH,
  canonicalAiPath,
  publicAiHealthResponse,
  aiPrincipalRateKey
});

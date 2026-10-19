'use strict';
const { assertNode, mediaPolicy, aiVoiceEnvelope } = require('./index');
const { parseAttestedOutboundUrl, joinAttestedPath, resolveAttestedOutboundTarget, requestAttested } = require('../../security/src/outboundPolicy');

function ariUrl() {
  return parseAttestedOutboundUrl(process.env.FIBEROS_CONTACT_ARI_URL, { envName:'FIBEROS_CONTACT_ARI_URL', codePrefix:'CONTACT_ARI', productionPort443:false });
}

function authorizeMedia(protocol) { return mediaPolicy({ protocol, encrypted: true }); }

async function health() {
  const u = ariUrl();
  const url = joinAttestedPath(u, '/ari/asterisk/info');
  const target = await resolveAttestedOutboundTarget(u, { codePrefix:'CONTACT_ARI' });
  const response = await requestAttested(url, target, { codePrefix:'CONTACT_ARI', method:'GET', timeoutMs:10000, maxResponseBytes:512 * 1024 });
  return Object.freeze({ ok:response.ok, status:response.status, authority:'FIBEROS_POLICY' });
}

function aiSession(input) { return aiVoiceEnvelope(input); }

module.exports = { ariUrl, authorizeMedia, health, aiSession };

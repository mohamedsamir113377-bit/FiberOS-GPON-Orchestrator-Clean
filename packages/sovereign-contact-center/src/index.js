'use strict';
const MEDIA_PROTOCOLS = Object.freeze(['SIP_TLS','WSS_WEBRTC','SRTP']);
const NODE_ROLES = Object.freeze(['CONTROL_PLANE','MEDIA_PLANE']);
function assertNode(node = {}) {
  if (!node.tenantId) throw new Error('CC_TENANT_REQUIRED');
  if (!NODE_ROLES.includes(String(node.role))) throw new Error('CC_NODE_ROLE_INVALID');
  if (node.publicAdmin === true) throw new Error('CC_PUBLIC_ADMIN_FORBIDDEN');
  if (node.secretInConfig === true) throw new Error('CC_SECRET_IN_CONFIG_FORBIDDEN');
  return true;
}
function mediaPolicy({ protocol, encrypted = false } = {}) {
  if (!MEDIA_PROTOCOLS.includes(String(protocol))) throw new Error('CC_MEDIA_PROTOCOL_INVALID');
  if (!encrypted) throw new Error('CC_MEDIA_ENCRYPTION_REQUIRED');
  return Object.freeze({ protocol: String(protocol), encrypted: true, authority: 'FIBEROS_POLICY' });
}
function aiVoiceEnvelope(input = {}) {
  return Object.freeze({
    surface: 'CONTACT_CENTER',
    authority: 'ADVISORY_ONLY',
    executionAuthorized: false,
    callSessionId: input.callSessionId == null ? null : String(input.callSessionId),
    escalation: input.escalation === true
  });
}
module.exports = { MEDIA_PROTOCOLS, NODE_ROLES, assertNode, mediaPolicy, aiVoiceEnvelope };

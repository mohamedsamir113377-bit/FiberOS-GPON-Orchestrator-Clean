'use strict';
/**
 * Audit client helpers — server/DB is append-only authority.
 * This package never claims it can mutate audit_log.
 */
function buildAuditEvent(input) {
  input = input || {};
  return Object.freeze({
    action: String(input.action || 'UNKNOWN'),
    refId: input.refId || null,
    detail: input.detail || null,
    actorSub: input.actorSub || null,
    at: new Date().toISOString(),
    mutability: 'APPEND_ONLY_SERVER'
  });
}

module.exports = {
  buildAuditEvent: buildAuditEvent,
  canClientMutateAudit: false
};

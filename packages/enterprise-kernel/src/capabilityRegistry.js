'use strict';

const STATUSES = Object.freeze([
  'SPEC_ONLY', 'IMPLEMENTED', 'UNIT_TESTED', 'INTEGRATION_TESTED', 'CONNECTED',
  'FIELD_VERIFIED', 'PRODUCTION_READY', 'DEGRADED', 'UNAVAILABLE', 'SIMULATED'
]);

const ORDER = new Map(STATUSES.map((s, i) => [s, i]));

class CapabilityRegistry {
  constructor(seed) { this._items = new Map(); for (const item of seed || []) this.register(item); }
  register(input) {
    if (!input || !input.key) throw new Error('CAPABILITY_KEY_REQUIRED');
    if (!STATUSES.includes(input.status)) throw new Error('CAPABILITY_STATUS_INVALID');
    const item = {
      key: String(input.key), name: String(input.name || input.key), status: input.status,
      version: input.version || null, evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.slice() : [],
      dependencies: Array.isArray(input.dependencies) ? input.dependencies.slice() : [],
      limitations: Array.isArray(input.limitations) ? input.limitations.slice() : [],
      updatedAt: new Date().toISOString()
    };
    this._items.set(item.key, Object.freeze(item));
    return item;
  }
  get(key) { return this._items.get(key) || null; }
  list() { return [...this._items.values()].map(x => ({ ...x })); }
  canClaimProduction(key) {
    const item = this.get(key);
    if (!item) return { ok: false, reason: 'CAPABILITY_UNKNOWN' };
    if (item.status !== 'PRODUCTION_READY') return { ok: false, reason: 'CAPABILITY_NOT_PRODUCTION_READY', status: item.status };
    if (!item.evidenceRefs.length) return { ok: false, reason: 'PRODUCTION_EVIDENCE_REQUIRED' };
    return { ok: true };
  }
  transition(key, nextStatus, evidenceRefs) {
    const current = this.get(key);
    if (!current) throw new Error('CAPABILITY_UNKNOWN');
    if (!STATUSES.includes(nextStatus)) throw new Error('CAPABILITY_STATUS_INVALID');
    const exceptional = ['DEGRADED', 'UNAVAILABLE', 'SIMULATED'].includes(nextStatus);
    if (!exceptional && ORDER.get(nextStatus) < ORDER.get(current.status)) throw new Error('CAPABILITY_STATUS_REGRESSION');
    return this.register({ ...current, status: nextStatus, evidenceRefs: evidenceRefs || current.evidenceRefs });
  }
}

module.exports = { STATUSES, CapabilityRegistry };

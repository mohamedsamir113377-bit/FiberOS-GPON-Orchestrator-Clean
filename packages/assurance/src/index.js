'use strict';

/**
 * Evidence-backed capability registry.
 * This registry is intentionally conservative: a capability is not REAL merely
 * because a UI label exists. REAL requires an executable server surface.
 */
const CAPABILITY_STATUS = Object.freeze({
  REAL: 'REAL',
  INTEGRATION_REQUIRED: 'INTEGRATION_REQUIRED',
  ADVISORY: 'ADVISORY',
  UNIMPLEMENTED: 'UNIMPLEMENTED',
  VISION: 'VISION'
});

function normalizeStatus(s) {
  if (!Object.values(CAPABILITY_STATUS).includes(s)) throw new Error(`Unknown capability status: ${s}`);
  return s;
}

function createRegistry(entries) {
  const map = new Map();
  for (const entry of entries || []) {
    if (!entry || !entry.id || !entry.name) throw new Error('Capability entry requires id and name');
    if (map.has(entry.id)) throw new Error(`Duplicate capability id: ${entry.id}`);
    map.set(entry.id, Object.freeze({
      id: String(entry.id),
      name: String(entry.name),
      status: normalizeStatus(entry.status || CAPABILITY_STATUS.UNIMPLEMENTED),
      evidence: Array.isArray(entry.evidence) ? entry.evidence.map(String) : [],
      serverSurfaces: Array.isArray(entry.serverSurfaces) ? entry.serverSurfaces.map(String) : [],
      externalDependency: entry.externalDependency ? String(entry.externalDependency) : null,
      notes: entry.notes ? String(entry.notes) : ''
    }));
  }
  return Object.freeze({
    list(filter = {}) {
      let out = [...map.values()];
      if (filter.status) out = out.filter(x => x.status === filter.status);
      if (filter.q) {
        const q = String(filter.q).toLowerCase();
        out = out.filter(x => `${x.id} ${x.name} ${x.notes}`.toLowerCase().includes(q));
      }
      return out;
    },
    get(id) { return map.get(id) || null; },
    summary() {
      const counts = Object.fromEntries(Object.values(CAPABILITY_STATUS).map(s => [s, 0]));
      for (const x of map.values()) counts[x.status]++;
      return { total: map.size, counts };
    }
  });
}

module.exports = { CAPABILITY_STATUS, createRegistry };

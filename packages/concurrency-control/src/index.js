'use strict';

/**
 * Strict concurrency control: optimistic version CAS, interval exclusion,
 * serializable conflict-graph analysis and deterministic lock ordering.
 * Concept source (public): data-intensive systems literature (transactions,
 * isolation levels, conflict serializability, deadlock). Deterministic, pure.
 */

function optimisticUpdate({ currentVersion, expectedVersion, patch }) {
  const cur = Number(currentVersion);
  const exp = Number(expectedVersion);
  if (!Number.isSafeInteger(cur) || cur < 0) throw new Error('CC_CURRENT_VERSION_INVALID');
  if (!Number.isSafeInteger(exp) || exp < 0) throw new Error('CC_EXPECTED_VERSION_INVALID');
  if (cur !== exp) {
    return Object.freeze({ ok: false, reason: 'VERSION_CONFLICT', currentVersion: cur, expectedVersion: exp });
  }
  return Object.freeze({ ok: true, nextVersion: cur + 1, patch: patch || {} });
}

function intervalsOverlap(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2) throw new Error('CC_INTERVAL_INVALID');
  const [as, ae] = a.map(Number), [bs, be] = b.map(Number);
  if (![as, ae, bs, be].every(Number.isFinite) || as >= ae || bs >= be) throw new Error('CC_INTERVAL_INVALID');
  return as < be && bs < ae; // half-open [start, end)
}

function findExclusionConflicts(bookings) {
  if (!Array.isArray(bookings)) throw new Error('CC_BOOKINGS_REQUIRED');
  const groups = [];
  for (let i = 0; i < bookings.length; i++) {
    for (let j = i + 1; j < bookings.length; j++) {
      const a = bookings[i], b = bookings[j];
      if (String(a.ownerId) !== String(b.ownerId)) continue;
      if (a.status && a.status !== 'ACTIVE') continue;
      if (b.status && b.status !== 'ACTIVE') continue;
      if (intervalsOverlap([a.start, a.end], [b.start, b.end])) {
        groups.push(Object.freeze({ ownerId: String(a.ownerId), a: String(a.id), b: String(b.id) }));
      }
    }
  }
  return Object.freeze({ conflictFree: groups.length === 0, conflicts: Object.freeze(groups) });
}

function detectDeadlock(edges) {
  if (!Array.isArray(edges)) throw new Error('CC_EDGES_REQUIRED');
  const adj = new Map();
  const nodes = new Set();
  for (const e of edges) {
    const from = String(e.from), to = String(e.to);
    nodes.add(from); nodes.add(to);
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(to);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map([...nodes].map((n) => [n, WHITE]));
  const stack = [];
  let cycle = null;
  const dfs = (n) => {
    color.set(n, GREY); stack.push(n);
    for (const m of adj.get(n) || []) {
      if (color.get(m) === GREY) { cycle = stack.slice(stack.indexOf(m)).concat(m); return true; }
      if (color.get(m) === WHITE && dfs(m)) return true;
    }
    color.set(n, BLACK); stack.pop();
    return false;
  };
  for (const n of nodes) if (color.get(n) === WHITE && dfs(n)) break;
  return Object.freeze({ deadlock: cycle !== null, cycle: cycle ? Object.freeze(cycle) : null });
}

function canonicalLockOrder(resources) {
  if (!Array.isArray(resources)) throw new Error('CC_RESOURCES_REQUIRED');
  return Object.freeze(resources.map((r) => String(r)).slice().sort());
}

const ISOLATION_LEVELS = Object.freeze(['READ_COMMITTED', 'REPEATABLE_READ', 'SERIALIZABLE']);
function isolationPolicy(level) {
  const l = String(level).toUpperCase();
  if (!ISOLATION_LEVELS.includes(l)) throw new Error('CC_ISOLATION_LEVEL_INVALID');
  return Object.freeze({
    level: l,
    preventsLostUpdate: l !== 'READ_COMMITTED',
    preventsWriteSkew: l === 'SERIALIZABLE',
    requiresRetry: l === 'SERIALIZABLE',
    serializable: l === 'SERIALIZABLE'
  });
}

module.exports = { optimisticUpdate, intervalsOverlap, findExclusionConflicts, detectDeadlock, canonicalLockOrder, ISOLATION_LEVELS, isolationPolicy };

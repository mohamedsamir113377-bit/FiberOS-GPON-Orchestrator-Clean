'use strict';
const crypto = require('crypto');
const OPS = ['INSERT', 'UPDATE', 'DELETE'];

function canonical(entry, prevHash) {
  return [prevHash || '', entry.tenantId, entry.table, entry.pk, entry.op,
    JSON.stringify(entry.oldData || null), JSON.stringify(entry.newData || null), entry.changedAt].join('\u0001');
}
function createStore() { return { entries: [] }; }
// Append-only, per-tenant hash chain. Mirrors migration 188 (ecl_chain / ecl_no_mutate).
function append(store, entry, nowMs) {
  if (!store || !Array.isArray(store.entries)) throw new TypeError('store.entries must be an array');
  for (const k of ['tenantId', 'table', 'pk', 'actor']) {
    if (typeof entry[k] !== 'string' || entry[k].trim() === '') return { ok: false, code: 'INVALID', errors: [k + ' is required'] };
  }
  if (!OPS.includes(entry.op)) return { ok: false, code: 'INVALID', errors: ['op must be one of ' + OPS.join('|')] };
  if (entry.op === 'UPDATE' && !entry.oldData) return { ok: false, code: 'INVALID', errors: ['UPDATE requires oldData'] };
  const chain = store.entries.filter((e) => e.tenantId === entry.tenantId);
  const prev = chain.length ? chain[chain.length - 1].rowHash : null;
  const changedAt = new Date(typeof nowMs === 'number' ? nowMs : Date.now()).toISOString();
  const record = { seq: store.entries.length + 1, tenantId: entry.tenantId, table: entry.table, pk: entry.pk, op: entry.op,
    oldData: entry.oldData || null, newData: entry.newData || null, actor: entry.actor, changedAt, prevHash: prev, rowHash: null };
  record.rowHash = crypto.createHash('sha256').update(canonical(record, prev)).digest('hex');
  store.entries.push(record);
  return { ok: true, seq: record.seq, rowHash: record.rowHash };
}
function update() { return { ok: false, code: 'APPEND_ONLY', reason: 'enterprise_change_log is append-only' }; }
function remove() { return { ok: false, code: 'APPEND_ONLY', reason: 'enterprise_change_log is append-only' }; }
// as-of reconstruction, strictly scoped to the caller's tenant
function asOf(store, tenantId, table, pk, timestamp) {
  const t = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp;
  if (typeof tenantId !== 'string' || tenantId.trim() === '') throw new TypeError('tenantId is required');
  const rows = store.entries.filter((e) => e.tenantId === tenantId && e.table === table && e.pk === pk && Date.parse(e.changedAt) <= t);
  if (!rows.length) return { found: false, value: null };
  const last = rows[rows.length - 1];
  if (last.op === 'DELETE') return { found: false, value: null, deletedAt: last.changedAt };
  return { found: true, value: last.newData, asOfSeq: last.seq };
}
// Returns the first broken seq for a tenant, or null when the chain is intact.
function verifyChain(store, tenantId) {
  const rows = store.entries.filter((e) => !tenantId || e.tenantId === tenantId);
  let prev = null;
  for (const r of rows) {
    const expected = crypto.createHash('sha256').update(canonical(r, r.prevHash)).digest('hex');
    if (r.prevHash !== prev || r.rowHash !== expected) return r.seq;
    prev = r.rowHash;
  }
  return null;
}
module.exports = { createStore, append, update, remove, asOf, verifyChain, canonical };

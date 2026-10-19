'use strict';

function normalizeValue(v) {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NaN';
  return JSON.stringify(v);
}

function detectConflicts(facts, opts) {
  opts = opts || {};
  const groups = new Map();
  for (const fact of Array.isArray(facts) ? facts : []) {
    const key = [fact.subjectType, fact.subjectId, fact.attribute || 'value'].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fact);
  }
  const conflicts = [];
  for (const [key, list] of groups) {
    const values = new Set(list.map(f => normalizeValue(f.value)));
    if (values.size <= 1) continue;
    const sources = [...new Set(list.map(f => f.source))];
    conflicts.push({
      conflictId: opts.idFactory ? opts.idFactory() : undefined,
      key,
      severity: sources.includes('nms_poll') && sources.includes('field_reading') ? 'HIGH' : 'MEDIUM',
      factIds: list.map(f => f.factId),
      sources,
      status: 'OPEN',
      detectedAt: new Date().toISOString(),
      rule: 'MULTIPLE_AUTHORITATIVE_VALUES'
    });
  }
  return conflicts;
}

function resolutionAllowed(conflict, resolution) {
  if (!conflict || conflict.status !== 'OPEN') return { ok: false, reason: 'CONFLICT_NOT_OPEN' };
  if (!resolution || !resolution.resolverId) return { ok: false, reason: 'RESOLVER_REQUIRED' };
  if (!resolution.evidenceIds || !resolution.evidenceIds.length) return { ok: false, reason: 'RESOLUTION_EVIDENCE_REQUIRED' };
  if (!resolution.rationale) return { ok: false, reason: 'RESOLUTION_RATIONALE_REQUIRED' };
  return { ok: true };
}

module.exports = { detectConflicts, resolutionAllowed };

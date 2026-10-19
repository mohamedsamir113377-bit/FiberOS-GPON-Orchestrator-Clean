'use strict';
function normalize(value, spec) {
  if (!spec || typeof spec.min !== 'number' || typeof spec.max !== 'number' || spec.max <= spec.min) throw new TypeError('indicator needs numeric min < max');
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('value must be finite');
  const clamped = Math.min(Math.max(value, spec.min), spec.max);
  const ratio = (clamped - spec.min) / (spec.max - spec.min);
  return Number((spec.invert ? 1 - ratio : ratio).toFixed(6));
}
function validateIndicators(indicators) {
  if (!Array.isArray(indicators) || indicators.length === 0) throw new TypeError('indicators must be a non-empty array');
  const errors = [];
  const seen = new Set();
  for (const i of indicators) {
    if (!i || typeof i.id !== 'string' || i.id.trim() === '') { errors.push('indicator without id'); continue; }
    if (seen.has(i.id)) errors.push('duplicate indicator ' + i.id);
    seen.add(i.id);
    if (typeof i.source !== 'string' || i.source.trim() === '') errors.push(i.id + ': source is required (no estimated sources)');
    if (typeof i.weight !== 'number' || !(i.weight > 0)) errors.push(i.id + ': weight must be > 0');
    if (i.min === i.max) errors.push(i.id + ': min and max cannot be equal');
  }
  return { ok: errors.length === 0, errors };
}
// No fabricated defaults: a missing observation makes the index unavailable rather than silently zero.
function computeIndex(definition, observations) {
  const v = validateIndicators(definition.indicators);
  if (!v.ok) return { ok: false, code: 'INVALID_DEFINITION', errors: v.errors };
  const obs = observations || {};
  const missing = definition.indicators.filter((i) => !(i.id in obs)).map((i) => i.id);
  if (missing.length) return { ok: false, code: 'MISSING_OBSERVATIONS', missing };
  let weighted = 0, totalWeight = 0;
  const parts = [];
  for (const ind of definition.indicators) {
    const n = normalize(obs[ind.id], ind);
    weighted += n * ind.weight;
    totalWeight += ind.weight;
    parts.push({ id: ind.id, normalized: n, weight: ind.weight, source: ind.source });
  }
  const score = Number(((weighted / totalWeight) * 100).toFixed(4));
  const band = score >= 80 ? 'strong' : score >= 60 ? 'fair' : score >= 40 ? 'watch' : 'weak';
  return { ok: true, score, band, parts, version: definition.version || '1.0.0' };
}
function fileObjection(store, objection) {
  if (!store || !Array.isArray(store.objections)) throw new TypeError('store.objections must be an array');
  const errors = [];
  if (typeof objection.indexId !== 'string' || objection.indexId.trim() === '') errors.push('indexId is required');
  if (typeof objection.reason !== 'string' || objection.reason.trim().length < 20) errors.push('reason must be at least 20 characters');
  if (typeof objection.by !== 'string' || objection.by.trim() === '') errors.push('by is required');
  if (errors.length) return { ok: false, code: 'INVALID', errors };
  const id = 'obj-' + (store.objections.length + 1);
  store.objections.push({ id, ...objection, status: 'open', filedAt: new Date().toISOString() });
  return { ok: true, id, status: 'open' };
}
module.exports = { normalize, validateIndicators, computeIndex, fileObjection };

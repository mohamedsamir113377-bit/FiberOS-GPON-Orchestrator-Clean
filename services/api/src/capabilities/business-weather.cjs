'use strict';
const BANDS = [
  { max: 20, label: 'severe' }, { max: 40, label: 'adverse' }, { max: 60, label: 'mixed' },
  { max: 80, label: 'favourable' }, { max: Infinity, label: 'clear' },
];
// business-weather is only computable once each input has an authoritative source and a scale.
function defineInputs(definitions) {
  if (!Array.isArray(definitions) || definitions.length === 0) throw new TypeError('definitions must be a non-empty array');
  const errors = [];
  const ids = new Set();
  for (const d of definitions) {
    if (!d || typeof d.id !== 'string' || d.id.trim() === '') { errors.push('input without id'); continue; }
    if (ids.has(d.id)) errors.push('duplicate input ' + d.id);
    ids.add(d.id);
    if (typeof d.source !== 'string' || d.source.trim() === '') errors.push(d.id + ': source is required');
    if (typeof d.unit !== 'string' || d.unit.trim() === '') errors.push(d.id + ': unit is required');
    if (typeof d.min !== 'number' || typeof d.max !== 'number' || d.max <= d.min) errors.push(d.id + ': requires numeric min < max');
    if (typeof d.weight !== 'number' || !(d.weight > 0)) errors.push(d.id + ': weight must be > 0');
    if (typeof d.invert !== 'boolean') errors.push(d.id + ': invert must be explicitly true or false');
  }
  return { ok: errors.length === 0, errors, definition: errors.length === 0 ? { inputs: definitions } : null };
}
function compute(definitions, values) {
  const d = defineInputs(definitions);
  if (!d.ok) return { ok: false, code: 'UNDEFINED', errors: d.errors };
  const v = values || {};
  const missing = definitions.filter((x) => !(x.id in v)).map((x) => x.id);
  if (missing.length) return { ok: false, code: 'MISSING_INPUTS', missing, note: 'index is withheld rather than guessed' };
  for (const x of definitions) {
    if (typeof v[x.id] !== 'number' || !Number.isFinite(v[x.id])) return { ok: false, code: 'INVALID_VALUE', input: x.id };
  }
  let w = 0, tw = 0;
  const parts = definitions.map((x) => {
    const clamped = Math.min(Math.max(v[x.id], x.min), x.max);
    const ratio = (clamped - x.min) / (x.max - x.min);
    const n = x.invert ? 1 - ratio : ratio;
    w += n * x.weight; tw += x.weight;
    return { id: x.id, value: v[x.id], normalized: Number(n.toFixed(6)), source: x.source };
  });
  const index = Number(((w / tw) * 100).toFixed(4));
  const band = BANDS.find((b) => index <= b.max).label;
  return { ok: true, index, band, parts, computedFrom: definitions.map((x) => x.source) };
}
module.exports = { defineInputs, compute, BANDS };

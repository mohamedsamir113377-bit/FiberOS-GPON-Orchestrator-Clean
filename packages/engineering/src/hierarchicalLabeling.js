'use strict';

/**
 * Hierarchical network labeling — FTTH Handbook Ed.9 p.105-106 guidance:
 * Region → Area → Building → Rack → Panel → Port (left-to-right reading).
 * Operator may declare alternate segment order; uniqueness is enforced on full code.
 */

const DEFAULT_SEGMENTS = Object.freeze([
  'REGION',
  'AREA',
  'BUILDING',
  'RACK',
  'PANEL',
  'PORT'
]);

const CODE_PART_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

function normalizePart(value, name) {
  const s = String(value || '').trim().toUpperCase();
  if (!s || !CODE_PART_RE.test(s)) {
    const e = new Error('LABEL_PART_INVALID');
    e.code = 'LABEL_PART_INVALID';
    e.part = name;
    e.statusCode = 400;
    throw e;
  }
  return s;
}

/**
 * Compose hierarchical label from ordered parts.
 * @param {object} input
 * @param {string[]} [input.segmentOrder]
 * @param {Record<string,string>} input.parts
 * @param {string} [input.separator]
 */
function composeHierarchicalLabel({
  parts = {},
  segmentOrder = DEFAULT_SEGMENTS,
  separator = '-'
} = {}) {
  if (!Array.isArray(segmentOrder) || segmentOrder.length < 2) {
    const e = new Error('LABEL_SEGMENT_ORDER_INVALID');
    e.code = 'LABEL_SEGMENT_ORDER_INVALID';
    e.statusCode = 400;
    throw e;
  }
  const sep = String(separator || '-').slice(0, 3);
  const ordered = [];
  for (const seg of segmentOrder) {
    const key = String(seg).toUpperCase();
    if (parts[key] == null && parts[seg] == null) {
      const e = new Error('LABEL_SEGMENT_MISSING');
      e.code = 'LABEL_SEGMENT_MISSING';
      e.segment = key;
      e.statusCode = 400;
      throw e;
    }
    ordered.push(normalizePart(parts[key] != null ? parts[key] : parts[seg], key));
  }
  const code = ordered.join(sep);
  if (code.length > 200) {
    const e = new Error('LABEL_CODE_TOO_LONG');
    e.code = 'LABEL_CODE_TOO_LONG';
    e.statusCode = 400;
    throw e;
  }
  return Object.freeze({
    code,
    segments: Object.freeze(ordered),
    segmentOrder: Object.freeze(segmentOrder.map((s) => String(s).toUpperCase())),
    separator: sep,
    readingDirection: 'LEFT_TO_RIGHT',
    source: 'FTTH Handbook Ed.9 p.105-106 hierarchical labeling practice',
    truthBoundary: 'LABEL_COMPOSITION_ONLY; PHYSICAL_TAG_PRINT_AND_FIELD_MATCH_UNVERIFIED'
  });
}

function parseHierarchicalLabel(code, { segmentOrder = DEFAULT_SEGMENTS, separator = '-' } = {}) {
  const sep = String(separator || '-');
  const parts = String(code || '')
    .trim()
    .toUpperCase()
    .split(sep)
    .filter(Boolean);
  if (parts.length !== segmentOrder.length) {
    const e = new Error('LABEL_PARSE_SEGMENT_COUNT_MISMATCH');
    e.code = 'LABEL_PARSE_SEGMENT_COUNT_MISMATCH';
    e.statusCode = 400;
    e.expected = segmentOrder.length;
    e.actual = parts.length;
    throw e;
  }
  const map = {};
  segmentOrder.forEach((seg, i) => {
    map[String(seg).toUpperCase()] = parts[i];
  });
  return Object.freeze({
    code: parts.join(sep),
    parts: Object.freeze(map),
    segmentOrder: Object.freeze(segmentOrder.map((s) => String(s).toUpperCase()))
  });
}

/** Fire / reaction-to-fire classes commonly declared on OSP/ISP cables (operator fills exact class). */
const FIRE_CLASS_OPTIONS = Object.freeze([
  'UNDECLARED',
  'CPR_Eca',
  'CPR_Dca',
  'CPR_Cca',
  'CPR_B2ca',
  'CPR_B1ca',
  'CPR_Aca',
  'IEC_60332_1',
  'IEC_60332_3',
  'LSZH',
  'OFNR',
  'OFNP',
  'OTHER'
]);

function assertFireClass(value) {
  const v = String(value || 'UNDECLARED').trim();
  if (!FIRE_CLASS_OPTIONS.includes(v)) {
    const e = new Error('FIRE_CLASS_UNKNOWN');
    e.code = 'FIRE_CLASS_UNKNOWN';
    e.statusCode = 400;
    e.allowed = FIRE_CLASS_OPTIONS.slice();
    throw e;
  }
  return v;
}

module.exports = {
  DEFAULT_SEGMENTS,
  FIRE_CLASS_OPTIONS,
  composeHierarchicalLabel,
  parseHierarchicalLabel,
  assertFireClass
};

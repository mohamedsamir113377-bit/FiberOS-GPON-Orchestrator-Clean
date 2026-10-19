'use strict';

/**
 * Field visit time-slot reservation policy.
 * Inspired by widely published concurrency patterns (unique occupancy,
 * idempotent reserve, conflict detection) — not a copy of any book text.
 *
 * Rules:
 * - Slot is a half-open interval [startsAt, endsAt)
 * - One technician cannot hold two overlapping ACTIVE slots
 * - Client supplies idempotencyKey for safe retries
 * - No synthetic capacity invented; capacity is explicit per slot type
 */

const SLOT_TYPES = Object.freeze([
  'INSTALLATION',
  'FAULT_REPAIR',
  'SURVEY',
  'MAINTENANCE',
  'CALIBRATION',
  'OTHER'
]);

const SLOT_STATUSES = Object.freeze(['HELD', 'CONFIRMED', 'CANCELLED', 'COMPLETED']);

function parseIso(value, field) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const e = new Error('TIME_SLOT_TIMESTAMP_INVALID');
    e.code = 'TIME_SLOT_TIMESTAMP_INVALID';
    e.field = field;
    e.statusCode = 400;
    throw e;
  }
  return d;
}

function assertSlotType(type) {
  const t = String(type || '').toUpperCase();
  if (!SLOT_TYPES.includes(t)) {
    const e = new Error('TIME_SLOT_TYPE_UNKNOWN');
    e.code = 'TIME_SLOT_TYPE_UNKNOWN';
    e.statusCode = 400;
    e.allowed = SLOT_TYPES.slice();
    throw e;
  }
  return t;
}

function assertIdempotencyKey(key) {
  const k = String(key || '').trim();
  if (k.length < 8 || k.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(k)) {
    const e = new Error('IDEMPOTENCY_KEY_INVALID');
    e.code = 'IDEMPOTENCY_KEY_INVALID';
    e.statusCode = 400;
    throw e;
  }
  return k;
}

/**
 * Validate a reservation request before any DB write.
 * Duration limits prevent unbounded resource consumption (OWASP API4 spirit).
 */
function validateReservationRequest({
  technicianId,
  startsAt,
  endsAt,
  slotType = 'INSTALLATION',
  idempotencyKey,
  maxDurationMinutes = 480,
  minDurationMinutes = 15
} = {}) {
  if (!technicianId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(technicianId))) {
    const e = new Error('TECHNICIAN_ID_INVALID');
    e.code = 'TECHNICIAN_ID_INVALID';
    e.statusCode = 400;
    throw e;
  }
  const start = parseIso(startsAt, 'startsAt');
  const end = parseIso(endsAt, 'endsAt');
  if (!(end > start)) {
    const e = new Error('TIME_SLOT_RANGE_INVALID');
    e.code = 'TIME_SLOT_RANGE_INVALID';
    e.statusCode = 400;
    throw e;
  }
  const durationMin = (end.getTime() - start.getTime()) / 60000;
  if (durationMin < minDurationMinutes) {
    const e = new Error('TIME_SLOT_TOO_SHORT');
    e.code = 'TIME_SLOT_TOO_SHORT';
    e.statusCode = 400;
    e.minDurationMinutes = minDurationMinutes;
    throw e;
  }
  if (durationMin > maxDurationMinutes) {
    const e = new Error('TIME_SLOT_TOO_LONG');
    e.code = 'TIME_SLOT_TOO_LONG';
    e.statusCode = 400;
    e.maxDurationMinutes = maxDurationMinutes;
    throw e;
  }
  return Object.freeze({
    technicianId: String(technicianId).toLowerCase(),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    durationMinutes: Math.round(durationMin * 100) / 100,
    slotType: assertSlotType(slotType),
    idempotencyKey: assertIdempotencyKey(idempotencyKey),
    status: 'HELD',
    truthBoundary: 'RESERVATION_REQUEST_VALIDATED; OVERLAP_ENFORCED_AT_DATABASE',
    syntheticData: false
  });
}

/**
 * Detect interval overlap in pure memory (for unit tests / pre-checks).
 * Half-open: [a,b) overlaps [c,d) iff a < d && c < b
 */
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  const a0 = new Date(aStart).getTime();
  const a1 = new Date(aEnd).getTime();
  const b0 = new Date(bStart).getTime();
  const b1 = new Date(bEnd).getTime();
  if ([a0, a1, b0, b1].some((n) => Number.isNaN(n))) return false;
  return a0 < b1 && b0 < a1;
}

function findOverlappingSlots(candidate, existing = []) {
  return (existing || []).filter((row) => {
    if (!row || row.status === 'CANCELLED' || row.status === 'COMPLETED') return false;
    if (String(row.technicianId) !== String(candidate.technicianId)) return false;
    return intervalsOverlap(candidate.startsAt, candidate.endsAt, row.startsAt, row.endsAt);
  });
}

module.exports = {
  SLOT_TYPES,
  SLOT_STATUSES,
  validateReservationRequest,
  intervalsOverlap,
  findOverlappingSlots,
  assertIdempotencyKey
};

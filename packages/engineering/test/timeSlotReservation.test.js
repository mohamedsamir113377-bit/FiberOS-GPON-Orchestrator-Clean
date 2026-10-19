'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateReservationRequest,
  intervalsOverlap,
  findOverlappingSlots
} = require('../src/timeSlotReservation');

const TECH = '11111111-1111-4111-8111-111111111111';

test('valid reservation accepted', () => {
  const r = validateReservationRequest({
    technicianId: TECH,
    startsAt: '2026-10-10T09:00:00.000Z',
    endsAt: '2026-10-10T11:00:00.000Z',
    slotType: 'INSTALLATION',
    idempotencyKey: 'idem-reserve-001'
  });
  assert.equal(r.durationMinutes, 120);
  assert.equal(r.status, 'HELD');
});

test('overlap detection half-open intervals', () => {
  assert.equal(
    intervalsOverlap('2026-10-10T09:00:00Z', '2026-10-10T11:00:00Z', '2026-10-10T10:00:00Z', '2026-10-10T12:00:00Z'),
    true
  );
  assert.equal(
    intervalsOverlap('2026-10-10T09:00:00Z', '2026-10-10T11:00:00Z', '2026-10-10T11:00:00Z', '2026-10-10T12:00:00Z'),
    false
  );
});

test('findOverlappingSlots ignores cancelled', () => {
  const cand = validateReservationRequest({
    technicianId: TECH,
    startsAt: '2026-10-10T09:00:00.000Z',
    endsAt: '2026-10-10T10:00:00.000Z',
    idempotencyKey: 'idem-002'
  });
  const hits = findOverlappingSlots(cand, [
    { technicianId: TECH, startsAt: '2026-10-10T09:30:00Z', endsAt: '2026-10-10T10:30:00Z', status: 'CANCELLED' },
    { technicianId: TECH, startsAt: '2026-10-10T09:30:00Z', endsAt: '2026-10-10T10:30:00Z', status: 'CONFIRMED' }
  ]);
  assert.equal(hits.length, 1);
});

test('rejects missing idempotency and too long slot', () => {
  assert.throws(() => validateReservationRequest({
    technicianId: TECH,
    startsAt: '2026-10-10T09:00:00Z',
    endsAt: '2026-10-10T09:30:00Z'
  }), /IDEMPOTENCY_KEY_INVALID/);
  assert.throws(() => validateReservationRequest({
    technicianId: TECH,
    startsAt: '2026-10-10T09:00:00Z',
    endsAt: '2026-10-11T09:00:00Z',
    idempotencyKey: 'idem-long-001'
  }), /TIME_SLOT_TOO_LONG/);
});

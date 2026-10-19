'use strict';

/**
 * Minimal deterministic tests for skillsEligibility (HV-03 / W8).
 * Run with: node packages/enterprise-kernel/test/skillsEligibility.test.js
 * No external test runner required.
 */

const { evaluateEligibility, filterEligibleCandidates, isExpired } = require('../src/skillsEligibility');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  PASS:', msg);
  } else {
    failed += 1;
    console.error('  FAIL:', msg);
  }
}

console.log('skillsEligibility tests');

// --- isExpired ---
assert(isExpired({ expiresAt: '2020-01-01' }, '2026-09-16') === true, 'past cert is expired');
assert(isExpired({ expiresAt: '2099-01-01' }, '2026-09-16') === false, 'future cert is not expired');
assert(isExpired({ expiresAt: 'invalid' }, '2026-09-16') === true, 'invalid date fails closed');
assert(isExpired(null, '2026-09-16') === false, 'missing cert not expired');

// --- evaluateEligibility happy path ---
const techOk = {
  technicianId: 'T1',
  skills: ['FIBER_SPLICE', 'OTDR'],
  certifications: [{ code: 'SAFETY', expiresAt: '2099-12-31' }],
  available: true,
  activeWorkload: 2
};
const r1 = evaluateEligibility(techOk, ['FIBER_SPLICE']);
assert(r1.eligible === true, 'eligible when skill present and cert valid');
assert(r1.reasons.length === 0, 'no reasons when eligible');
assert(r1.matchedSkills.includes('FIBER_SPLICE'), 'matched skill recorded');

// --- missing skill ---
const r2 = evaluateEligibility(techOk, ['CLIMBING']);
assert(r2.eligible === false, 'not eligible when skill missing');
assert(r2.reasons.some(x => x.startsWith('MISSING_SKILL:')), 'MISSING_SKILL reason present');
assert(r2.missingSkills.includes('CLIMBING'), 'missing skill listed');

// --- expired cert ---
const techExp = {
  skills: ['FIBER_SPLICE'],
  certifications: [{ code: 'SAFETY', expiresAt: '2020-01-01' }],
  available: true
};
const r3 = evaluateEligibility(techExp, ['FIBER_SPLICE'], { now: '2026-09-16' });
assert(r3.eligible === false, 'not eligible with expired cert');
assert(r3.reasons.some(x => x.startsWith('CERT_EXPIRED:')), 'CERT_EXPIRED reason present');

// --- unavailable ---
const techBusy = { skills: ['FIBER_SPLICE'], available: false };
const r4 = evaluateEligibility(techBusy, ['FIBER_SPLICE']);
assert(r4.eligible === false, 'not eligible when unavailable');
assert(r4.reasons.includes('UNAVAILABLE'), 'UNAVAILABLE reason present');

// --- filterEligibleCandidates ---
const candidates = [
  { technicianId: 'A', skills: ['FIBER_SPLICE'], available: true },
  { technicianId: 'B', skills: [], available: true },
  { technicianId: 'C', skills: ['FIBER_SPLICE'], available: false }
];
const filtered = filterEligibleCandidates(candidates, ['FIBER_SPLICE']);
assert(filtered.length === 1, 'filter keeps only eligible');
assert(filtered[0].technicianId === 'A', 'correct candidate kept');
assert(Array.isArray(filtered[0].reasonCodes), 'reasonCodes attached');

const all = filterEligibleCandidates(candidates, ['FIBER_SPLICE'], { includeIneligible: true });
assert(all.length === 3, 'includeIneligible returns all');
assert(all.some(c => c.eligible === false), 'ineligible still present when requested');

// --- empty required skills ---
const r5 = evaluateEligibility({ skills: [], available: true }, []);
assert(r5.eligible === true, 'eligible when no skills required and available');

console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All skillsEligibility tests passed.');

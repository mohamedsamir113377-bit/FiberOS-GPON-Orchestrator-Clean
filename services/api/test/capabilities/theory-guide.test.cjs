'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateClaims, assertNoUnbackedClaims } = require('../../src/capabilities/theory-guide.cjs');

test('a tested claim needs a test reference', () => {
  const r = validateClaims([{ id: 'c1', claim: 'hash chain detects tampering', kind: 'tested' }]);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /must name its test/);
});
test('a theoretical claim needs a rationale and is counted separately', () => {
  const r = validateClaims([{ id: 'c2', claim: 'consciousness emerges from scale', kind: 'theoretical', rationale: 'no measurable definition exists yet' }]);
  assert.equal(r.ok, true);
  assert.equal(r.theoretical, 1);
  assert.equal(r.tested, 0);
});
test('duplicate ids and short claims are rejected', () => {
  const r = validateClaims([
    { id: 'd', claim: 'this claim is long enough', kind: 'theoretical', rationale: 'because it is not measurable' },
    { id: 'd', claim: 'short', kind: 'tested', test: 'x.test.js' },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /duplicate id d/.test(e)));
  assert.ok(r.errors.some((e) => /too short/.test(e)));
});
test('assertNoUnbackedClaims throws on an unlabelled unbacked claim', () => {
  assert.throws(() => assertNoUnbackedClaims([{ id: 'x', claim: 'a very strong claim indeed', kind: 'imaginary' }]), /invalid claims/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { KNOWN_CHECK_NAMES, isKnownCheckName, resolveRequiredChecks, validateCheckNames, REQUIRED_CHECKS_ENV } = require('../../../scripts/readiness-check-registry');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const checks = KNOWN_CHECK_NAMES.map((name) => ({ name, status: 'PASS' }));

test('P1.4-01 accepted check names are an explicit enumerated set', () => {
  assert.equal(KNOWN_CHECK_NAMES.length > 0, true);
  assert.equal(KNOWN_CHECK_NAMES.length, new Set(KNOWN_CHECK_NAMES).size);
  for (const name of KNOWN_CHECK_NAMES) assert.equal(isKnownCheckName(name), true);
});

test('P1.4-02 an unknown name is rejected and never becomes a pass or a silent skip', () => {
  assert.equal(isKnownCheckName('totallyMadeUpCheck'), false);
  const r = validateCheckNames([...checks, { name: 'totallyMadeUpCheck', status: 'PASS' }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ['totallyMadeUpCheck']);
});

test('P1.4-03 case differences and surrounding whitespace are not accepted as known names', () => {
  assert.equal(isKnownCheckName('tlsIngress'), true);
  assert.equal(isKnownCheckName('tlsingress'), false);
  assert.equal(isKnownCheckName('TLSINGRESS'), false);
  assert.equal(isKnownCheckName(' tlsIngress '), true);
  assert.equal(isKnownCheckName('  '), false);
  assert.equal(isKnownCheckName(''), false);
  assert.equal(isKnownCheckName(null), false);
  const r = validateCheckNames(checks.map((c) => (c.name === 'tlsIngress' ? { name: 'TLSINGRESS', status: 'PASS' } : c)));
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ['TLSINGRESS']);
  assert.deepEqual(r.missing, ['tlsIngress']);
});

test('P1.4-04 empty and unknown entries in the operator list fail closed', () => {
  const unknown = resolveRequiredChecks({ [REQUIRED_CHECKS_ENV]: 'tlsIngress,NotACheck' });
  assert.equal(unknown.ok, false);
  assert.deepEqual(unknown.unknown, ['NotACheck']);
  assert.equal(unknown.error, 'READINESS_REQUIRED_CHECK_UNKNOWN');
  const empty = resolveRequiredChecks({ [REQUIRED_CHECKS_ENV]: 'tlsIngress,,backupRestore' });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'READINESS_REQUIRED_CHECK_EMPTY');
  const ok = resolveRequiredChecks({ [REQUIRED_CHECKS_ENV]: 'tlsIngress' });
  assert.equal(ok.ok, true);
  assert.equal(ok.required.includes('tlsIngress'), true);
});

test('P1.4-05 a missing required check fails closed (no silent success)', () => {
  const withoutTls = checks.filter((c) => c.name !== 'tlsIngress');
  const r = validateCheckNames(withoutTls);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['tlsIngress']);
});

test('P1.4-06 duplicated check names are rejected', () => {
  const r = validateCheckNames([...checks, { name: 'node', status: 'PASS' }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.duplicates, ['node']);
});

test('P1.4-07 a complete supported set passes', () => {
  const r = validateCheckNames(checks);
  assert.equal(r.ok, true);
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.duplicates, []);
});

test('P1.4-08 the gate emits only registered names and wires the policy check', () => {
  const gate = fs.readFileSync(path.join(ROOT, 'scripts', 'production-readiness-gate.js'), 'utf8');
  assert.match(gate, /isKnownCheckName\(name\)/);
  assert.match(gate, /READINESS_CHECK_NAME_UNKNOWN/);
  assert.match(gate, /result\('checkNamePolicy'/);
  assert.match(gate, /validateCheckNames\(checks/);
  // Every literal name handed to result()/proof() must be registered.
  const literals = [...gate.matchAll(/(?:result|proof)\('([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]);
  const unregistered = [...new Set(literals.filter((n) => !isKnownCheckName(n)))];
  assert.deepEqual(unregistered, [], `gate emits unregistered check names: ${unregistered.join(', ')}`);
});

test('P1.4-09 the gate does not require its policy result before appending it', () => {
  const gate = fs.readFileSync(path.join(ROOT, 'scripts', 'production-readiness-gate.js'), 'utf8');
  assert.match(gate, /required\.filter\(\(name\) => name !== 'checkNamePolicy'\)/);
});

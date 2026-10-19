'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAsBuiltDeviation, summarizeDeviations } = require('../src/asBuiltDeviation');
const {
  composeHierarchicalLabel,
  parseHierarchicalLabel,
  assertFireClass,
  FIRE_CLASS_OPTIONS
} = require('../src/hierarchicalLabeling');

test('as-built matched values report matched true', () => {
  const d = buildAsBuiltDeviation({
    designRef: 'DESIGN-ROUTE-1',
    asBuiltRef: 'ASBUILT-ROUTE-1',
    kind: 'LENGTH_M',
    designValue: 1200,
    asBuiltValue: 1200
  });
  assert.equal(d.matched, true);
});

test('as-built length mismatch is unmatched major optional', () => {
  const d = buildAsBuiltDeviation({
    designRef: 'D-1',
    asBuiltRef: 'A-1',
    kind: 'LENGTH_M',
    designValue: 1000,
    asBuiltValue: 1150,
    severity: 'MAJOR',
    affectsService: true
  });
  assert.equal(d.matched, false);
  const s = summarizeDeviations([d]);
  assert.equal(s.status, 'AS_BUILT_SERVICE_RISK');
});

test('rejects unknown deviation kind', () => {
  assert.throws(() => buildAsBuiltDeviation({
    designRef: 'D', asBuiltRef: 'A', kind: 'NOT_A_KIND'
  }), /AS_BUILT_DEVIATION_KIND_UNKNOWN/);
});

test('hierarchical label region→port left-to-right', () => {
  const label = composeHierarchicalLabel({
    parts: {
      REGION: 'CAI',
      AREA: 'NASR',
      BUILDING: 'B12',
      RACK: 'R01',
      PANEL: 'P03',
      PORT: '12'
    }
  });
  assert.equal(label.code, 'CAI-NASR-B12-R01-P03-12');
  assert.equal(label.readingDirection, 'LEFT_TO_RIGHT');
  const parsed = parseHierarchicalLabel(label.code);
  assert.equal(parsed.parts.PORT, '12');
});

test('fire class CPR_B2ca accepted; invented class rejected', () => {
  assert.equal(assertFireClass('CPR_B2ca'), 'CPR_B2ca');
  assert.ok(FIRE_CLASS_OPTIONS.includes('LSZH'));
  assert.throws(() => assertFireClass('FLAME_WARS'), /FIRE_CLASS_UNKNOWN/);
});

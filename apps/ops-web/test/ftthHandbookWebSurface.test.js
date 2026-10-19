'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('enterprise command exposes the handbook-derived FTTH engineering assurance boundary', () => {
  const html = read('public/enterprise-command.html');

  assert.match(html, /id="ftthEngineeringTitle"/);
  for (const label of [
    'Build → Accept',
    'Optical Evidence',
    'ODN Digital Twin',
    'Missing High-Value Controls',
    'Design Profiles',
    'Operations &amp; Maintenance'
  ]) {
    assert.ok(html.includes(label), 'missing FTTH assurance block: ' + label);
  }

  for (const stage of [
    'Survey', 'Design', 'Permit', 'Material', 'Civil', 'Duct', 'Cable',
    'Splicing', 'Testing', 'QC', 'Acceptance', 'Drop', 'Activation'
  ]) {
    assert.ok(html.includes(stage), 'missing lifecycle stage: ' + stage);
  }

  assert.match(html, /instrument calibration provenance is not yet a first-class persisted entity/);
  assert.match(html, /identified additions, not claimed implementations/);
  assert.match(html, /legacy numeric limits must not become universal 2026 constants/);
});

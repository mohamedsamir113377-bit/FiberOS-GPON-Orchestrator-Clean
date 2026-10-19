'use strict';

/*
  Closes the environment gap found during the audit: the suite was previously
  only runnable by passing --engine-strict=false on a Node older than the one
  the project declares. This guard makes the declared runtime, the pinned
  runtime file, and the actually running runtime agree.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function parseVersion(value) {
  const m = String(value).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function atLeast(actual, minimum) {
  for (let i = 0; i < 3; i += 1) {
    if (actual[i] > minimum[i]) return true;
    if (actual[i] < minimum[i]) return false;
  }
  return true;
}

test('the declared engine floor and the pinned runtime file agree', () => {
  const pkg = JSON.parse(read('package.json'));
  const declared = pkg.engines && pkg.engines.node;
  assert.ok(declared, 'package.json must declare engines.node');
  const floor = parseVersion(String(declared).replace(/[^\d.]/g, ''));
  assert.ok(floor, 'engines.node must be a parseable version: ' + declared);

  const pinned = read('.nvmrc');
  const pinnedVersion = parseVersion(pinned);
  assert.ok(pinnedVersion, '.nvmrc must pin a concrete version');
  assert.ok(
    atLeast(pinnedVersion, floor),
    '.nvmrc pins ' + pinnedVersion.join('.') + ' which is below the declared floor ' + floor.join('.')
  );
});

test('every CI workflow installs the pinned runtime through .nvmrc', () => {
  const dir = path.join(ROOT, '.github', 'workflows');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  assert.ok(files.length > 0, 'no workflows found');
  for (const file of files) {
    const yml = fs.readFileSync(path.join(dir, file), 'utf8');
    if (!yml.includes('actions/setup-node')) continue;
    assert.match(yml, /node-version-file:\s*\.nvmrc/, file + ' must install the pinned runtime via .nvmrc');
  }
});

test('engine-strict is enforced so a mismatched runtime fails the install', () => {
  const npmrc = read('.npmrc');
  assert.match(npmrc, /engine-strict\s*=\s*true/, '.npmrc must set engine-strict=true');
});

test('the running runtime satisfies the declared floor', () => {
  const pkg = JSON.parse(read('package.json'));
  const floor = parseVersion(String(pkg.engines.node).replace(/[^\d.]/g, ''));
  const running = parseVersion(process.version);
  assert.ok(running, 'unreadable process.version: ' + process.version);
  assert.ok(
    atLeast(running, floor),
    'running Node ' + running.join('.') + ' is below the declared floor ' + floor.join('.')
  );
});

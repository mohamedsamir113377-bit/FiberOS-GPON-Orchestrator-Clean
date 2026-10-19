#!/usr/bin/env node
'use strict';

/**
 * Static domain-neutrality check for multi-buyer mode.
 * Run: node scripts/verify-domain-neutrality.js
 * Exit 0 if clean (or sector mode); non-zero on violations when multi-buyer.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const gate = require(path.join(ROOT, 'packages/assurance/src/domain-neutrality-gate.js'));

const mode = process.env.FIBEROS_DOMAIN_MODE || 'multi-buyer';

const SURFACES = [
  path.join(ROOT, 'BUYER_QUICKSTART.md'),
  path.join(ROOT, 'docs/commercial/SALES_RELEASE_NOTES.md'),
  path.join(ROOT, 'docs/REQUIRED_ADDITIONS_STATEMENT.md'),
  path.join(ROOT, 'docs/2026_HIGH_VALUE_EXTENSIONS.md'),
  path.join(ROOT, 'docs/ENTERPRISE_HARDENING_INVENTORY_v0.11.53.md'),
];

let failed = false;
const reports = [];

for (const file of SURFACES) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const isMetaDoc = /REQUIRED_ADDITIONS|2026_HIGH_VALUE|ENTERPRISE_HARDENING|domain-neutrality|EXECUTION_LOG/.test(path.basename(file));
  if (isMetaDoc) continue;

  const result = gate.check(text, { mode });
  if (!result.ok) {
    failed = true;
    reports.push({ file: path.relative(ROOT, file), ...result });
  }
}

if (!gate.isDomainNeutralMode(mode)) {
  console.log(`Domain-neutrality gate inactive (mode=${mode}). Sector profile allowed.`);
  process.exit(0);
}

if (failed) {
  console.error('Domain-neutrality violations detected in multi-buyer mode:');
  for (const r of reports) {
    console.error(`  ${r.file}: ${r.message}`);
  }
  process.exit(1);
}

console.log(`Domain-neutrality gate passed (mode=${mode}).`);
process.exit(0);

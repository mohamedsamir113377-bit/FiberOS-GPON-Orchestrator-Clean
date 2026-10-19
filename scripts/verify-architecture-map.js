#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'ARCHITECTURE_MAP.json');
const map = JSON.parse(fs.readFileSync(file, 'utf8'));
const failures = [];
if (map.schema !== 'fiberos.r14.1.architecture-map.v1') failures.push('schema mismatch');
if (!Array.isArray(map.packages) || map.packages.length === 0) failures.push('package inventory missing');
if (!map.edges || typeof map.edges !== 'object') failures.push('edges object missing');
const nonEmpty = Object.values(map.edges || {}).filter((edges) => Array.isArray(edges) && edges.length > 0).length;
if (nonEmpty === 0) failures.push('all architecture edges are empty');
if (!Array.isArray(map.edges.engineering) || !map.edges.engineering.includes('compute-kernel')) failures.push('engineering→compute-kernel edge missing');
for (const [owner, edges] of Object.entries(map.edges || {})) {
  for (const target of edges) if (!map.packages.includes(target)) failures.push(`edge target not in package inventory: ${owner}→${target}`);
}
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, nonEmptyEdgeOwners: nonEmpty }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, packages: map.packages.length, nonEmptyEdgeOwners: nonEmpty }, null, 2));
}

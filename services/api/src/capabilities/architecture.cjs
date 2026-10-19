'use strict';
const fs = require('fs');
const path = require('path');

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function listDirs(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'node_modules')
      .map((d) => d.name).sort();
  } catch { return []; }
}
function buildArchitectureMap(root) {
  if (typeof root !== 'string' || root.trim() === '') throw new TypeError('root must be a non-empty string');
  const components = [];
  for (const name of listDirs(path.join(root, 'packages'))) {
    components.push({ name, kind: 'package', hasManifest: readJsonSafe(path.join(root, 'packages', name, 'package.json')) !== null });
  }
  for (const name of listDirs(path.join(root, 'services'))) {
    components.push({ name, kind: 'service', hasManifest: readJsonSafe(path.join(root, 'services', name, 'package.json')) !== null });
  }
  for (const name of listDirs(path.join(root, 'apps'))) {
    components.push({ name, kind: 'app', hasManifest: readJsonSafe(path.join(root, 'apps', name, 'package.json')) !== null });
  }
  let migrations = [];
  try {
    migrations = fs.readdirSync(path.join(root, 'sql', 'migrations'))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  } catch { migrations = []; }
  return {
    components,
    counts: {
      packages: components.filter((x) => x.kind === 'package').length,
      services: components.filter((x) => x.kind === 'service').length,
      apps: components.filter((x) => x.kind === 'app').length,
    },
    migrationCount: migrations.length,
    firstMigration: migrations[0] || null,
    lastMigration: migrations[migrations.length - 1] || null,
  };
}
// Acceptance rule for this capability: every component named in the map must exist on disk.
function auditAgainstRepository(root, map) {
  if (!map || !Array.isArray(map.components)) throw new TypeError('map.components must be an array');
  const base = { package: 'packages', service: 'services', app: 'apps' };
  const errors = [];
  for (const c of map.components) {
    if (!base[c.kind]) { errors.push('unknown-kind:' + c.kind); continue; }
    if (!fs.existsSync(path.join(root, base[c.kind], c.name))) errors.push('absent:' + c.kind + ':' + c.name);
  }
  return { ok: errors.length === 0, checked: map.components.length, errors };
}
module.exports = { buildArchitectureMap, auditAgainstRepository };

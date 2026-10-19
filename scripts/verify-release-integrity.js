#!/usr/bin/env node
'use strict';

/**
 * Pre-install release integrity gate.
 *
 * This script intentionally uses Node core modules only so it can run before
 * npm ci. It catches:
 *   - workspace package/version drift that would make npm ci resolve @fiberos/*
 *     from the public registry instead of the local workspace;
 *   - package/manifest/runtime-version drift;
 *   - migration inventory/list/hash drift;
 *   - invalid RLS inventory metadata;
 *   - production identity contract drift away from RS256/JWKS fail-closed mode.
 *
 * This is a static integrity gate. It does not claim live PostgreSQL, IdP,
 * Redis, object-storage, routing, NMS, messaging, or deployment verification.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch (error) {
    failures.push('cannot read/parse ' + rel + ': ' + (error && error.message ? error.message : String(error)));
    return null;
  }
}

function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (error) {
    failures.push('cannot read ' + rel + ': ' + (error && error.message ? error.message : String(error)));
    return '';
  }
}

function sha256File(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
}

function workspacePaths(workspaces) {
  const out = [];
  for (const pattern of Array.isArray(workspaces) ? workspaces : []) {
    const normalized = String(pattern).replace(/\\/g, '/');
    if (normalized.endsWith('/*')) {
      const parent = path.join(ROOT, normalized.slice(0, -2));
      if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
        failures.push('workspace parent missing: ' + normalized);
        continue;
      }
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const rel = path.relative(ROOT, path.join(parent, entry.name)).split(path.sep).join('/');
        if (fs.existsSync(path.join(ROOT, rel, 'package.json'))) out.push(rel);
      }
    } else if (fs.existsSync(path.join(ROOT, normalized, 'package.json'))) {
      out.push(normalized);
    } else {
      failures.push('workspace package.json missing: ' + normalized);
    }
  }
  return Array.from(new Set(out)).sort();
}

function checkWorkspaceParity(rootPkg, lockPkg) {
  const paths = workspacePaths(rootPkg && rootPkg.workspaces);
  const packages = new Map();

  for (const rel of paths) {
    const pkg = readJson(rel + '/package.json');
    if (!pkg || !pkg.name || !pkg.version) {
      failures.push('workspace package missing name/version: ' + rel);
      continue;
    }
    if (packages.has(pkg.name)) failures.push('duplicate workspace package name: ' + pkg.name);
    packages.set(pkg.name, { rel, version: String(pkg.version) });

    const lockEntry = lockPkg && lockPkg.packages && lockPkg.packages[rel];
    if (!lockEntry) {
      failures.push('package-lock workspace entry missing: ' + rel);
    } else if (lockEntry.name && String(lockEntry.name) !== String(pkg.name)) {
      failures.push('package-lock workspace name drift: ' + rel + ' (package=' + pkg.name + ', lock=' + lockEntry.name + ')');
    }
    const nodeModulesEntry = lockPkg && lockPkg.packages && lockPkg.packages['node_modules/' + pkg.name];
    if (!nodeModulesEntry || nodeModulesEntry.link !== true || String(nodeModulesEntry.resolved || '') !== rel) {
      failures.push('package-lock workspace link drift: ' + pkg.name + ' (expected link to ' + rel + ')');
    }
  }

  for (const { rel } of packages.values()) {
    const pkg = readJson(rel + '/package.json');
    if (!pkg) continue;
    for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
      const deps = pkg[field] && typeof pkg[field] === 'object' ? pkg[field] : {};
      for (const [depName, spec] of Object.entries(deps)) {
        const target = packages.get(depName);
        if (!target) continue;
        if (String(spec) !== target.version) {
          failures.push(
            'workspace dependency drift: ' + rel + ' -> ' + depName +
            ' (declared=' + spec + ', workspace=' + target.version + ')'
          );
        }
      }
    }
  }

  return packages;
}

function checkRlsInventoryCompleteness(rlsInventory) {
  const dir = path.join(ROOT, 'sql', 'migrations');
  const inventory = new Set((rlsInventory && Array.isArray(rlsInventory.tables) ? rlsInventory.tables : [])
    .map(x => x && x.table)
    .filter(Boolean));
  const created = new Set();
  const stripComments = text => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '');

  for (const file of fs.readdirSync(dir).filter(name => /^\d{3}_.+\.sql$/.test(name) && name !== '000_local_auth_stubs.sql').sort()) {
    const sql = stripComments(readText('sql/migrations/' + file));
    for (const match of sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\b/gi)) {
      created.add(match[1]);
    }
  }

  const missing = [...created].filter(name => !inventory.has(name)).sort();
  if (missing.length) failures.push('RLS inventory missing tables created by production migrations: ' + missing.join(', '));
}

function checkMigrations(manifest, rlsInventory) {
  const dir = path.join(ROOT, 'sql', 'migrations');
  if (!fs.existsSync(dir)) {
    failures.push('sql/migrations directory missing');
    return;
  }

  const files = fs.readdirSync(dir)
    .filter(name => /^\d{3}_.+\.sql$/.test(name))
    .filter(name => name !== '000_local_auth_stubs.sql')
    .sort();

  const numbers = files.map(name => Number(name.slice(0, 3)));
  const expectedSequence = files.map((_, i) => i + 1);
  if (numbers.some((n, i) => n !== expectedSequence[i])) {
    failures.push('production migration numbering is not contiguous from 001');
  }

  const highest = numbers.length ? String(numbers[numbers.length - 1]).padStart(3, '0') : '000';
  const expectedRange = '001-' + highest;

  if (manifest && manifest.databaseMigrations !== expectedRange) {
    failures.push('SALES_PACKAGE_MANIFEST.json databaseMigrations drift: manifest=' + manifest.databaseMigrations + ' actual=' + expectedRange);
  }

  const inventoryCount = rlsInventory && rlsInventory.source && rlsInventory.source.migrationCount;
  if (Number(inventoryCount) !== files.length) {
    failures.push('RLS inventory source.migrationCount drift: inventory=' + inventoryCount + ' actual=' + files.length);
  }
  if (Number(rlsInventory && rlsInventory.migrationCount) !== files.length) {
    failures.push('RLS inventory migrationCount drift: inventory=' + (rlsInventory && rlsInventory.migrationCount) + ' actual=' + files.length);
  }

  const tableList = Array.isArray(rlsInventory && rlsInventory.tables) ? rlsInventory.tables : [];
  const tableNames = tableList.map(x => x && x.table);
  if (new Set(tableNames).size !== tableNames.length) failures.push('RLS inventory contains duplicate table names');
  if (tableNames.some(name => typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(name))) {
    failures.push('RLS inventory contains invalid table names');
  }
  if (!rlsInventory || rlsInventory.tableCount !== tableNames.length) {
    failures.push('RLS inventory tableCount mismatch');
  }

  const productionList = readText('sql/migrations/PRODUCTION_MIGRATIONS.txt')
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);

  if (JSON.stringify(productionList) !== JSON.stringify(files)) {
    failures.push('PRODUCTION_MIGRATIONS.txt does not exactly match sql/migrations/*.sql');
  }

  const legacyHashLines = readText('sql/migrations/PRODUCTION_MIGRATIONS.sha256')
    .split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const extraHashPath = path.join(ROOT, 'sql/migrations/PRODUCTION_MIGRATIONS.extra.sha256');
  const extraHashLines = fs.existsSync(extraHashPath)
    ? fs.readFileSync(extraHashPath, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean)
    : [];

  const actualMigrationFiles = files.map((name, index) => ({ name, index, number: Number(name.slice(0,3)) }));
  const legacyFiles = actualMigrationFiles.filter(x => x.number <= 116).map(x => x.name);
  const extensionFiles = actualMigrationFiles.filter(x => x.number >= 117).map(x => x.name);
  if (legacyHashLines.length !== legacyFiles.length) {
    failures.push('PRODUCTION_MIGRATIONS.sha256 legacy line count mismatch: listed=' + legacyHashLines.length + ' actual=' + legacyFiles.length);
  }
  if (extensionFiles.length > 0 && extraHashLines.length !== extensionFiles.length) {
    failures.push('PRODUCTION_MIGRATIONS.extra.sha256 line count mismatch: listed=' + extraHashLines.length + ' actual=' + extensionFiles.length);
  }

  const parseHashLines = (lines, label) => {
    const listed = new Map();
    for (const line of lines) {
      const m = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
      if (!m) { failures.push('invalid ' + label + ' line: ' + line); continue; }
      listed.set(m[2], m[1].toLowerCase());
    }
    return listed;
  };
  const legacyListed = parseHashLines(legacyHashLines, 'PRODUCTION_MIGRATIONS.sha256');
  const extraListed = parseHashLines(extraHashLines, 'PRODUCTION_MIGRATIONS.extra.sha256');
  for (const rel of legacyFiles) {
    const actual = sha256File('sql/migrations/' + rel);
    const expected = legacyListed.get(rel);
    if (expected !== actual) failures.push('migration SHA-256 mismatch: ' + rel + ' (legacy listed=' + (expected || 'missing') + ' actual=' + actual + ')');
  }
  for (const rel of extensionFiles) {
    const actual = sha256File('sql/migrations/' + rel);
    const expected = extraListed.get(rel);
    if (expected !== actual) failures.push('migration SHA-256 mismatch: ' + rel + ' (extension listed=' + (expected || 'missing') + ' actual=' + actual + ')');
  }
}

function main() {
  const rootPkg = readJson('package.json');
  const lockPkg = readJson('package-lock.json');
  const manifest = readJson('SALES_PACKAGE_MANIFEST.json');
  const rlsInventory = readJson('config/rls-tenant-sensitive-inventory.json');
  const identityContract = readJson('config/identity-production-contract.v1.json');
  const runtimeContract = readJson('config/runtime-environment-contract.v1.json');

  if (rootPkg && manifest && rootPkg.version !== manifest.packageVersion) {
    failures.push('package version drift: package.json=' + rootPkg.version + ' manifest=' + manifest.packageVersion);
  }

  const nvmrc = readText('.nvmrc').trim();
  const engine = rootPkg && rootPkg.engines && rootPkg.engines.node ? String(rootPkg.engines.node).trim() : '';
  const engineMatch = engine.match(/^>=([0-9]+\.[0-9]+\.[0-9]+)$/);
  if (!engineMatch) {
    failures.push('package.json engines.node must be an exact >=x.y.z lower bound');
  } else if (nvmrc !== engineMatch[1]) {
    failures.push('.nvmrc drift: nvmrc=' + nvmrc + ' engines=' + engineMatch[1]);
  }

  if (lockPkg && rootPkg && lockPkg.version !== rootPkg.version) {
    failures.push('package-lock root version drift: lock=' + lockPkg.version + ' package=' + rootPkg.version);
  }

  if (identityContract) {
    if (identityContract.production && identityContract.production.jwtAlgorithm !== 'RS256') {
      failures.push('production identity contract must require RS256');
    }
    if (identityContract.production && (!identityContract.production.jwks || identityContract.production.jwks.required !== true)) {
      failures.push('production identity contract must require JWKS');
    }
    if (identityContract.production && identityContract.production.hmac && identityContract.production.hmac.allowed !== false) {
      failures.push('production identity contract must forbid HMAC JWT verification');
    }
  }

  if (runtimeContract && runtimeContract.node && runtimeContract.node.required !== engine) {
    failures.push('runtime environment contract node requirement drift: contract=' + runtimeContract.node.required + ' package=' + engine);
  }

  checkWorkspaceParity(rootPkg || {}, lockPkg || {});
  checkMigrations(manifest || {}, rlsInventory || {});
  checkRlsInventoryCompleteness(rlsInventory || {});

  if (failures.length) {
    console.error('Release integrity gate FAILED:');
    for (const failure of failures) console.error('  - ' + failure);
    process.exitCode = 1;
    return;
  }

  console.log('Release integrity gate passed: workspace graph, migration inventory/list/hashes, version contracts, and production identity contract are consistent.');
}

main();

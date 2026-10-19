#!/usr/bin/env node
'use strict';

// Fail-closed Node engine contract gate.
//
// The repository pins exactly one Node toolchain: .nvmrc (24.21.0), the root
// engines declaration, the CI workflows (node-version-file: .nvmrc) and the
// runtime container image. Every workspace package.json must declare the same
// engine range so no subpackage can ever be installed on an unsupported Node
// version. This gate exists because the 2026-10 consolidation introduced 10
// subpackages without any engines field; CI must reject that class of drift
// forever.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKSPACE_ROOTS = ['packages', 'services', 'apps'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const nvmrc = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(nvmrc)) {
    console.error(JSON.stringify({ ok: false, code: 'NVMRC_INVALID', nvmrc }));
    return 1;
  }
  const expected = `>=${nvmrc}`;

  const violations = [];
  const rootPkg = readJson(path.join(ROOT, 'package.json'));
  if (!rootPkg.engines || rootPkg.engines.node !== expected) {
    violations.push({
      file: 'package.json',
      code: 'ROOT_ENGINES_MISSING_OR_MISMATCH',
      actual: (rootPkg.engines && rootPkg.engines.node) || null,
    });
  }

  let checked = 0;
  for (const base of WORKSPACE_ROOTS) {
    const baseDir = path.join(ROOT, base);
    if (!fs.existsSync(baseDir)) continue;
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const file = path.join(base, entry.name, 'package.json');
      const abs = path.join(ROOT, file);
      if (!fs.existsSync(abs)) continue;
      checked += 1;
      const pkg = readJson(abs);
      const declared = pkg.engines && pkg.engines.node;
      if (declared !== expected) {
        violations.push({ file, code: declared ? 'ENGINES_MISMATCH' : 'ENGINES_MISSING', actual: declared || null });
      }
    }
  }

  const dockerfile = path.join(ROOT, 'docker', 'Dockerfile.runtime');
  const dockerText = fs.readFileSync(dockerfile, 'utf8');
  const imageLine = dockerText.split('\n').find((line) => line.startsWith('FROM node:'));
  if (!imageLine || !imageLine.includes(`node:${nvmrc}`)) {
    violations.push({ file: 'docker/Dockerfile.runtime', code: 'DOCKER_NODE_IMAGE_MISMATCH', actual: imageLine || null });
  }

  if (violations.length) {
    console.error(JSON.stringify({
      ok: false,
      code: 'NODE_ENGINE_CONTRACT_VIOLATION',
      expected,
      workspacePackagesChecked: checked,
      violations,
    }, null, 2));
    return 1;
  }
  console.log(JSON.stringify({
    ok: true,
    gate: 'NODE_ENGINE_CONTRACT',
    expected,
    workspacePackagesChecked: checked,
    dockerfilePinned: true,
  }));
  return 0;
}

process.exitCode = main();

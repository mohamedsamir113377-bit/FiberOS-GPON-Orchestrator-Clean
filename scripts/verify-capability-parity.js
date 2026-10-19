#!/usr/bin/env node
'use strict';
/**
 * H-1 fix: config/html-feature-parity.json is supposed to be the source of
 * truth that packages/assurance/src/capabilityGate.js uses to return 501 for
 * capabilities that are UNIMPLEMENTED/VISION.
 *
 * This verifier proves that buyer-facing capability claims still correspond
 * to the actual API route surface. It is intentionally fail-closed: a route
 * pattern that cannot be parsed is an audit error, never something to skip.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_SRC = path.join(ROOT, 'services/api/src');
const REGISTRY_PATH = path.join(ROOT, 'config/html-feature-parity.json');

const NON_OPERATIONAL = new Set(['UNIMPLEMENTED', 'VISION']);
const OPERATIONAL = new Set(['REAL', 'ADVISORY', 'INTEGRATION_REQUIRED']);

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function extractRoutes(files) {
  const exact = new Set();
  const prefixes = [];
  const dynamic = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');

    for (const m of text.matchAll(/method\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'[^\n]{0,80}?path\s*===\s*'([^']+)'/g)) {
      exact.add(`${m[1]} ${m[2]}`);
    }
    // Server capability inventories also use the compact "GET /v1/..."
    // notation. It is an executable route inventory, not merely prose.
    for (const m of text.matchAll(/['"](GET|POST|PUT|PATCH|DELETE)\s+(\/v1\/[^'"]+)['"]/g)) {
      exact.add(`${m[1]} ${m[2]}`);
    }
    // Route-table dispatch: management surfaces use entries such as
    // ['/v1/company/operating-system', ROLES.management, handler].
    // Treat only the first path literal of this explicit table shape as a
    // routable surface; do not count arbitrary endpoint strings in metadata.
    for (const m of text.matchAll(/^\s*\[\s*['"]([^'"]+)['"]\s*,/gm)) {
      if (m[1].startsWith('/v1/')) exact.add(`ANY ${m[1]}`);
    }

    for (const m of text.matchAll(/(?<!method\s*===\s*'[A-Z]+'[^\n]{0,80}?)path\s*===\s*'([^']+)'/g)) {
      exact.add(`ANY ${m[1]}`);
    }
    for (const m of text.matchAll(/method\s*===\s*'(GET|POST|PUT|PATCH|DELETE)'[^\n]{0,80}?path\.startsWith\('([^']+)'\)/g)) {
      prefixes.push({ method: m[1], prefix: m[2] });
    }
    for (const m of text.matchAll(/path\.startsWith\('([^']+)'\)/g)) {
      prefixes.push({ method: 'ANY', prefix: m[1] });
    }
    for (const m of text.matchAll(/path\.match\(\/\^([^$]+?)\$\/\)/g)) {
      let src = '^' + m[1] + '$';
      src = src.replace(/\\\//g, '/');
      try {
        dynamic.push({ method: 'ANY', re: new RegExp(src) });
      } catch (e) {
        throw new Error(`Unparsable dynamic route regex in ${file}: ${e.message}`);
      }
    }
  }
  return { exact, prefixes, dynamic };
}

function routeExists(routes, method, surfacePath) {
  if (routes.exact.has(`${method} ${surfacePath}`) || routes.exact.has(`ANY ${surfacePath}`)) return true;
  for (const p of routes.prefixes) {
    if ((p.method === method || p.method === 'ANY') && surfacePath.startsWith(p.prefix)) return true;
  }
  const asRegexProbe = surfacePath.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000000');
  for (const d of routes.dynamic) {
    if (d.re.test(asRegexProbe)) return true;
  }
  return false;
}

function main() {
  const files = listJsFiles(API_SRC);
  const routes = extractRoutes(files);
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const falseRealClaims = [];
  const falseUnimplementedClaims = [];
  const malformedSurfaceClaims = [];

  for (const cap of registry.capabilities || []) {
    for (const surface of cap.serverSurfaces || []) {
      if (typeof surface !== 'string') {
        malformedSurfaceClaims.push({ id: cap.id, status: cap.status, surface });
        continue;
      }
      const m = surface.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)$/i);
      if (!m) {
        malformedSurfaceClaims.push({ id: cap.id, status: cap.status, surface });
        continue;
      }
      const [, method, surfacePath] = m;
      const exists = routeExists(routes, method.toUpperCase(), surfacePath);
      if (OPERATIONAL.has(cap.status) && !exists) falseRealClaims.push({ id: cap.id, status: cap.status, surface });
      if (NON_OPERATIONAL.has(cap.status) && exists) falseUnimplementedClaims.push({ id: cap.id, status: cap.status, surface });
    }
  }

  const total = (registry.capabilities || []).length;
  const withSurfaces = (registry.capabilities || []).filter(c => (c.serverSurfaces || []).length).length;
  console.log(`Capability parity check: ${total} capabilities, ${withSurfaces} declare a serverSurface.`);

  let failed = false;
  if (falseRealClaims.length) {
    failed = true;
    console.error('\nFAIL — operational capability has no matching route:');
    for (const f of falseRealClaims) console.error(`  ${f.id} (${f.status}): ${f.surface}`);
  }
  if (falseUnimplementedClaims.length) {
    failed = true;
    console.error('\nFAIL — non-operational capability declares a live route:');
    for (const f of falseUnimplementedClaims) console.error(`  ${f.id} (${f.status}): ${f.surface}`);
  }
  if (malformedSurfaceClaims.length) {
    failed = true;
    console.error('\nFAIL — capability contains a malformed/unparseable serverSurface declaration:');
    for (const f of malformedSurfaceClaims) console.error(`  ${f.id} (${f.status}): ${JSON.stringify(f.surface)}`);
  }
  if (failed) process.exitCode = 1;
  else console.log('OK — capability status and declared server surfaces are consistent.');
}

if (require.main === module) main();

module.exports = { listJsFiles, extractRoutes, routeExists };

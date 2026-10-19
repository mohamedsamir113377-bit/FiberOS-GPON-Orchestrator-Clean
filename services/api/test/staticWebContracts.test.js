'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('static web apps ship the runtime i18n assets they reference', () => {
  for (const app of ['field-web', 'ops-web']) {
    const source = JSON.parse(read('apps/' + app + '/public/i18n/source.json'));
    const manifest = JSON.parse(read('apps/' + app + '/public/i18n/manifest.json'));
    const ar = JSON.parse(read('apps/' + app + '/public/i18n/catalogs/ar.json'));

    assert.equal(Object.keys(source.keys || {}).length, 101);
    assert.equal(manifest.keyCount, 101);
    assert.equal(manifest.locales.length, 114);
    assert.equal(ar.locale, 'ar');
    assert.equal(ar.status, 'verified');
    assert.equal(Object.keys(ar.translations || {}).length, 101);

    const runtime = read('apps/' + app + '/public/i18n-runtime.js');
    assert.match(runtime, /ROOT\s*=\s*['"]\/i18n\/['"]/);
  }
});

test('enterprise command uses the same OIDC cookie-session boundary as the operations console', () => {
  const source = read('apps/ops-web/public/enterprise-command.js');
  assert.match(source, /FiberOSSessionAuth\.getCsrfToken\(\)/);
  assert.match(source, /X-FiberOS-CSRF/);
  assert.match(source, /credentials:'include'/);
  assert.doesNotMatch(source, /Authorization|Bearer|getToken\(\)|sessionStorage/);
  assert.match(source, /localStorage\.getItem\(['"]fiberos_api['"]\)/);
  assert.match(source, /__FIBEROS_ALLOWED_API_ORIGINS__/);
  assert.match(source, /redirect:'error'/);
});

test('fleet refresh replaces, rather than duplicates, map markers', () => {
  const source = read('apps/ops-web/public/ops.js');
  assert.match(source, /async function loadMap\(\)/);
  assert.match(source, /Server-provided fleet GPS points/);
  assert.match(source, /Number\.isFinite\(t\.lat\)/);
  assert.doesNotMatch(source, /fleetLayer|L\.tileLayer|L\.marker/);
});

test('PostGIS CI service is immutable at container start', () => {
  const source = read('.github/workflows/runtime-postgres-rls.yml');
  const digest = 'sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677';
  assert.match(source, new RegExp('image: postgis/postgis@' + digest));
  assert.match(source, new RegExp('POSTGIS_IMAGE: postgis/postgis@' + digest));
  assert.doesNotMatch(source, /image:\s*postgis\/postgis:18-3\.6\b/);
});

test('optional field buyer demo CDN assets remain pinned and field OCR remains self-hosted with verified digests', () => {
  const file = 'apps/field-web/public/buyer-demo.html';
  if (fs.existsSync(path.join(ROOT, file))) {
    const source = read(file);
    assert.match(source, /leaflet\.css[^>]*integrity="sha256-p4NxAoJBhIIN\+hmNHrzRCf9tD\/miZyoHS5obTRR9BMY="/);
    assert.match(source, /leaflet\.js[^>]*integrity="sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo="/);
  } else {
    assert.match(read('SALES_PACKAGE_MANIFEST.json'), /buyer demo HTML is excluded from the source integrity manifest and packaged by a separate CI workflow/);
  }
  const fieldHtml = read('apps/field-web/public/index.html');
  const fieldJs = read('apps/field-web/public/field.js');
  assert.ok(
    /src=["']\/vendor\/tesseract-7\.0\.0\/tesseract\.min\.js["']/.test(fieldHtml) ||
      /vendor\/tesseract-7\.0\.0\/tesseract\.min\.js/.test(fieldJs),
    'field OCR must stay self-hosted via HTML script or field.js lazy loader'
  );
  assert.doesNotMatch(fieldHtml, /https?:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)\/npm\/tesseract/i);
  assert.doesNotMatch(fieldJs, /https?:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)\/npm\/tesseract/i);
  const vendorDir = path.join(ROOT, 'apps/field-web/public/vendor/tesseract-7.0.0');
  const upstream = fs.readFileSync(path.join(vendorDir, 'UPSTREAM.md'), 'utf8');
  assert.match(upstream, /tesseract\.js.*7\.0\.0/);
  assert.match(upstream, /tesseract\.js-core.*7\.0\.0/);
  assert.match(upstream, /@tesseract\.js-data\/eng.*1\.0\.0/);
  const sums = fs.readFileSync(path.join(vendorDir, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/);
  assert.equal(sums.length, 16);
  for (const line of sums) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    assert.ok(match, `invalid OCR asset digest line: ${line}`);
    const relative = match[2].replace(/^\.\//, '');
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(vendorDir, relative))).digest('hex');
    assert.equal(actual, match[1].toLowerCase(), `${relative} must match its pinned digest`);
  }
});

test('ops-web uses strict same-origin assets and never forwards session tokens to arbitrary API destinations', () => {
  for (const file of ['apps/ops-web/public/index.html', 'apps/ops-web/public/enterprise-command.html']) {
    const html = read(file);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /name="referrer" content="no-referrer"/);
    assert.match(html, /connect-src 'self'/);
    assert.doesNotMatch(html, /connect-src[^;]*\bhttps:/i);
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>|<style\b|\son[a-z]+\s*=|\sstyle\s*=/i);
    assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["']https?:/i);
    assert.doesNotMatch(html, /script-src[^;]*unsafe-inline|style-src[^;]*unsafe-inline/i);
  }
  const app = read('apps/ops-web/public/ops.js');
  const enterprise = read('apps/ops-web/public/enterprise-command.js');
  const policy = read('apps/ops-web/public/api-origin.js');
  const sessionAuth = read('apps/ops-web/public/session-auth.js');
  const opsContracts = read('apps/ops-web/public/ops-contracts.js');
  assert.match(sessionAuth, /\/auth\/oidc\/session/);
  assert.match(sessionAuth, /\/auth\/oidc\/login/);
  assert.match(sessionAuth, /\/auth\/oidc\/logout/);
  assert.match(sessionAuth, /X-FiberOS-CSRF/);
  assert.match(sessionAuth, /credentials:\s*'include'/);
  assert.doesNotMatch(sessionAuth, /sessionStorage|TOKEN_KEY|Authorization|Bearer|getToken/);
  for (const file of ['apps/ops-web/public/index.html', 'apps/ops-web/public/enterprise-command.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /sessionAccessToken|type="password"|data-session-action="save"/);
    assert.match(html, /data-session-action="login"/);
    assert.match(html, /data-session-action="logout"/);
    assert.match(html, /session-auth\.js/);
  }
  assert.match(opsContracts, /function crisisResponse/);
  assert.match(opsContracts, /function executiveResponse/);
  assert.match(app, /FiberOSSessionAuth\.getCsrfToken\(\)/);
  assert.doesNotMatch(app, /Authorization|Bearer|FiberOSSessionAuth\.getToken/);
  assert.match(app, /FiberOSOpsContracts\.crisisResponse/);
  assert.match(app, /FiberOSOpsContracts\.executiveResponse/);
  assert.doesNotMatch(app, /filtersر/);
  assert.match(policy, /API_ORIGIN_NOT_ALLOWED/);
  assert.match(policy, /API_PATH_INVALID/);
  for (const source of [app, enterprise]) {
    assert.match(source, /__FIBEROS_ALLOWED_API_ORIGINS__/);
    assert.match(source, /resolveApiUrl/);
    assert.match(source, /credentials:'include'/);
    assert.doesNotMatch(source, /credentials:'omit'/);
    assert.match(source, /redirect:'error'/);
  }
  assert.doesNotMatch(app, /https:\/\/unpkg\.com|Tesseract\.recognize|L\.tileLayer/);
  for (const file of ['apps/ops-web/public/_headers', 'deploy/nginx/ops-web-security-headers.conf']) {
    const headers = read(file);
    assert.match(headers, /Strict-Transport-Security/);
    assert.match(headers, /Content-Security-Policy/);
    assert.match(headers, /connect-src 'self'/);
    assert.doesNotMatch(headers, /connect-src[^;]*\bhttps:/i);
    assert.match(headers, /no-referrer/);
    assert.match(headers, /Permissions-Policy.*camera=\(self\).*geolocation=\(self\)/);
  }
});

test('release secret scanner assembles github_pat_ at runtime without self-matching source text', () => {
  const source = read('.github/workflows/release-security-gate.yml');
  assert.equal(source.includes('github_pat_'), false);
  assert.equal(source.includes(`github'"_pat_"'`), true);
});

test('deep operational command rooms expose real data-backed contracts', () => {
  const ops = read('services/api/src/routes/operations.js');
  assert.match(ops, /\/v1\/call-center\/metrics/);
  assert.match(ops, /\/v1\/call-center\/dispositions/);
  assert.match(ops, /\/v1\/command\/rooms\/overview/);
  assert.match(ops, /\/v1\/warehouses\/overview/);
  assert.match(ops, /\/v1\/warehouses\/transfers/);
  assert.match(ops, /\/v1\/warehouses\/reservations/);
  assert.match(ops, /DATABASE_BACKED_COMMAND_ROOMS/);
  assert.match(ops, /DATABASE_BACKED_WAREHOUSE_LOCATION_LEDGER/);
  assert.match(ops, /telephonyConfirmed:false/);
  const gis = read('packages/sovereign-gis/src/db.js');
  assert.match(gis, /technician_position/);
  assert.match(gis, /ticket_location/);
  const app = read('apps/ops-web/public/enterprise-command.js');
  assert.match(app, /\/v1\/command\/rooms\/overview/);
  assert.match(app, /\/v1\/gis\/fusion\/layers/);
  assert.match(app, /syntheticData/);
});

test('warehouse inventory movement model remains compatible with the material integrity contract', () => {
  const source = read('packages/enterprise-ftth/src/materialInventoryIntegrity.js');
  assert.match(source, /transfer_in/);
  assert.match(source, /transfer_out/);
});

test('static app i18n trees retain only the verified Arabic fallback catalog copy', () => {
  for (const app of ['field-web', 'ops-web']) {
    const directory = path.join(ROOT, 'apps', app, 'public', 'i18n', 'catalogs');
    const catalogs = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort();
    assert.deepEqual(catalogs, ['ar.json'], app + ' should not duplicate the canonical locale catalogs under public assets');
  }
});


test('commercial capability counts and production migration checklist match their canonical sources', () => {
  const catalog = JSON.parse(read('config/html-feature-parity.json'));
  const contract = JSON.parse(read('config/commercial-release-contract.v1.json'));
  // Canonical expectation: every status declared in statusDefinitions appears
  // exactly once, defaulting to 0 when no capability currently carries it.
  const defined = Object.keys(catalog.statusDefinitions || {});
  const counts = Object.fromEntries(defined.map((s) => [s, 0]));
  for (const capability of catalog.capabilities || []) {
    assert.ok(capability.status in counts, 'unknown capability status: ' + capability.status);
    counts[capability.status] = Number(counts[capability.status] || 0) + 1;
  }
  assert.equal(contract.featureRegistry.source, 'config/html-feature-parity.json');
  assert.equal(contract.featureRegistry.total, catalog.capabilities.length);
  assert.deepEqual(contract.featureRegistry.statusCounts, counts);
  const checklist = read('docs/runbooks/PRODUCTION_DEPLOYMENT_CHECKLIST.md');
  assert.ok(checklist.includes('history count = **196** and last = `196_narrow_app_technician_read_scope.sql`'));
  assert.ok(checklist.includes('applies **001-196**'));
});

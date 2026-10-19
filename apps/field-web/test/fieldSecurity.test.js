'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const policy = require('../public/field-security');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');

test('same-origin API remains the default and is the only default bearer-token destination', () => {
  assert.equal(policy.normalizeApiBase('', 'https://field.example/index.html', []), 'https://field.example');
  assert.equal(
    policy.resolveApiUrl('', '/v1/evidence/submit', 'https://field.example/index.html', []),
    'https://field.example/v1/evidence/submit'
  );
  assert.throws(
    () => policy.normalizeApiBase('https://attacker.example', 'https://field.example/', []),
    /FIELD_API_ORIGIN_NOT_ALLOWED/
  );
});

test('cross-origin API requires an exact HTTPS allowlist entry; insecure remote origins are rejected', () => {
  assert.equal(
    policy.resolveApiUrl('https://api.example', '/v1/tickets/close-field', 'https://field.example/', ['https://api.example']),
    'https://api.example/v1/tickets/close-field'
  );
  assert.throws(
    () => policy.normalizeApiBase('http://api.example', 'https://field.example/', ['http://api.example']),
    /FIELD_API_HTTPS_REQUIRED/
  );
  assert.throws(
    () => policy.normalizeApiBase('https://user:secret@api.example', 'https://field.example/', ['https://api.example']),
    /FIELD_API_BASE_INVALID/
  );
  assert.throws(
    () => policy.normalizeApiBase('https://api.example?redirect=attacker', 'https://field.example/', ['https://api.example']),
    /FIELD_API_BASE_INVALID/
  );
});

test('API path builder cannot be redirected to another host or arbitrary route', () => {
  assert.throws(() => policy.resolveApiUrl('', '//attacker.example/v1/x', 'https://field.example/', []), /FIELD_API_PATH_INVALID/);
  assert.throws(() => policy.resolveApiUrl('', '/v1/../admin', 'https://field.example/', []), /FIELD_API_PATH_INVALID/);
  assert.throws(() => policy.resolveApiUrl('', '/admin/delete', 'https://field.example/', []), /FIELD_API_PATH_INVALID/);
});

test('local camera page may use a loopback dev API, but not an arbitrary cleartext host', () => {
  assert.equal(policy.normalizeApiBase('http://127.0.0.1:8080', 'http://localhost:8088/', ['http://127.0.0.1:8080']), 'http://127.0.0.1:8080');
  assert.throws(
    () => policy.normalizeApiBase('http://192.168.1.40:8080', 'http://localhost:8088/', []),
    /FIELD_API_HTTPS_REQUIRED/
  );
});

test('field HTML is CSP-compatible, masks JWTs, and loads all OCR assets from this origin', () => {
  const html = read('index.html');
  assert.match(html, /id="token"[^>]*type="password"/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["']https?:/i);
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /<style\b/i);
  const fieldJs = read('field.js');
  // OCR must remain same-origin: either eager HTML script or intentional lazy load in field.js.
  assert.ok(
    /\/vendor\/tesseract-7\.0\.0\/tesseract\.min\.js/.test(html) ||
      /vendor\/tesseract-7\.0\.0\/tesseract\.min\.js/.test(fieldJs),
    'OCR library must be referenced from same-origin vendor path in HTML or field.js'
  );
  for (const file of [
    'vendor/tesseract-7.0.0/worker.min.js',
    'vendor/tesseract-7.0.0/lang-data/eng.traineddata.gz'
  ]) assert.ok(fs.statSync(path.join(ROOT, 'public', file)).size > 0, `${file} must be present`);
  for (const stem of ['tesseract-core.wasm', 'tesseract-core-simd.wasm', 'tesseract-core-lstm.wasm', 'tesseract-core-simd-lstm.wasm']) {
    for (const extension of ['', '.js']) {
      const file = `vendor/tesseract-7.0.0/core/${stem}${extension}`;
      assert.ok(fs.statSync(path.join(ROOT, 'public', file)).size > 0, `${file} must be present`);
    }
  }
});

test('field network code validates the destination before reading the JWT and never uses cookies or redirects', () => {
  const js = read('field.js');
  assert.ok(js.indexOf('resolveApiUrl(') < js.indexOf("const token = $('token').value.trim()"));
  assert.match(js, /credentials:\s*'omit'/);
  assert.match(js, /redirect:\s*'error'/);
  assert.match(js, /cache:\s*'no-store'/);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
  assert.doesNotMatch(js, /https:\/\/unpkg\.com|https:\/\/cdn\./i);
});

test('language selector includes the official 114-locale pack and marks draft/fallback states', () => {
  const data = JSON.parse(read('locales-114.json'));
  assert.equal(data.total, 114);
  assert.equal(data.availableCount, 114);
  assert.equal(data.statusTally.verified, 2);
  assert.equal(data.statusTally['machine-draft'], 112);
  assert.equal(data.statusTally.untranslated ?? 0, 0);
  assert.equal(data.formattingFallbackCount, 17);
  assert.equal(data.languages.filter((item) => item.available).length, 114);
  assert.match(read('i18n-selector.js'), /machine draft — unreviewed/);
  assert.match(read('i18n-selector.js'), /English date\/number-format fallback/);
});

test('field and operations locales/runtime assets remain identical', () => {
  const ops = path.resolve(ROOT, '../ops-web/public');
  for (const file of ['i18n-selector.js', 'i18n-selector.css', 'i18n-runtime.js', 'locales-114.json']) {
    assert.equal(fs.readFileSync(path.join(ROOT, 'public', file), 'utf8'), fs.readFileSync(path.join(ops, file), 'utf8'), `${file} must match`);
  }
  assert.doesNotMatch(read('i18n-runtime.js'), /\.style\s*\./);
  assert.doesNotMatch(read('i18n-selector.js'), /\.style\s*\./);
});

test('static hosting and Nginx instructions include HSTS, CSP, and camera/GPS permission policy', () => {
  const headers = read('_headers');
  const nginx = fs.readFileSync(path.resolve(ROOT, '../../deploy/nginx/field-web-security-headers.conf'), 'utf8');
  for (const source of [headers, nginx]) {
    assert.match(source, /Strict-Transport-Security/);
    assert.match(source, /Content-Security-Policy/);
    assert.match(source, /Permissions-Policy.*camera=\(self\).*geolocation=\(self\)/);
    assert.match(source, /no-referrer/);
  }
});

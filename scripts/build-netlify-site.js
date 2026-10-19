#!/usr/bin/env node
'use strict';

/**
 * Build static FiberOS website surfaces for Netlify from the monorepo apps/*.
 * Merges Buyer Nexus + Operations/Field/Enterprise surfaces.
 * FIBEROS_API_BASE is a public URL only — never secrets.
 *
 * Security: emits hardened _headers (CSP/HSTS/COOP/CORP) and avoids inline
 * API config scripts so CSP can stay script-src 'self'.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, '.netlify', 'site');
const OPS = path.join(ROOT, 'apps/ops-web/public');
const FIELD = path.join(ROOT, 'apps/field-web/public');
const I18N = path.join(ROOT, 'i18n');
const PUBLIC_SITE_ORIGIN = 'https://gpon-orchestrator-gold.vercel.app';
const INDEXABLE_PUBLIC_ROUTES = Object.freeze([
  '/',
  '/ops/',
  '/field/',
  '/enterprise-command.html',
  '/customer/',
  '/trust/',
]);

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}
function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}
function copyFile(source, target) {
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}
function copyTree(source, target) {
  if (!fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    ensureDir(target);
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyTree(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  copyFile(source, target);
}
function read(abs) {
  return fs.readFileSync(abs, 'utf8');
}
function write(relative, content) {
  const target = path.join(SITE, relative);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, content, 'utf8');
}
function publicApiValue() {
  return String(process.env.FIBEROS_API_BASE || '').trim().replace(/\/+$/, '');
}
function publicApiLiteral() {
  return JSON.stringify(publicApiValue());
}
function apiConnectOrigin() {
  const value = publicApiValue();
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
function writeApiConfigFile(relativePath) {
  write(
    relativePath,
    '/* FiberOS public API base only — no secrets. Generated at site build. */\n' +
      "'use strict';\n" +
      'window.FIBEROS_API_BASE=' +
      publicApiLiteral() +
      ';\n'
  );
}
/** Inject external config script (CSP-safe: no inline script). */
function injectOpsApiConfig(html, scriptSrc) {
  if (html.includes('fiberos-api-config.js') || html.includes('window.FIBEROS_API_BASE=')) {
    return html;
  }
  const tag = '<script src="' + scriptSrc + '" defer></script>';
  const marker = '</head>';
  if (!html.includes(marker)) return html;
  return html.replace(marker, tag + '\n' + marker);
}
function injectModernEnhancement(html, cssSrc = '/fiberos-modern.css', jsSrc = '/fiberos-modern.js') {
  if (html.includes('fiberos-modern.css') && html.includes('fiberos-modern.js')) return html;
  const marker = '</head>';
  if (!html.includes(marker)) return html;
  return html.replace(
    marker,
    '<link rel="stylesheet" href="' + cssSrc + '">\n<script src="' + jsSrc + '" defer></script>\n' + marker
  );
}
function injectFieldApiDefault(html) {
  const value = publicApiValue();
  if (!value) return html;
  const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return html.replace(
    '<input id="apiBase" class="input" value="">',
    '<input id="apiBase" class="input" value="' + escaped + '" autocomplete="url">'
  );
}
function requireFile(abs, label) {
  if (!fs.existsSync(abs)) throw new Error('MISSING_REQUIRED_SOURCE:' + label + ':' + abs);
}

function buildRobotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    'Sitemap: ' + PUBLIC_SITE_ORIGIN + '/sitemap.xml',
    '',
  ].join('\n');
}

function buildSitemapXml() {
  const entries = INDEXABLE_PUBLIC_ROUTES
    .map((route) => '  <url><loc>' + PUBLIC_SITE_ORIGIN + route + '</loc></url>')
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</urlset>',
    '',
  ].join('\n');
}

function buildSecurityHeaders() {
  const connect = ["'self'"];
  const origin = apiConnectOrigin();
  if (origin) connect.push(origin);
  // Field OCR may fetch same-origin wasm/workers only; optional API origin for live mode.
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    // wasm-unsafe-eval required for field Tesseract WASM; no unsafe-inline scripts.
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    'connect-src ' + connect.join(' '),
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

  const lines = [
    '/*',
    '  Content-Security-Policy: ' + csp,
    '  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Cross-Origin-Resource-Policy: same-origin',
    '  X-DNS-Prefetch-Control: off',
    '  X-Permitted-Cross-Domain-Policies: none',
    '',
    '/index.html',
    '  Cache-Control: no-store',
    '/ops/index.html',
    '  Cache-Control: no-store',
    '/field/index.html',
    '  Cache-Control: no-store',
    '/enterprise-command.html',
    '  Cache-Control: no-store',
    '/noc3d.html',
    '  Cache-Control: no-store',
    '/customer/index.html',
    '  Cache-Control: no-store',
    '',
    '/*.js',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/*.css',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/*.wasm',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/*.json',
    '  Cache-Control: public, max-age=3600',
    '',
  ];
  return lines.join('\n');
}

function main() {
  requireFile(path.join(OPS, 'buyer.html'), 'buyer.html');
  requireFile(path.join(OPS, 'index.html'), 'ops index');
  requireFile(path.join(FIELD, 'index.html'), 'field index');
  requireFile(path.join(OPS, 'enterprise-command.html'), 'enterprise-command');
  requireFile(path.join(OPS, 'customer-portal.html'), 'customer portal');
  requireFile(path.join(OPS, 'trust/index.html'), 'buyer assurance page');

  rmrf(SITE);
  ensureDir(SITE);

  // Public API config (CSP-safe external file)
  writeApiConfigFile('fiberos-api-config.js');
  writeApiConfigFile('ops/fiberos-api-config.js');
  writeApiConfigFile('field/fiberos-api-config.js');
  writeApiConfigFile('customer/fiberos-api-config.js');

  // Buyer Nexus at /
  write('index.html', injectOpsApiConfig(read(path.join(OPS, 'buyer.html')), '/fiberos-api-config.js'));
  for (const file of [
    'buyer.css',
    'buyer.js',
    'buyer-data.json',
    'reference-capabilities.json',
    'reference-atlas.css',
    'nexus-components.js',
    'fiberos-tokens.css',
    'fiberos-3d.css',
    'fiberos-3d.js',
    'fiberos-modern.css',
    'fiberos-modern.js',
    'noc3d.css',
    'noc3d.js',
    'i18n-runtime.js',
    'i18n-selector.js',
    'i18n-selector.css',
    'locales-114.json',
  ]) {
    const src = path.join(OPS, file);
    if (fs.existsSync(src)) copyFile(src, path.join(SITE, file));
  }

  // Enterprise command at site root
  write(
    'enterprise-command.html',
    injectOpsApiConfig(read(path.join(OPS, 'enterprise-command.html')), '/fiberos-api-config.js')
  );
  for (const file of ['enterprise-command.js', 'enterprise-command.css']) {
    const src = path.join(OPS, file);
    if (fs.existsSync(src)) copyFile(src, path.join(SITE, file));
  }
  copyFile(path.join(OPS, 'noc3d.html'), path.join(SITE, 'noc3d.html'));

  // Operations console
  ensureDir(path.join(SITE, 'ops'));
  write('ops/index.html', injectOpsApiConfig(read(path.join(OPS, 'index.html')), '/ops/fiberos-api-config.js').replace(/(href|src)=\"\/((?:fiberos-tokens|fiberos-3d|fiberos-modern)\.(?:css|js))\"/g, '$1=\"$2\"'));
  for (const file of [
    'ops.js',
    'ops.css',
    'ops-config.js',
    'ops-contracts.js',
    'fiberos-tokens.css',
    'fiberos-3d.css',
    'fiberos-3d.js',
    'fiberos-modern.css',
    'fiberos-modern.js',
    'evaluation.html',
    'evaluation.js',
    'evaluation.css',
    'evaluation-mode.js',
    'evaluation-mode.css',
    'session-auth.js',
    'api-origin.js',
    'i18n-runtime.js',
    'i18n-selector.js',
    'i18n-selector.css',
    'locales-114.json',
  ]) {
    const src = path.join(OPS, file);
    if (fs.existsSync(src)) copyFile(src, path.join(SITE, 'ops', file));
  }
  if (fs.existsSync(path.join(OPS, 'i18n'))) {
    copyTree(path.join(OPS, 'i18n'), path.join(SITE, 'ops', 'i18n'));
  }

  // Enterprise customer portal
  ensureDir(path.join(SITE, 'customer'));
  write('customer/index.html', injectOpsApiConfig(read(path.join(OPS, 'customer-portal.html')), '/customer/fiberos-api-config.js').replace(/(href|src)=\"\/((?:fiberos-tokens|fiberos-3d|fiberos-modern)\.(?:css|js))\"/g, '$1=\"$2\"'));
  for (const file of [
    'customer-portal.css','customer-portal.js','fiberos-tokens.css','fiberos-modern.css','fiberos-modern.js',
    'session-auth.js','api-origin.js','i18n-runtime.js','i18n-selector.js','i18n-selector.css','locales-114.json'
  ]) {
    const src = path.join(OPS, file);
    if (fs.existsSync(src)) copyFile(src, path.join(SITE, 'customer', file));
  }
  if (fs.existsSync(path.join(OPS, 'i18n'))) copyTree(path.join(OPS, 'i18n'), path.join(SITE, 'customer', 'i18n'));

  // Field tech + website demos
  ensureDir(path.join(SITE, 'field'));
  let fieldHtml = injectFieldApiDefault(read(path.join(FIELD, 'index.html')));
  fieldHtml = injectOpsApiConfig(fieldHtml, '/field/fiberos-api-config.js');
  write('field/index.html', fieldHtml.replace(/(href|src)=\"\/((?:fiberos-tokens|fiberos-3d|fiberos-modern)\.(?:css|js))\"/g, '$1=\"$2\"'));
  for (const file of [
    'field.js',
    'field.css',
    'field-config.js',
    'field-security.js',
    'fiberos-tokens.css',
    'fiberos-3d.css',
    'fiberos-3d.js',
    'fiberos-modern.css',
    'fiberos-modern.js',
    'buyer-demo.html',
    'engineering-demo.html',
    'i18n-runtime.js',
    'i18n-selector.js',
    'i18n-selector.css',
    'locales-114.json',
  ]) {
    const src = path.join(FIELD, file);
    if (fs.existsSync(src)) copyFile(src, path.join(SITE, 'field', file));
  }
  if (fs.existsSync(path.join(FIELD, 'i18n'))) {
    copyTree(path.join(FIELD, 'i18n'), path.join(SITE, 'field', 'i18n'));
  }
  // Field vendor OCR (WASM) — required for field surfaces
  if (fs.existsSync(path.join(FIELD, 'vendor'))) {
    copyTree(path.join(FIELD, 'vendor'), path.join(SITE, 'field', 'vendor'));
  }

  // Canonical i18n from repo root
  if (fs.existsSync(I18N)) {
    copyTree(I18N, path.join(SITE, 'i18n'));
  }

  // Standalone demos
  const standalones = [
    ['apps/ops-web/public/ops-console-website-standalone.html', 'demos/ops-console-website-standalone.html'],
    ['apps/ops-web/public/enterprise-command-website-standalone.html', 'demos/enterprise-command-website-standalone.html'],
    ['apps/field-web/public/field-website-standalone.html', 'demos/field-website-standalone.html'],
  ];
  for (const [srcRel, destRel] of standalones) {
    const abs = path.join(ROOT, srcRel);
    if (fs.existsSync(abs)) {
      write(destRel, injectModernEnhancement(injectOpsApiConfig(read(abs), '/fiberos-api-config.js')));
    }
  }

  // Public buyer assurance page — contains no secrets or privileged runtime data.
  copyTree(path.join(OPS, 'trust'), path.join(SITE, 'trust'));

  write('_headers', buildSecurityHeaders());
  write(
    '_redirects',
    [
      '# Canonical section routes',
      '/ops /ops/ 301',
      '/field /field/ 301',
      '/customer /customer/ 301',
      '',
      '# SPA-safe fallthrough within sections (static hosts)',
      '/ops/* /ops/index.html 200',
      '/field/* /field/index.html 200',
      '/customer/* /customer/index.html 200',
      '',
    ].join('\n')
  );

  // Public search discovery files use the canonical production origin.
  write('robots.txt', buildRobotsTxt());
  write('sitemap.xml', buildSitemapXml());

  console.log('Netlify site built:', SITE);
  console.log('FIBEROS_API_BASE configured:', Boolean(publicApiValue()));
  console.log('Security headers: CSP+HSTS+COOP+CORP (no inline API config scripts)');
}

main();

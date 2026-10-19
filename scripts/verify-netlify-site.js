#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const site = path.resolve(__dirname, '..', '.netlify', 'site');
const requiredFiles = [
  'index.html',
  'trust/index.html',
  'trust/trust.css',
  'ops/index.html',
  'enterprise-command.html',
  'customer/index.html',
  'field/index.html',
  'buyer.css',
  'fiberos-tokens.css',
  'fiberos-3d.css',
  'fiberos-3d.js',
  'fiberos-modern.css',
  'fiberos-modern.js',
  'buyer.js',
  'nexus-components.js',
  'i18n-runtime.js',
  'i18n-selector.js',
  'locales-114.json',
  'fiberos-api-config.js',
  'ops/fiberos-api-config.js',
  'field/fiberos-api-config.js',
  'customer/fiberos-api-config.js',
  'customer/customer-portal.css',
  'customer/customer-portal.js',
  'customer/session-auth.js',
  'customer/api-origin.js',
  'field/buyer-demo.html',
  'field/engineering-demo.html',
  'demos/ops-console-website-standalone.html',
  'demos/enterprise-command-website-standalone.html',
  'demos/field-website-standalone.html',
  '_headers',
  '_redirects',
  'robots.txt',
  'sitemap.xml',
];
const errors = [];

const PUBLIC_SITE_ORIGIN = 'https://gpon-orchestrator-gold.vercel.app';
const EXPECTED_PUBLIC_ROUTES = ['/', '/ops/', '/field/', '/enterprise-command.html', '/customer/', '/trust/'];


const headersPath = path.join(site, '_headers');
if (fs.existsSync(headersPath)) {
  const headers = fs.readFileSync(headersPath, 'utf8');
  for (const required of [
    'Content-Security-Policy:',
    'Strict-Transport-Security:',
    'X-Frame-Options: DENY',
    'X-Content-Type-Options: nosniff',
    'Cross-Origin-Opener-Policy:',
    'Cross-Origin-Resource-Policy:',
    "script-src 'self'",
  ]) {
    if (!headers.includes(required)) {
      errors.push('security headers missing required directive: ' + required);
    }
  }
  if (headers.includes("'unsafe-inline'") && headers.includes('script-src')) {
    // Allow style-src unsafe-inline only if present; script-src must not use unsafe-inline.
    const scriptLine = headers.split('\n').find((l) => l.includes('Content-Security-Policy:'));
    if (scriptLine && /script-src[^;]*'unsafe-inline'/.test(scriptLine)) {
      errors.push('CSP script-src must not allow unsafe-inline');
    }
  }
} else {
  errors.push('missing _headers');
}

const robotsPath = path.join(site, 'robots.txt');
if (fs.existsSync(robotsPath)) {
  const robots = fs.readFileSync(robotsPath, 'utf8');
  if (!/^User-agent:\s*\*/mi.test(robots)) errors.push('robots.txt missing wildcard user-agent');
  if (!/^Allow:\s*\/$/m.test(robots)) errors.push('robots.txt must allow public pages');
  if (!robots.includes('Sitemap: ' + PUBLIC_SITE_ORIGIN + '/sitemap.xml')) {
    errors.push('robots.txt sitemap URL must match the canonical production origin');
  }
} else {
  errors.push('missing robots.txt');
}

const sitemapPath = path.join(site, 'sitemap.xml');
if (fs.existsSync(sitemapPath)) {
  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  if (!sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')) {
    errors.push('sitemap.xml missing the standard urlset namespace');
  }
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const expectedLocations = EXPECTED_PUBLIC_ROUTES.map((route) => PUBLIC_SITE_ORIGIN + route);
  if (JSON.stringify(locations) !== JSON.stringify(expectedLocations)) {
    errors.push('sitemap.xml locations do not match the canonical list of public pages');
  }
  for (const location of locations) {
    try {
      if (new URL(location).origin !== PUBLIC_SITE_ORIGIN) errors.push('sitemap.xml contains an off-origin URL: ' + location);
    } catch {
      errors.push('sitemap.xml contains an invalid URL: ' + location);
    }
  }
} else {
  errors.push('missing sitemap.xml');
}

const LOCAL_RUNTIME_ASSETS = {
  'ops/index.html': [
    'ops.css','i18n-selector.css','evaluation-mode.css','evaluation-mode.js',
    'fiberos-tokens.css','fiberos-3d.css','fiberos-3d.js','fiberos-modern.css','fiberos-modern.js',
    'ops-config.js','api-origin.js','ops-contracts.js','session-auth.js','ops.js','i18n-selector.js','i18n-runtime.js'
  ],
  'customer/index.html': [
    'customer-portal.css','session-auth.js','api-origin.js','fiberos-modern.css','fiberos-modern.js'
  ],
  'field/index.html': [
    'field.css','i18n-selector.css','field-config.js','field-security.js','field.js',
    'i18n-selector.js','i18n-runtime.js','evaluation-mode.css','evaluation-mode.js',
    'fiberos-tokens.css','fiberos-3d.css','fiberos-3d.js','fiberos-modern.css','fiberos-modern.js'
  ]
};

for (const [route, assets] of Object.entries(LOCAL_RUNTIME_ASSETS)) {
  const htmlPath = path.join(site, route);
  if (!fs.existsSync(htmlPath)) continue;
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const asset of assets) {
    const attr = asset.endsWith('.css') ? 'href' : 'src';
    const expected = attr + '="' + asset + '"';
    if (!html.includes(expected)) {
      errors.push('nested route must use local ' + attr + ' for ' + asset + ': ' + route);
    }
  }
}

// HTML pages should reference external API config, not inline assignment.
for (const route of ['index.html', 'ops/index.html', 'field/index.html', 'enterprise-command.html', 'customer/index.html']) {
  const abs = path.join(site, route);
  if (!fs.existsSync(abs)) continue;
  const html = fs.readFileSync(abs, 'utf8');
  if (html.includes('<script>window.FIBEROS_API_BASE=')) {
    errors.push('inline API config script still present in ' + route);
  }
  if (!html.includes('fiberos-api-config.js')) {
    errors.push('missing fiberos-api-config.js reference in ' + route);
  }
}

if (errors.length) {
  console.error('Website build verification failed:');
  for (const error of errors) console.error('- ' + error);
  process.exitCode = 1;
} else {
  console.log(
    'Website build verification passed (' +
      requiredFiles.length +
      ' required files, i18n assets, hardened security headers).'
  );
}

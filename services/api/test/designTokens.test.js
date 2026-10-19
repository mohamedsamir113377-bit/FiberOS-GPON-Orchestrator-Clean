'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SURFACES = [
  'apps/ops-web/public/ops.css',
  'apps/field-web/public/field.css',
  'apps/ops-web/public/buyer.css',
];

test('shared design tokens exist exactly once, inside an explicit cascade layer', () => {
  const tokens = read('apps/ops-web/public/fiberos-tokens.css');
  assert.match(tokens, /@layer fiberos\.tokens \{/);
  assert.match(tokens, /--fo-void: #030508;/);
  assert.match(tokens, /--fo-panel: #0c1620;/);
  assert.match(tokens, /--fo-ink: #eef6f5;/);
  assert.match(tokens, /--fo-ink-muted: #7a9493;/);
  assert.match(tokens, /--fo-accent: #2ee6d6;/);
  assert.match(tokens, /--bg: var\(--fo-void\);/);
  assert.match(tokens, /--aqua: var\(--fo-accent\);/);
  assert.doesNotMatch(tokens, /<style|style=/);
});

test('the shared palette literals are declared in the token layer only', () => {
  const literals = ['#030508', '#0c1620', '#eef6f5', '#7a9493', '#2ee6d6', '#f0b429', '#34d399', '#f87171'];
  const tokens = read('apps/ops-web/public/fiberos-tokens.css');
  for (const literal of literals) {
    assert.ok(tokens.includes(literal), 'token layer must own ' + literal);
  }
  for (const surface of SURFACES) {
    const css = read(surface);
    for (const literal of literals) {
      assert.ok(
        !css.includes(literal),
        surface + ' still hard-codes ' + literal + ' instead of referencing the token layer'
      );
    }
  }
});

test('each surface keeps only the tokens it genuinely overrides', () => {
  const ops = read('apps/ops-web/public/ops.css');
  assert.doesNotMatch(ops, /:root \{/, 'operations surface has no surface-specific tokens left');
  const field = read('apps/field-web/public/field.css');
  assert.match(field, /--line: rgba\(140, 200, 210, 0\.14\)/, 'field keeps its stronger daylight hairline');
  assert.doesNotMatch(field, /--bg: #030508;/, 'field must not redeclare the shared background literal');
  const buyer = read('apps/ops-web/public/buyer.css');
  assert.match(buyer, /--bg-void: var\(--fo-void\);/);
  assert.match(buyer, /--accent: var\(--fo-accent\);/);
});

test('every entrypoint loads the token layer before its surface stylesheet', () => {
  const entries = [
    'apps/ops-web/public/index.html',
    'apps/ops-web/public/enterprise-command.html',
    'apps/ops-web/public/buyer.html',
    'apps/field-web/public/index.html',
  ];
  for (const rel of entries) {
    const html = read(rel);
    const tokenAt = html.indexOf('/fiberos-tokens.css');
    const depthAt = html.indexOf('/fiberos-3d.css');
    assert.ok(tokenAt > -1, 'missing token layer in ' + rel);
    assert.ok(depthAt > -1, 'missing depth layer in ' + rel);
    assert.ok(tokenAt < depthAt, 'token layer must load before the depth layer in ' + rel);
    assert.doesNotMatch(html, /href="https?:\/\/[^"]*fiberos-tokens/i, 'token layer must be same-origin in ' + rel);
  }
});

test('every command palette trigger has a usable dialog and field exposes only explicit safe actions', () => {
  const entries = [
    'apps/ops-web/public/index.html',
    'apps/ops-web/public/enterprise-command.html',
    'apps/ops-web/public/buyer.html',
    'apps/field-web/public/index.html',
  ];
  for (const rel of entries) {
    const html = read(rel);
    assert.match(html, /id="foPaletteButton"/, 'trigger missing in ' + rel);
    assert.match(html, /<dialog id="foCommandPalette"/, 'dialog missing in ' + rel);
    assert.match(html, /class="fo-palette-input"/, 'search input missing in ' + rel);
    assert.match(html, /class="fo-palette-list"/, 'command list missing in ' + rel);
  }
  const fieldHtml = read('apps/field-web/public/index.html');
  const fieldLayer = read('apps/field-web/public/fiberos-modern.js');
  const opsCss = read('apps/ops-web/public/ops.css');
  assert.match(opsCss, /\.ops-inline-1\s*\{[^}]*position:\s*static/,
    'enterprise link must remain in flow and not cover operations controls');
  assert.match(fieldHtml, /data-command-safe="true"/);
  assert.match(fieldLayer, /button\[data-command-safe="true"\]/,
    'field palette must collect only explicitly safe controls');
  assert.doesNotMatch(fieldLayer, /button\[data-action="(?:saveEvidence|closeTicket)/,
    'evidence submission and ticket closure must not become one-keystroke commands');
});

test('frame-ancestors is never declared in a meta CSP - browsers ignore it there', () => {
  const entries = [
    'apps/ops-web/public/index.html',
    'apps/ops-web/public/enterprise-command.html',
    'apps/ops-web/public/buyer.html',
    'apps/field-web/public/index.html',
  ];
  for (const rel of entries) {
    const html = read(rel);
    const metas = html.match(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/g) || [];
    for (const meta of metas) {
      assert.doesNotMatch(meta, /frame-ancestors/, rel + ' declares frame-ancestors in a meta CSP');
    }
  }
  // It must still be enforced where it actually works: the response headers.
  const headers = read('apps/ops-web/public/_headers');
  assert.match(headers, /Content-Security-Policy/, 'response-header CSP missing');
  const builder = read('scripts/build-netlify-site.js');
  assert.match(builder, /frame-ancestors 'none'/, 'generated header CSP must keep frame-ancestors');
});

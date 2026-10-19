'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OPS = path.join(ROOT, 'apps/ops-web/public');
const FIELD = path.join(ROOT, 'apps/field-web/public');

function read(abs) {
  return fs.readFileSync(abs, 'utf8');
}

test('both web surfaces ship the 3D depth + motion layer as external assets', () => {
  for (const dir of [OPS, FIELD]) {
    assert.ok(fs.existsSync(path.join(dir, 'fiberos-3d.css')), 'missing fiberos-3d.css in ' + dir);
    assert.ok(fs.existsSync(path.join(dir, 'fiberos-3d.js')), 'missing fiberos-3d.js in ' + dir);
  }
});

test('the depth stylesheet models depth and disables it under reduced motion', () => {
  const css = read(path.join(OPS, 'fiberos-3d.css'));
  assert.match(css, /perspective:/);
  assert.match(css, /transform-style:\s*preserve-3d/);
  assert.match(css, /rotateX\(var\(--fo-rx\)\)/);
  assert.match(css, /rotateY\(var\(--fo-ry\)\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-timeline:\s*view\(\)/);
  assert.match(css, /@supports not \(animation-timeline: view\(\)\)/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.doesNotMatch(css, /!important[^;]*!important/);
});

test('the depth enhancer stays CSP-safe and inert without a fine pointer', () => {
  const js = read(path.join(OPS, 'fiberos-3d.js'));
  assert.doesNotMatch(js, /\beval\s*\(|new Function|document\.write|innerHTML/);
  assert.doesNotMatch(js, /https?:\/\//);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(js, /setProperty\('--fo-rx'/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /startViewTransition/);
  assert.match(js, /MutationObserver/);
});

test('every HTML entrypoint loads the depth layer from a same-origin path', () => {
  const entries = [
    'apps/ops-web/public/index.html',
    'apps/ops-web/public/enterprise-command.html',
    'apps/ops-web/public/buyer.html',
    'apps/field-web/public/index.html',
  ];
  for (const rel of entries) {
    const html = read(path.join(ROOT, rel));
    assert.match(html, /<link rel="stylesheet" href="\/fiberos-3d\.css">/, 'missing stylesheet link in ' + rel);
    assert.match(html, /<script src="\/fiberos-3d\.js" defer><\/script>/, 'missing deferred script in ' + rel);
    assert.doesNotMatch(html, /(?:src|href)="https?:\/\/[^"]*fiberos-3d/i, 'depth layer must not be cross-origin in ' + rel);
  }
});

test('the site builder copies the depth layer and the site checker requires it', () => {
  const builder = read(path.join(ROOT, 'scripts/build-netlify-site.js'));
  assert.ok((builder.match(/'fiberos-3d\.css'/g) || []).length >= 3, 'builder must copy the stylesheet into all three surfaces');
  assert.ok((builder.match(/'fiberos-3d\.js'/g) || []).length >= 3, 'builder must copy the enhancer into all three surfaces');
  const checker = read(path.join(ROOT, 'scripts/verify-netlify-site.js'));
  assert.match(checker, /'fiberos-3d\.css'/);
  assert.match(checker, /'fiberos-3d\.js'/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const css = fs.readFileSync(path.join(ROOT, 'apps/ops-web/public/buyer.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'apps/ops-web/public/buyer.html'), 'utf8');
const visualHarness = fs.readFileSync(path.join(ROOT, 'tools/visual/visual-regression.js'), 'utf8');

test('buyer capability rows use all three rendered columns on desktop and compact mobile rows', () => {
  assert.match(css, /\.cap-row\s*\{[^}]*grid-template-columns:\s*minmax\(110px,\s*128px\)\s+minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.cap-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(css, /\.cap-row\s*>\s*:nth-child\(2\)\s*\{\s*grid-column:\s*1\s*\/\s*-1\s*;/);
  assert.match(css, /\.cap-row\s*\.cap-status\s*\{[^}]*grid-row:\s*1\s*;/s);
});

test('capability explorer bounds vertical growth while keeping its registry scrollable and keyboard reachable', () => {
  assert.match(css, /#capTable\s*\{[^}]*max-height:\s*min\(68vh,\s*680px\)[^}]*overflow-y:\s*auto/s);
  assert.match(html, /id="capTable"[^>]*role="region"[^>]*aria-label="Scrollable capability registry"[^>]*tabindex="0"/);
});

test('visual regression waits until all declared capability rows have rendered before capturing', () => {
  assert.match(visualHarness, /if\s*\(route\.name\s*===\s*'root'\)[\s\S]*?waitForFunction[\s\S]*?capTable \.cap-row/s);
  assert.match(visualHarness, /facts\.capabilityRows\s*!==\s*facts\.expectedCapabilities/);
});

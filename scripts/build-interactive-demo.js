#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'apps', 'field-web', 'public', 'buyer-demo.html');
const OUT = path.join(ROOT, '.release', 'interactive-demo');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function main() {
  if (!fs.existsSync(SOURCE)) throw new Error('BUYER_DEMO_SOURCE_MISSING');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  fs.copyFileSync(SOURCE, path.join(OUT, 'index.html'));

  write('README.txt', [
    'FiberOS Interactive Buyer Experience',
    '',
    'This package is a browser-based evaluation surface.',
    'It performs deterministic optical calculations from explicit user inputs.',
    'It can connect to real FiberOS API endpoints only when the buyer supplies a real endpoint and authorized credentials.',
    'It does not fabricate customer telemetry, live calls, calibrated OTDR output, or production database evidence.',
    ''
  ].join('\n'));

  write('ATTRIBUTION.txt', [
    'Map: Leaflet 1.9.4 with OpenStreetMap tile data.',
    'OpenStreetMap attribution is rendered in the map control inside index.html.',
    ''
  ].join('\n'));

  const files = ['index.html', 'README.txt', 'ATTRIBUTION.txt'];
  const manifest = {
    format: 'fiberos.interactive-buyer-demo.v1',
    version: require(path.join(ROOT, 'package.json')).version,
    sourceCommit: process.env.GITHUB_SHA || null,
    truthBoundary: 'DETERMINISTIC_BROWSER_CALCULATIONS_AND_REAL_API_OPTIONAL; NO_FABRICATED_PRODUCTION_EVIDENCE',
    files: Object.fromEntries(files.map(rel => [rel, {
      sha256: sha256(path.join(OUT, rel)),
      bytes: fs.statSync(path.join(OUT, rel)).size
    }]))
  };
  write('MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
}
main();

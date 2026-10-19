'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('buyer site models the requested FTTH asset hierarchy without claiming live connectivity', () => {
  const html = read('apps/ops-web/public/buyer.html');
  const builder = read('scripts/build-netlify-site.js');

  const orderedLayers = [
    ['gpon-olt', 'G-PON / OLT'],
    ['main-cabinet', 'Main cabinet'],
    ['passive-cabinet', 'Passive cabinet'],
    ['main-box', 'Main distribution box'],
    ['riser-box', 'Riser cable and floor boxes'],
    ['customer-fiber', 'Customer fiber / ONT']
  ];

  let previous = -1;
  for (const [id, label] of orderedLayers) {
    const token = 'data-asset-layer="' + id + '"';
    const index = html.indexOf(token);
    assert.ok(index > previous, 'missing or reordered FTTH layer: ' + label);
    assert.ok(html.includes(label), 'missing descriptive title: ' + label);
    previous = index;
  }

  assert.match(html, /id="ftth-asset-hierarchy"/);
  assert.match(html, /TRUTH BOUNDARY/);
  assert.match(html, /No live asset count, port availability, optical level, technician location or NMS alarm is created by this page/);
  assert.match(html, /calculated optical budget from measured OTDR\/power-meter evidence/);
  assert.match(builder, /read\(path\.join\(OPS, 'buyer\.html'\)\)/);
});

test('buyer capability headline matches the generated capability fact count', () => {
  const html = read('apps/ops-web/public/buyer.html');
  const client = read('apps/ops-web/public/buyer.js');
  const data = JSON.parse(read('apps/ops-web/public/buyer-data.json'));

  assert.equal(data.facts.productionCertification, false);
  assert.match(html, /id="capabilities"/);
  assert.match(client, /function syncCapabilityHeading\(\)[\s\S]*?S\.data\.capabilities\.length/);
  assert.match(client, /function caps\(\)\{syncCapabilityHeading\(\)/);
  assert.equal(data.capabilities.length, data.facts.capabilityTotal);
  assert.equal(
    Object.values(data.facts.statusCounts).reduce((sum, count) => sum + count, 0),
    data.facts.capabilityTotal,
    'capability status totals must reconcile to the published count'
  );
});

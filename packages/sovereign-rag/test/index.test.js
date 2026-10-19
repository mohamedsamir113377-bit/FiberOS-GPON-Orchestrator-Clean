'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/index');

const DOCS = [
  { id: 'd1', source: 'ftth-handbook', text: 'The optical power budget for a GPON class B network limits total attenuation to twenty five decibels.' },
  { id: 'd2', source: 'itu-manual', text: 'Splice loss for a fusion splice must remain below zero point one decibels for a compliant link.' },
  { id: 'd3', source: 'ops-runbook', text: 'Field crews must confirm the ONT serial number before closing an installation ticket.' }
];

test('tokenize lowercases and drops stop-short tokens', () => {
  const t = r.tokenize('The ONT a of Serial');
  assert.ok(t.includes('ont'));
  assert.ok(!t.includes('a'));
});

test('chunkText produces overlapping, bounded chunks', () => {
  const chunks = r.chunkText('x'.repeat(1000), { maxChars: 400, overlap: 50 });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.end - c.start <= 400));
  assert.equal(chunks[0].end - chunks[1].start, 50);
});

test('bm25Search ranks the topically relevant document first', () => {
  const idx = r.buildIndex(DOCS);
  const hits = r.bm25Search(idx, 'power budget GPON attenuation', 3);
  assert.equal(hits[0].doc, 'd1');
});

test('vectorSearch returns cosine-ranked hits', () => {
  const idx = r.buildIndex(DOCS);
  const hits = r.vectorSearch(idx, 'fusion splice loss', 3);
  assert.equal(hits[0].doc, 'd2');
});

test('answerWithCitations returns citations and refuses with no evidence', () => {
  const idx = r.buildIndex(DOCS);
  const good = r.answerWithCitations({ index: idx, query: 'ONT serial installation', k: 2 });
  assert.equal(good.answerable, true);
  assert.ok(good.citations.length >= 1);
  assert.equal(good.citations[0], '[1]');
  const none = r.answerWithCitations({ index: idx, query: 'zzzzqqqq', k: 2 });
  assert.equal(none.refused, true);
});

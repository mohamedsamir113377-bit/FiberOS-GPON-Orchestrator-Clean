'use strict';

/**
 * Sovereign on-premises retrieval (RAG) primitives — fully local, no network.
 * Concept sources (public): LLM engineering / search-application literature
 * (chunking, lexical + vector retrieval, rank fusion, citation-bound answers).
 * Deterministic: identical input yields identical ranking. No model call here.
 */

function tokenize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function chunkText(text, { maxChars = 800, overlap = 100 } = {}) {
  const s = String(text == null ? '' : text);
  const max = Math.trunc(maxChars), ov = Math.trunc(overlap);
  if (!Number.isInteger(max) || max < 50) throw new Error('RAG_MAX_CHARS_INVALID');
  if (!Number.isInteger(ov) || ov < 0 || ov >= max) throw new Error('RAG_OVERLAP_INVALID');
  const chunks = [];
  let start = 0;
  while (start < s.length) {
    const end = Math.min(start + max, s.length);
    chunks.push(Object.freeze({ index: chunks.length, start, end, text: s.slice(start, end) }));
    if (end === s.length) break;
    start = end - ov;
  }
  return Object.freeze(chunks);
}

function buildIndex(documents, opts) {
  if (!Array.isArray(documents) || !documents.length) throw new Error('RAG_DOCUMENTS_REQUIRED');
  const docs = [];
  for (const d of documents) {
    if (!d || d.id == null) throw new Error('RAG_DOC_ID_REQUIRED');
    const chunks = Array.isArray(d.chunks) ? d.chunks : chunkText(d.text, opts);
    docs.push({ id: String(d.id), source: d.source == null ? null : String(d.source), chunks });
  }
  const df = new Map();
  const postings = new Map(); // term -> [{doc, chunk, tf, len}]
  let totalLen = 0, chunkCount = 0;
  for (const d of docs) {
    for (const c of d.chunks) {
      const toks = tokenize(c.text);
      const len = toks.length || 1;
      totalLen += len; chunkCount += 1;
      const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) {
        df.set(t, (df.get(t) || 0) + 1);
        if (!postings.has(t)) postings.set(t, []);
        postings.get(t).push({ doc: d.id, source: d.source, chunk: c.index, tf: tf.get(t), len });
      }
    }
  }
  const avgLen = chunkCount === 0 ? 0 : totalLen / chunkCount;
  return Object.freeze({ docs, df, postings, avgLen, chunkCount, N: docs.length });
}

function bm25Search(index, query, k = 5, { k1 = 1.5, b = 0.75 } = {}) {
  const terms = tokenize(query);
  const scores = new Map();
  const N = index.N || 1;
  for (const t of terms) {
    const posting = index.postings.get(t);
    if (!posting) continue;
    const idf = Math.log(1 + (N - posting.length + 0.5) / (posting.length + 0.5));
    for (const p of posting) {
      const denom = p.tf + k1 * (1 - b + b * (p.len / (index.avgLen || 1)));
      const s = idf * ((p.tf * (k1 + 1)) / (denom || 1));
      const key = p.doc + '#' + p.chunk;
      const prev = scores.get(key) || { doc: p.doc, source: p.source, chunk: p.chunk, score: 0 };
      prev.score += s;
      scores.set(key, prev);
    }
  }
  return Object.freeze([...scores.values()].sort((a, c) => c.score - a.score).slice(0, Math.max(1, Math.trunc(k))));
}

function termVector(text) {
  const v = new Map();
  for (const t of tokenize(text)) v.set(t, (v.get(t) || 0) + 1);
  return v;
}
function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [t, w] of a) { na += w * w; if (b.has(t)) dot += w * b.get(t); }
  for (const [, w] of b) nb += w * w;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function vectorSearch(index, query, k = 5) {
  const qv = termVector(query);
  const scores = [];
  for (const d of index.docs) {
    for (const c of d.chunks) {
      const s = cosineSimilarity(qv, termVector(c.text));
      if (s > 0) scores.push({ doc: d.id, source: d.source, chunk: c.index, score: s });
    }
  }
  return Object.freeze(scores.sort((a, c) => c.score - a.score).slice(0, Math.max(1, Math.trunc(k))));
}

function reciprocalRankFusion(rankings, k = 60) {
  const acc = new Map();
  rankings.forEach((list, ri) => {
    list.forEach((item, pos) => {
      const key = item.doc + '#' + item.chunk;
      const prev = acc.get(key) || { doc: item.doc, source: item.source, chunk: item.chunk, score: 0, sources: new Set() };
      prev.score += 1 / (k + pos + 1);
      prev.sources.add(ri);
      acc.set(key, prev);
    });
  });
  return Object.freeze([...acc.values()]
    .map((x) => ({ doc: x.doc, source: x.source, chunk: x.chunk, score: Number(x.score.toFixed(8)), fusedFrom: x.sources.size }))
    .sort((a, c) => c.score - a.score));
}

function answerWithCitations({ index, query, k = 5 }) {
  const lexical = bm25Search(index, query, k);
  const vector = vectorSearch(index, query, k);
  const fused = reciprocalRankFusion([lexical, vector]).slice(0, Math.max(1, Math.trunc(k)));
  const passages = fused.map((p, i) => Object.freeze({
    citation: '[' + (i + 1) + ']',
    docId: p.doc,
    source: p.source,
    chunk: p.chunk,
    score: p.score
  }));
  return Object.freeze({
    answerable: passages.length > 0,
    refused: passages.length === 0,
    passages: Object.freeze(passages),
    citations: Object.freeze(passages.map((p) => p.citation))
  });
}

module.exports = { tokenize, chunkText, buildIndex, bm25Search, termVector, cosineSimilarity, vectorSearch, reciprocalRankFusion, answerWithCitations };

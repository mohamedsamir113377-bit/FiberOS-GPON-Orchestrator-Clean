#!/usr/bin/env node
'use strict';

/*
 * Union-closure gate.
 *
 * The consolidation archive lives in its own repository (see
 * docs/CONSOLIDATION_ARCHIVE.md). Moving it out is only safe if the release
 * source tree can still prove that nothing was lost.
 *
 * The property that actually matters is: content that exists ONLY outside the
 * main branch's own history. Anything reachable from main's history is still
 * in the repository by construction, so it can never be lost. Anything that
 * exists only on a tag, a side branch or a detached tip disappears the moment
 * that ref is deleted - that is the risk this gate closes.
 *
 * A naive "every blob reachable from every ref" rule cannot work: every
 * ordinary commit makes the previous revision of each changed file
 * historical-only, so the gate would fail forever on its own output. This gate
 * therefore checks two stable, explicit sets:
 *
 *   A. The frozen boundary. `boundaryCommits` in the manifest are the ref tips
 *      that existed when the archive was extracted. They are frozen in the
 *      manifest, so this check keeps working even after a ref is deleted.
 *   B. The live refs. Every blob reachable from refs/heads/*,
 *      refs/remotes/origin/* and refs/tags/* that is NOT in main's history must
 *      be preserved.
 *
 * Coverage for both is the same: a blob is covered if it is reachable from
 * main's history, or listed in the external archive manifest, or listed in the
 * manifest's documented exclusion set.
 *
 * The gate fails closed on a shallow checkout, and reads only the manifest, so
 * it never needs the archive repository checked out.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'config', 'union-closure-manifest.json');
const REF_NAMESPACES = ['refs/heads', 'refs/remotes/origin', 'refs/tags'];

function fail(code, detail) {
  console.error(JSON.stringify({ ok: false, gate: 'UNION_CLOSURE', code, detail }, null, 2));
  process.exit(1);
}

function git(args, opts) {
  return execFileSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }, opts || {}));
}

/** Every blob reachable from the given revisions, plus the rev-list listing. */
function blobsReachableFrom(revs) {
  const listing = git(['rev-list', '--objects', ...revs]);
  const shas = [...new Set(listing.split('\n').filter(Boolean).map((line) => line.split(' ')[0]))];
  if (!shas.length) return { blobs: new Set(), listing };
  const typed = execFileSync('git', ['cat-file', '--batch-check=%(objecttype) %(objectname)'], {
    cwd: ROOT,
    input: shas.join('\n'),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  const blobs = new Set();
  for (const line of typed.split('\n')) {
    const [kind, sha] = line.split(' ');
    if (kind === 'blob' && sha) blobs.add(sha);
  }
  return { blobs, listing };
}

if (!fs.existsSync(MANIFEST_PATH)) {
  fail('MANIFEST_MISSING', 'config/union-closure-manifest.json is not present');
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// Fail closed: a shallow clone cannot answer the closure question at all.
let shallow = '';
try {
  shallow = git(['rev-parse', '--is-shallow-repository']).trim();
} catch (error) {
  fail('GIT_UNAVAILABLE', String(error.message));
}
if (shallow !== 'false') {
  fail('SHALLOW_HISTORY', 'union closure requires the complete object graph; check out with fetch-depth: 0');
}

const boundaryCommits = manifest.boundaryCommits || [];
if (!Array.isArray(boundaryCommits) || boundaryCommits.length === 0) {
  fail('BOUNDARY_MISSING', 'manifest must record the frozen boundaryCommits of the extraction');
}
const archived = manifest.blobs && typeof manifest.blobs === 'object' ? manifest.blobs : {};
const excluded = new Set((manifest.exclusions || []).map((entry) => entry.sha || entry));

// Coverage: main's own history, the external archive, or a documented exclusion.
const mainHistory = blobsReachableFrom(['HEAD']).blobs;

// A) the frozen boundary.
const boundary = blobsReachableFrom(boundaryCommits).blobs;

// B) the live refs, restricted to what main's history does not already hold.
const refs = git(['for-each-ref', '--format=%(refname)', ...REF_NAMESPACES])
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
if (!refs.length) {
  fail('NO_REFS', 'no refs found in ' + REF_NAMESPACES.join(', '));
}
const live = blobsReachableFrom(refs);
const liveExternal = [...live.blobs].filter((sha) => !mainHistory.has(sha));

function isCovered(sha) {
  return mainHistory.has(sha) || Object.prototype.hasOwnProperty.call(archived, sha) || excluded.has(sha);
}

const uncoveredBoundary = [...boundary].filter((sha) => !isCovered(sha));
const uncoveredLive = liveExternal.filter((sha) => !isCovered(sha));
const uncovered = [...new Set([...uncoveredBoundary, ...uncoveredLive])];

if (uncovered.length) {
  const names = {};
  for (const line of live.listing.split('\n')) {
    const space = line.indexOf(' ');
    if (space < 0) continue;
    const sha = line.slice(0, space);
    if (uncovered.includes(sha) && !names[sha]) names[sha] = line.slice(space + 1);
  }
  fail('UNION_CLOSURE_GAP', {
    message: 'reachable blobs are neither in main history nor preserved in the archive',
    uncoveredCount: uncovered.length,
    uncoveredFromFrozenBoundary: uncoveredBoundary.length,
    uncoveredFromLiveRefs: uncoveredLive.length,
    uncovered: uncovered.slice(0, 40).map((sha) => ({ sha, lastKnownPath: names[sha] || null })),
  });
}

console.log(
  JSON.stringify({
    ok: true,
    gate: 'UNION_CLOSURE',
    refNamespaces: REF_NAMESPACES,
    refsConsidered: refs.length,
    frozenBoundaryCommits: boundaryCommits.length,
    blobsReachableFromBoundary: boundary.size,
    blobsInMainHistory: mainHistory.size,
    blobsOutsideMainHistory: liveExternal.length,
    blobsPreservedInArchive: Object.keys(archived).length,
    documentedExclusions: excluded.size,
    archiveRepository: manifest.archiveRepository || null,
    runtimeAdmission: 'NOT_CLAIMED',
  })
);

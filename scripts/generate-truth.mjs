#!/usr/bin/env node
// Single source of truth generator.
// Input : config/html-feature-parity.json, i18n/manifest-114.generated.json
// Output: apps/ops-web/public/web-truth.json
// Usage : node scripts/generate-truth.mjs          (write)
//         node scripts/generate-truth.mjs --check  (CI: fail if outputs are stale)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const CHECK = process.argv.includes('--check');
const PARITY = 'config/html-feature-parity.json';
const MANIFEST = 'i18n/manifest-114.generated.json';
// buyer-data.json is owned by scripts/release-provenance.js (GENERATED_DOCS) and is the
// live data file the ops-web registry reads. This generator must NOT overwrite it.
const OUT = ['apps/ops-web/public/web-truth.json'];
const STATUSES = ['REAL', 'ADVISORY', 'INTEGRATION_REQUIRED', 'VISION', 'UNIMPLEMENTED'];

const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const readJson = (p) => {
  if (!existsSync(p)) throw new Error(`Missing input: ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
};

// ASSUMPTION: schema not verified. Accepts an array, or {items|features|capabilities|entries: []}.
function listOf(doc) {
  if (Array.isArray(doc)) return doc;
  for (const k of ['items', 'features', 'capabilities', 'entries']) if (Array.isArray(doc[k])) return doc[k];
  throw new Error(`Unrecognised parity schema in ${PARITY}: adjust listOf()`);
}
const statusOf = (f) => String(f.status ?? f.classification ?? f.state ?? '').toUpperCase();
const idOf = (f) => f.id ?? f.capability_id ?? f.key;

const parityRaw = readFileSync(PARITY, 'utf8');
const features = listOf(JSON.parse(parityRaw));
const ids = features.map(idOf);
if (ids.some((i) => !i)) throw new Error('Feature without id');
if (new Set(ids).size !== ids.length) throw new Error('Duplicate feature ids');

const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
for (const f of features) {
  const s = statusOf(f);
  if (!(s in counts)) throw new Error(`Unknown status "${s}" on ${idOf(f)}`);
  counts[s]++;
}

// Locales: machine "verified" is NOT human-certified; keep them separate.
const manifest = readJson(MANIFEST);
const cats = Array.isArray(manifest) ? manifest : manifest.catalogs ?? manifest.locales ?? [];
const loc = { total: cats.length, verified: 0, machineDraft: 0, untranslated: 0, other: 0 };
for (const c of cats) {
  const s = String(c.status ?? '').toLowerCase();
  if (s === 'verified') loc.verified++;
  else if (s === 'machine-draft') loc.machineDraft++;
  else if (s === 'untranslated') loc.untranslated++;
  else loc.other++;
}

const provenance = {
  repository: sh('git config --get remote.origin.url').replace(/\/\/[^@/]+@/, '//'), // strip embedded creds
  branch: sh('git rev-parse --abbrev-ref HEAD'),
  commit: sh('git rev-parse HEAD'),
  sourceFile: PARITY,
  sourceSha256: sha256(parityRaw),
};

const body = {
  total: features.length,
  byStatus: counts,
  notReal: features.length - counts.REAL,
  locales: { ...loc, humanCertified: 0, note: 'humanCertified stays 0 until a native-speaker sign-off file exists' },
  features: features.map((f) => ({ id: idOf(f), status: statusOf(f) })),
};
const render = (extra) => JSON.stringify({ generatedBy: 'scripts/generate-truth.mjs', ...extra, ...body }, null, 2) + '\n';

let stale = false;
for (const p of OUT) {
  if (CHECK) {
    if (!existsSync(p)) { stale = true; console.error(`MISSING ${p}`); continue; }
    const cur = JSON.parse(readFileSync(p, 'utf8'));
    // compare bodies only: provenance.commit changes on every commit
    // Preserve provenance and human-certification annotations in the published file.
    // This check validates only the generated fields owned by this script, so stable
    // editorial metadata does not make every CI run report a false stale artifact.
    const localeFields = ['total', 'verified', 'machineDraft', 'untranslated', 'other'];
    const currentLocales = cur.locales ?? {};
    const localesMatch = localeFields.every((key) => currentLocales[key] === loc[key]);
    if (JSON.stringify(cur.byStatus) !== JSON.stringify(body.byStatus) ||
        cur.total !== body.total || !localesMatch || cur.notReal !== body.notReal) {
      stale = true; console.error(`STALE ${p}`);
    }
  } else {
    writeFileSync(p, render({ provenance }));
    console.log(`wrote ${p}`);
  }
}
if (CHECK && stale) process.exit(1);
console.log(JSON.stringify({ total: body.total, ...counts, locales: loc }));

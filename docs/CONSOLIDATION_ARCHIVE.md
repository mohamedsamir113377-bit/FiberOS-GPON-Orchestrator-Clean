# Consolidation archive

The historical consolidation material of this repository lives in its own
repository:

**https://github.com/codespine78-web/GPON-Orchestrator-consolidation-archive**

## Why it is separate

`_consolidation_archive/` was governance material, not release source. It held
byte-identical copies of superseded revisions plus the union-closure evidence
produced by the 2026-10-18 consolidation. Keeping it inside the release tree
had three costs:

- every delivery-archive build had to exclude it explicitly, and the release
  ZIP scope had to be kept byte-aligned with that exclusion;
- repository-wide source gates (`node --check`, secret-pattern scans, i18n
  duplicate checks) had to tolerate a tree of historical, superseded files;
- the release repository carried roughly 96 MB of material that no buyer ever
  receives.

Moving it out removes all three costs without discarding a single byte.

## What was preserved

Every git blob reachable from any ref of this repository - every branch, every
tag, every commit - is present in the archive, byte-identical. The archive's
`INDEX.json` maps each blob SHA-1 to its archive-relative path:

- `<original-path>` for files that already existed as archive copies, for
  example `from-refs/safety/main-20261016/.env.example`;
- `historical-blobs/<sha1>` for historical revisions that had no archive copy
  yet.

The archive repository also keeps the full commit history of
`_consolidation_archive/` (produced with `git subtree split`), so the
consolidation work itself remains reviewable.

## How closure is proven

`scripts/verify-union-closure.js` runs as part of `npm run verify` and in the
release-admission workflow. The property that matters is content that exists
**only outside the main branch's own history**: anything reachable from main's
history is still in the repository by construction, while content that lives
only on a tag or a side branch disappears the moment that ref is deleted.

The gate therefore checks two stable, explicit sets:

1. **The frozen boundary.** `boundaryCommits` in the manifest are the 51 ref
   tips that existed when the archive was extracted. They are frozen in the
   manifest, so the check keeps working even after a ref is deleted.
2. **The live refs.** Every blob reachable from `refs/heads/*`,
   `refs/remotes/origin/*` and `refs/tags/*` that is not in main's history.

A blob is covered when it is reachable from main's history, or preserved in the
external archive manifest, or listed in the manifest's documented exclusion set.
That set is intentionally empty: closure is total. The gate also rejects a
shallow checkout (`fetch-depth: 0` is required in both workflows) instead of
passing vacuously.

A naive "every blob reachable from every ref" rule cannot work: each ordinary
commit makes the previous revision of every changed file historical-only, so
such a gate would fail forever on its own output.

## Retention

The archive is private and is not part of any buyer delivery. Do not delete it:
it is the sole remaining copy of superseded revisions once the source
repository no longer carries `_consolidation_archive/`.

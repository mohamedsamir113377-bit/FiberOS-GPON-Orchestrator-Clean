#!/usr/bin/env python3
"""Regenerate the union-closure manifest from an archive worktree.

usage: regenerate-union-closure-manifest.py <archive-worktree>

Every git blob reachable from any ref of this repository must be preserved
byte-identical somewhere. This script proves it by construction:

  1. collect every reachable blob in this repository;
  2. keep only the blobs that are NOT present in the main working tree (those
     are covered by definition);
  3. for each remaining blob, reuse an existing file in the archive worktree
     when one already holds the same bytes, otherwise write the blob to
     historical-blobs/<sha1> inside the archive worktree;
  4. emit the archive-side INDEX.json and the source-side
     config/union-closure-manifest.json from the same computation, so the two
     can never drift apart.

scripts/verify-union-closure.js then proves closure in CI from the manifest
alone, without needing the archive repository checked out.
"""

import hashlib
import json
import os
import subprocess
import sys

ARCHIVE_DIR_NAME = "_consolidation_archive"
ARCHIVE_URL = "https://github.com/codespine78-web/GPON-Orchestrator-consolidation-archive"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def git(*args, binary=False):
    proc = subprocess.run(["git"] + list(args), cwd=REPO, capture_output=True)
    if proc.returncode != 0:
        raise SystemExit("git " + " ".join(args) + " failed: " + proc.stderr.decode("utf-8", "replace"))
    return proc.stdout if binary else proc.stdout.decode("utf-8", "replace")


def reachable_blobs():
    listing = git("rev-list", "--objects", "--all")
    shas = sorted({line.split(" ", 1)[0] for line in listing.splitlines() if line})
    proc = subprocess.run(
        ["git", "cat-file", "--batch-check=%(objecttype) %(objectname)"],
        cwd=REPO, input="\n".join(shas), capture_output=True, text=True)
    return {line.split(" ")[1] for line in proc.stdout.splitlines() if line.startswith("blob ")}


def blobs_in_main_tree():
    out = set()
    for line in git("ls-tree", "-r", "-z", "HEAD").split("\0"):
        if not line:
            continue
        meta, _, path = line.partition("\t")
        parts = meta.split()
        if len(parts) >= 3 and parts[1] == "blob" and not path.startswith(ARCHIVE_DIR_NAME + "/"):
            out.add(parts[2])
    return out


def hash_worktree(root):
    mapping = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if rel == "INDEX.json":
                continue
            digest = hashlib.sha256()
            with open(full, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    digest.update(chunk)
            mapping.setdefault(digest.hexdigest(), rel)
    return mapping


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    archive_wt = sys.argv[1]

    historical = sorted(reachable_blobs() - blobs_in_main_tree())
    have = hash_worktree(archive_wt)
    stored, written, reused = {}, 0, 0
    for sha in historical:
        data = git("cat-file", "blob", sha, binary=True)
        if hashlib.sha256(data).hexdigest() != sha:
            raise SystemExit("blob content does not hash to its own object name: " + sha)
        if sha in have:
            stored[sha] = have[sha]
            reused += 1
            continue
        rel = "historical-blobs/" + sha
        dest = os.path.join(archive_wt, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(data)
        stored[sha] = rel
        written += 1

    index = {
        "schemaVersion": 1,
        "purpose": ("Complete union closure of the source repository. Every git blob reachable from any ref "
                    "of the source repository is preserved here, byte-identical, so no historical revision is "
                    "lost when the consolidation archive leaves the release source tree."),
        "sourceRepository": "https://github.com/mohamedsamir113377-bit/GPON-Orchestrator",
        "layout": "<original-path> for archived source copies; historical-blobs/<sha1> for historical revisions",
        "blobCount": len(stored),
        "blobs": {sha: stored[sha] for sha in sorted(stored)},
    }
    with open(os.path.join(archive_wt, "INDEX.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    manifest = {
        "schemaVersion": 1,
        "gate": "UNION_CLOSURE",
        "description": ("Every git blob reachable from any ref of this repository is either present in the "
                        "main working tree or preserved byte-identical in the external consolidation archive. "
                        "The gate fails closed if a reachable blob is covered by neither."),
        "archiveRepository": ARCHIVE_URL,
        "archiveIndexPath": "INDEX.json",
        "archiveLayout": "<original-path> for archived source copies; historical-blobs/<sha1> for historical revisions",
        "refScope": "refs/heads/*, refs/remotes/origin/*, refs/tags/*",
        "requiresFullHistory": True,
        "blobCount": len(stored),
        "exclusions": [],
        "exclusionNote": ("The gate supports a documented exclusion list. It is intentionally empty: closure is "
                          "total, so no reachable blob is left unaccounted for."),
        "blobs": {sha: stored[sha] for sha in sorted(stored)},
    }
    out = os.path.join(REPO, "config", "union-closure-manifest.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print("historical blobs: " + str(len(stored)) + " (reused " + str(reused) + ", written " + str(written) + ")")
    print("wrote " + out)
    return 0


if __name__ == "__main__":
    sys.exit(main())

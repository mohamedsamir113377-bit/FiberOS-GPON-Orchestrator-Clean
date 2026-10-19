#!/usr/bin/env python3
"""Deterministic delivery-archive builder — FiberOS R14.1 Sales Core.

Closes audit item #2 (reproducible build stamps): rebuilding the delivery
archive from the same committed tree always yields the byte-identical ZIP and
therefore the same SHA-256 fingerprint.

Determinism controls:
  - entry order    : LC_ALL=C-style lexicographic sort of every entry
  - timestamps     : fixed from SOURCE_DATE_EPOCH for every entry
  - attributes     : fixed external attrs (0644 files, 0755 dirs)
  - compression    : fixed zlib level (9), no extra fields, no data descriptors
  - archive name   : never included as an entry (the growing output file can
                     never end up inside itself)

Usage:
  python3 scripts/build-delivery-archive.py --output FILE.zip \
      --commit <git-commit-sha> [--source-dir DIR]

The buyer verifies by re-running this script against the received tree and
comparing the printed SHA-256 with the fingerprint published by the seller.
"""

import argparse
import hashlib
import json
import os
import sys
import zipfile
from datetime import datetime, timezone

# Release baseline stamp. Fixed forever so the stamp is stable for this
# release; do NOT change it when rebuilding the same release.
SOURCE_DATE_EPOCH = 1790746233  # 2026-09-30 — release baseline (main @ 768a831)
ARCHIVE_ROOT = "FiberOS-R14_1-SALES-CORE-rc1"
ZLIB_LEVEL = 9
POLICY_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "delivery-scope-policy.json")


def load_policy():
    with open(POLICY_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def fixed_dt():
    return datetime.fromtimestamp(SOURCE_DATE_EPOCH, tz=timezone.utc).timetuple()[:6]


def collect(root, out_path, policy):
    entries = []
    excluded_files = set(policy["sourceExclusions"]["files"])
    excluded_dirs = set(policy["sourceExclusions"]["directoryNames"])
    root_dirs = set(policy["sourceExclusions"]["rootDirectories"])
    output_abs = os.path.abspath(out_path)
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        dirnames[:] = [d for d in dirnames if d not in excluded_dirs and not (rel_dir == "." and d in root_dirs)]
        dirnames.sort()
        for name in sorted(dirnames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            entries.append((rel + "/", None))
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if rel in excluded_files or os.path.abspath(full) == output_abs:
                continue
            with open(full, "rb") as fh:
                entries.append((rel, fh.read()))
    entries.sort(key=lambda e: e[0])
    return entries


def build(source_dir, out_path, commit):
    policy = load_policy()
    stamp = datetime.fromtimestamp(SOURCE_DATE_EPOCH, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    stamp_text = (
        "package=FiberOS R14.1 Sales Core\n"
        "build.epoch=%d\n"
        "build.stamp=%s\n"
        "tree.commit=%s\n"
        "rebuild=python3 scripts/build-delivery-archive.py --output out.zip --commit <commit>\n"
        "verify=sha256sum out.zip\n" % (SOURCE_DATE_EPOCH, stamp, commit)
    )

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=ZLIB_LEVEL) as zf:
        for rel, data in collect(source_dir, out_path, policy):
            arc = ARCHIVE_ROOT + "/" + rel
            info = zipfile.ZipInfo(arc, date_time=fixed_dt())
            if data is None:
                info.external_attr = (0o755 << 16) | 0x10  # drwxr-xr-x
                info.compress_type = zipfile.ZIP_STORED
            else:
                info.external_attr = 0o644 << 16  # -rw-r--r--
                info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, data if data is not None else b"")
        info = zipfile.ZipInfo(ARCHIVE_ROOT + "/MANIFEST_BUILD_STAMP.txt", date_time=fixed_dt())
        info.external_attr = 0o644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, stamp_text)

    sha = hashlib.sha256()
    with open(out_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            sha.update(chunk)
    return sha.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-dir", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    parser.add_argument("--commit", required=True, help="source tree git commit recorded in the stamp")
    args = parser.parse_args()

    digest = build(args.source_dir, args.output, args.commit)
    print(args.output)
    print("sha256: " + digest)
    return 0


if __name__ == "__main__":
    sys.exit(main())

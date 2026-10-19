#!/usr/bin/env python3
"""Independently verify a FiberOS delivery archive against the canonical source manifest."""
import argparse
import hashlib
import json
import os
import sys
import zipfile
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POLICY = json.load(open(os.path.join(ROOT, "config", "delivery-scope-policy.json"), encoding="utf-8"))
MANIFEST = json.load(open(os.path.join(ROOT, "SALES_PACKAGE_MANIFEST.json"), encoding="utf-8"))

ARCHIVE_ROOT = POLICY["archive"]["root"] + "/"
STAMP_NAME = ARCHIVE_ROOT + "MANIFEST_BUILD_STAMP.txt"
MANIFEST_NAME = ARCHIVE_ROOT + "SALES_PACKAGE_MANIFEST.json"


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def expected_files():
    mapping = {}
    for rel, digest in MANIFEST.get("sha256ByFile", {}).items():
        mapping[ARCHIVE_ROOT + rel] = digest
    return mapping


def expected_directories(file_names):
    directories = set()
    for name in file_names:
        rel = name[len(ARCHIVE_ROOT):]
        parts = rel.split("/")
        for i in range(1, len(parts)):
            directories.add(ARCHIVE_ROOT + "/".join(parts[:i]) + "/")
    return directories


def safe_member_name(name):
    if not name.startswith(ARCHIVE_ROOT):
        return False
    rel = name[len(ARCHIVE_ROOT):]
    if not rel:
        return False
    if name.startswith("/") or any(part == ".." for part in rel.split("/")):
        return False
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archive")
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()

    expected = expected_files()
    if not expected:
        print("ARCHIVE_MANIFEST_FAIL: manifest has no sha256ByFile entries", file=sys.stderr)
        return 1

    expected_names = set(expected)
    expected_names.add(STAMP_NAME)
    expected_dirs = expected_directories(set(expected))
    expected_manifest_bytes = open(
        os.path.join(ROOT, "SALES_PACKAGE_MANIFEST.json"), "rb"
    ).read()

    try:
        with zipfile.ZipFile(args.archive) as zf:
            infos = zf.infolist()
            names = [info.filename for info in infos]
            duplicates = sorted(name for name, count in Counter(names).items() if count > 1)
            if duplicates:
                print("ARCHIVE_DUPLICATE_ENTRY_FAIL:", file=sys.stderr)
                for name in duplicates:
                    print("duplicate:", name, file=sys.stderr)
                return 1

            unsafe = sorted(name for name in names if not safe_member_name(name))
            if unsafe:
                print("ARCHIVE_PATH_FAIL", file=sys.stderr)
                for name in unsafe:
                    print("unsafe:", name, file=sys.stderr)
                return 1

            actual_dirs = {info.filename for info in infos if info.is_dir()}
            actual_files = {info.filename for info in infos if not info.is_dir()}
            if actual_dirs != expected_dirs:
                print("ARCHIVE_DIRECTORY_SCOPE_FAIL", file=sys.stderr)
                print("missing:", sorted(expected_dirs - actual_dirs), file=sys.stderr)
                print("unexpected:", sorted(actual_dirs - expected_dirs), file=sys.stderr)
                return 1

            if actual_files != expected_names:
                print("ARCHIVE_FILE_SCOPE_FAIL", file=sys.stderr)
                print("missing:", sorted(expected_names - actual_files), file=sys.stderr)
                print("unexpected:", sorted(actual_files - expected_names), file=sys.stderr)
                return 1

            archived_manifest = zf.read(MANIFEST_NAME)
            if archived_manifest != expected_manifest_bytes:
                print("ARCHIVE_MANIFEST_CONTENT_FAIL: archive manifest differs from verified source manifest", file=sys.stderr)
                return 1

            for archive_name, expected_digest in expected.items():
                if archive_name == MANIFEST_NAME:
                    if expected_digest != "SELF_REFERENTIAL_NOT_HASHED":
                        print("ARCHIVE_MANIFEST_SELF_MARKER_FAIL", file=sys.stderr)
                        return 1
                    continue
                if not isinstance(expected_digest, str) or len(expected_digest) != 64:
                    print(f"ARCHIVE_MANIFEST_HASH_FORMAT_FAIL: {archive_name}", file=sys.stderr)
                    return 1
                actual_digest = sha256_bytes(zf.read(archive_name))
                if actual_digest.lower() != expected_digest.lower():
                    print(
                        f"ARCHIVE_CONTENT_HASH_FAIL: {archive_name} "
                        f"(manifest={expected_digest} archive={actual_digest})",
                        file=sys.stderr,
                    )
                    return 1

            stamp = zf.read(STAMP_NAME).decode("utf-8")
            commit_line = f"tree.commit={args.commit}"
            if commit_line not in stamp.splitlines():
                print("ARCHIVE_STAMP_FAIL: commit is not recorded in generated stamp", file=sys.stderr)
                return 1

            if not any(
                line.startswith("build.stamp=") for line in stamp.splitlines()
            ):
                print("ARCHIVE_STAMP_FAIL: generated build stamp is missing build.stamp", file=sys.stderr)
                return 1

            actual_hash = sha256_bytes(open(args.archive, "rb").read())
            print(
                f"DELIVERY_ARCHIVE PASS: {len(infos)} entries, "
                f"{len(actual_files)} files, sha256={actual_hash}"
            )
            return 0
    except (OSError, zipfile.BadZipFile, KeyError, UnicodeDecodeError) as exc:
        print(f"ARCHIVE_READ_FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

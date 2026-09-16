"""Preserve and verify the exact tracked v0.1 tree without modifying Git state."""

from __future__ import annotations

import argparse
import hashlib
import io
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

from json_format import json_bytes, strict_json

from repository import AV_ROOT, REPO_ROOT

ROOT = REPO_ROOT
REVISION = "bec38fcfc65960cf2f0ac6c0befd2b4eaabb5db2"
SNAPSHOT = AV_ROOT / "support" / "history" / "v0.1-proposed"
MANIFEST = AV_ROOT / "support" / "history" / "v0.1-proposed.original-manifest.json"
INDEX = AV_ROOT / "support" / "history" / "v0.1-proposed.index.md"


def git(*arguments):
    return subprocess.check_output(["git", "--no-pager", *arguments], cwd=ROOT)


def verify_snapshot() -> int:
    manifest = strict_json(MANIFEST.read_bytes())
    expected = {item["path"]: item for item in manifest["files"]}
    actual = {path.relative_to(SNAPSHOT).as_posix() for path in SNAPSHOT.rglob("*") if path.is_file()}
    if actual != set(expected):
        raise ValueError("Historical snapshot file membership differs; do not overwrite it")
    for name, item in expected.items():
        data = SNAPSHOT.joinpath(*PurePosixPath(name).parts).read_bytes()
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError("Historical snapshot bytes differ; do not overwrite: " + name)
        blob = b"blob " + str(len(data)).encode("ascii") + b"\0" + data
        if hashlib.sha1(blob).hexdigest() != item["gitBlob"]:
            raise ValueError("Historical Git blob differs: " + name)
    return len(expected)


def preserve() -> int:
    head = git("rev-parse", "HEAD").decode("ascii").strip()
    if head != REVISION:
        raise ValueError("The reviewed historical HEAD changed; stop for an explicit archive decision")
    tracked = {}
    for record in git("ls-tree", "-r", "-z", REVISION).split(b"\0"):
        if not record:
            continue
        entry, name = record.split(b"\t", 1)
        mode, kind, blob = entry.decode("ascii").split()
        name = name.decode("utf-8")
        if kind != "blob" or mode not in {"100644", "100755"}:
            raise ValueError("Unsupported historical tree entry: " + name)
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or ".git" in path.parts:
            raise ValueError("Unsafe historical path: " + name)
        tracked[name] = (mode, blob)
    with zipfile.ZipFile(io.BytesIO(git("archive", "--format=zip", REVISION))) as archive:
        files = {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}
    if set(files) != set(tracked):
        raise ValueError("git archive did not include the complete tracked tree")
    records = []
    for name, data in sorted(files.items()):
        mode, expected_blob = tracked[name]
        blob = b"blob " + str(len(data)).encode("ascii") + b"\0" + data
        if hashlib.sha1(blob).hexdigest() != expected_blob:
            raise ValueError("git archive altered tracked bytes: " + name)
        records.append({
            "path": name, "mode": mode, "gitBlob": expected_blob,
            "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
        })
    manifest = json_bytes({
        "release": "0.1-proposed",
        "commit": REVISION,
        "snapshot": "archive/v0.1-proposed",
        "method": "git archive of the complete tracked HEAD tree; no .git directory",
        "excluded": "Uncommitted README, new research document and ignored local-only content",
        "hashAlgorithm": "SHA-256 of original representation octets; original Git blob IDs also retained",
        "files": records,
    })
    index = (
        "# Historical WoT AV 0.1-proposed\n\n"
        f"Exact tracked tree at `{REVISION}`, copied with `git archive` before the breaking "
        "0.2 migration. The snapshot contains its original specification, tools, tests, "
        "release manifest and third-party notices, without a `.git` directory.\n\n"
        "The uncommitted README and new research document were deliberately excluded. "
        "No ignored or private local-only tree was copied. Historical bytes must not be "
        "formatted, regenerated or resealed from the active draft.\n\n"
        "See [the original-byte manifest](v0.1-proposed.original-manifest.json) and "
        "[the original specification](v0.1-proposed/spec.md). "
        "`python -B tools\\archive_v01.py --check` checks every archived byte against "
        "the original SHA-256 and Git blob hashes.\n"
    ).encode("utf-8")
    if SNAPSHOT.exists():
        actual = {path.relative_to(SNAPSHOT).as_posix(): path.read_bytes()
                  for path in SNAPSHOT.rglob("*") if path.is_file()}
        if actual != files:
            raise ValueError("Existing historical snapshot differs; STOP, never overwrite it")
    for target, content in ((MANIFEST, manifest), (INDEX, index)):
        if target.exists() and target.read_bytes() != content:
            raise ValueError("Existing historical index/manifest differs; STOP: " + str(target))
    if not SNAPSHOT.exists():
        SNAPSHOT.mkdir(parents=True)
        for name, data in files.items():
            target = SNAPSHOT.joinpath(*PurePosixPath(name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    MANIFEST.write_bytes(manifest)
    INDEX.write_bytes(index)
    return verify_snapshot()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    count = verify_snapshot() if args.check else preserve()
    print(f"Exact historical snapshot verified: {count} files at {REVISION}")


if __name__ == "__main__":
    main()

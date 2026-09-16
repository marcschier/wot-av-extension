"""Offline verification only: never fetch, install, configure or execute SDK code."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess


LOCK = Path(__file__).with_name("sources.lock.json")


def git(root, *args):
    return subprocess.check_output(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
         "-C", str(root), *args], stderr=subprocess.PIPE, timeout=30)


def verify_source(root, pin):
    root = root.resolve(strict=True)
    if Path(os.fsdecode(git(root, "rev-parse", "--show-toplevel")).strip()).resolve() != root:
        raise ValueError("Source must be a separate, complete upstream Git checkout")
    if git(root, "rev-parse", "HEAD").decode().strip() != pin["commit"]:
        raise ValueError("Aravis commit differs from source lock")
    if git(root, "rev-parse", "HEAD^{tree}").decode().strip() != pin["tree"]:
        raise ValueError("Aravis tree differs from source lock")
    if git(root, "ls-files", "--others", "-z"):
        raise ValueError("Source checkout contains untracked files; build outside it")
    entries = git(root, "ls-tree", "-rz", "--full-tree", "HEAD").split(b"\0")
    for entry in filter(None, entries):
        attributes, name = entry.split(b"\t", 1)
        mode, kind, digest = attributes.split()
        relative = os.fsdecode(name)
        path = root / relative
        if kind != b"blob" or mode not in (b"100644", b"100755", b"120000"):
            raise ValueError(f"Unsupported source entry (no submodule fetch): {relative}")
        if not path.resolve().is_relative_to(root):
            raise ValueError(f"Source entry escapes checkout: {relative}")
        if mode == b"120000":
            if not path.is_symlink():
                raise ValueError(f"Source symlink changed: {relative}")
            data = os.fsencode(os.readlink(path))
        else:
            file_mode = path.lstat().st_mode
            if not stat.S_ISREG(file_mode):
                raise ValueError(f"Source entry is not a regular file: {relative}")
            if os.name == "posix" and bool(file_mode & 0o111) != (mode == b"100755"):
                raise ValueError(f"Source executable mode changed: {relative}")
            data = path.read_bytes()
        actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if actual != digest.decode():
            raise ValueError(f"Source blob differs from locked tree: {relative}")
    for relative, expected in pin["files"].items():
        if hashlib.sha256((root / relative).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Pinned source/license SHA-256 mismatch: {relative}")
    return len(entries) - 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--print-pin", action="store_true")
    args = parser.parse_args()
    pin = json.loads(LOCK.read_text(encoding="utf8"))["aravis"]
    if args.print_pin and args.source is None:
        print(pin["repository"], pin["commit"], pin["version"], sep="\n")
        return
    if args.source is None or args.print_pin:
        parser.error("choose --source CHECKOUT or --print-pin")
    try:
        count = verify_source(args.source, pin)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Aravis source verification failed: {error}\n")
    print(f"Verified {count} source blobs: Aravis {pin['version']} commit {pin['commit']}; not build/runtime proof")


if __name__ == "__main__":
    main()

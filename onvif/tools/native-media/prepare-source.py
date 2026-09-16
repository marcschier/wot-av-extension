"""Verify pristine locked inputs, copy them to the build, and apply the private patch."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess

from native_paths import NATIVE_ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--build", type=Path, required=True)
    args = parser.parse_args()
    project = NATIVE_ROOT
    build = args.build.resolve(strict=True)
    if build == project or not build.is_relative_to(project):
        parser.error("The P0 build directory must be below onvif\\samples\\reference-runtime\\native-media")
    source = args.source.resolve(strict=True)
    lock = json.loads((project / "sources.lock.json").read_text())
    destination = build / "upstream"
    for name, expected in lock["gitBlobs"].items():
        relative = Path(*PurePosixPath(name).parts)
        data = (source / relative).read_bytes()
        actual = hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()
        if actual != expected:
            raise ValueError(f"Pristine source mismatch: {name}")
        output = destination / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, output)
    environment = dict(os.environ, GIT_CEILING_DIRECTORIES=str(build))
    for name in ("classic-rtsp-p0.patch", "classic-media-v2.patch"):
        patch_bytes = (project / "patches" / name).read_bytes().replace(b"\r\n", b"\n")
        for check in (True, False):
            command = ["git", "--no-pager", "apply", "--recount", "--whitespace=error"]
            if check:
                command.append("--check")
            subprocess.run(command + ["-"], input=patch_bytes,
                cwd=destination, env=environment, check=True)
    print(f"Verified source pin and applied private scoped media patches: {destination}")


if __name__ == "__main__":
    main()

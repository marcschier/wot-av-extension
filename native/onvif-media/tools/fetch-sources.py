"""Fetch only locked public RTSP build inputs; never execute upstream build scripts."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--task-root",
        type=Path,
        default=Path(os.environ["TEMP"]) / "acf-media-research" / "onvif-native-p0-64c41574",
    )
    args = parser.parse_args()
    root = args.task_root.resolve(strict=True)
    allowed = (Path(os.environ["TEMP"]) / "acf-media-research").resolve(strict=True)
    if root.parent != allowed or not root.name.startswith("onvif-native-p0-"):
        parser.error("Use a named onvif-native-p0-* task-local TEMP directory")
    if not (root / ".onvif-native-p0").is_file():
        parser.error("The task ownership marker is missing")
    lock = json.loads((Path(__file__).resolve().parents[1] / "sources.lock.json").read_text())
    audit = {"commit": lock["commit"], "files": {}}
    for name, expected in lock["gitBlobs"].items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name:
            raise ValueError(f"Invalid locked source path: {name}")
        destination = root / "upstream" / Path(*relative.parts)
        url = f"https://raw.githubusercontent.com/GStreamer/gstreamer/{lock['commit']}/{name}"
        if destination.exists():
            data = destination.read_bytes()
        else:
            result = subprocess.run(
                [
                    "curl.exe", "--fail", "--silent", "--show-error",
                    "--proto", "=https", "--tlsv1.2", "--max-time", "30",
                    "--max-redirs", "0", "--max-filesize", str(1024 * 1024),
                    "--url", url,
                ],
                check=True, stdout=subprocess.PIPE, timeout=40,
            )
            data = result.stdout
        if len(data) > 1024 * 1024:
            raise ValueError(f"Source exceeds the 1 MiB per-file limit: {name}")
        blob = hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()
        if blob != expected:
            raise ValueError(f"Locked Git blob mismatch for {name}; source not accepted")
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            destination.write_bytes(data)
        audit["files"][name] = {
            "url": url,
            "gitBlob": blob,
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
        }
    output = root / "source-audit.json"
    output.write_text(json.dumps(audit, indent=4) + "\n", encoding="ascii")
    print(f"Verified {len(audit['files'])} pinned source files: {output}")


if __name__ == "__main__":
    main()

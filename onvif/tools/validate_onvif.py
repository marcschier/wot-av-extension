"""Check offline ONVIF inputs/generation; native-wire fixture suites require explicit opt-in."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

if __package__:
    from .repository import REPO_ROOT as ROOT
else:
    from repository import REPO_ROOT as ROOT
SUITES = ("unit", "catalog", "binding-gate", "events", "discovery", "publication", "media", "integration")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", action="append", choices=SUITES, default=[], help="Repeat for composed Node suites")
    parser.add_argument("--allow-loopback", action="store_true", help="Permit the independently owned 127/8 SOAP/UDP/Directory fixtures, never real devices")
    args = parser.parse_args()
    if len(set(args.suite)) != len(args.suite):
        parser.error("Select each suite only once")
    if set(args.suite) - {"unit", "catalog"} and not args.allow_loopback:
        parser.error("Wire/discovery/publication/media/integration fixtures require --allow-loopback")
    node = shutil.which("node")
    if node is None:
        parser.error("Node >=20.19 must be on PATH; no download or global installation is performed")
    environment = {key: value for key, value in os.environ.items() if key.upper() not in {"NODE_PATH", "NODE_OPTIONS"}}
    commands = [
        [sys.executable, "-B", str(ROOT / "onvif" / "tools" / "fetch_onvif_sources.py"), "--check", "--scope", "vendored"],
        [sys.executable, "-B", "-m", "unittest", "discover", "-s", str(ROOT / "onvif" / "tools" / "tests" / "sources"), "-p", "test_*.py"],
        [node, str(ROOT / "node_modules" / "typescript" / "bin" / "tsc"), "-p", str(ROOT / "onvif" / "samples" / "reference-runtime" / "tsconfig.json")],
        [node, str(ROOT / "onvif" / "tools" / "generate-onvif.cjs"), "--check"],
        [node, str(ROOT / "onvif" / "tools" / "stage-onvif-package.cjs")],
        [sys.executable, "-B", str(ROOT / "onvif" / "tools" / "generate_onvif.py"), "--check"]
    ]
    if args.suite:
        commands.append([node, str(ROOT / "onvif" / "tools" / "tests" / "reference-runtime" / "run.cjs"), *args.suite])
    for command in commands:
        print("+ " + subprocess.list2cmdline(command), flush=True)
        subprocess.run(command, cwd=ROOT, env=environment, check=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.CalledProcessError) as error:
        print("ONVIF validation failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)

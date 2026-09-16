"""Explicit operator-only, exact-target identity/current-mode observation."""
import argparse
import json
import pathlib
import struct
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", required=True)
    parser.add_argument("--backend", required=True,
                        choices=["linux-v4l2", "aravis-gige", "aravis-usb3", "aravis-fake"])
    parser.add_argument("--selection-file", required=True,
                        help="Private file containing one V4L2 path, or the finite Aravis selector JSON")
    permissions = parser.add_mutually_exclusive_group(required=True)
    permissions.add_argument("--permit-native-read", action="store_true")
    permissions.add_argument("--permit-control-probe", action="store_true")
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("requires an explicitly approved Linux host; no WSL/Docker startup is performed")
    if args.backend == "linux-v4l2":
        if not args.permit_native_read:
            parser.error("V4L2 requires --permit-native-read")
        selector = pathlib.Path(args.selection_file).read_text(encoding="utf8").strip()
        token = "permit-native-read"
    else:
        if not args.permit_control_probe:
            parser.error("Aravis constructors can write/claim control; --permit-control-probe is required")
        selector = json.dumps(json.loads(pathlib.Path(args.selection_file).read_text(encoding="utf8")),
                              ensure_ascii=False, separators=(",", ":"))
        token = "permit-control-probe"
    if not selector or len(selector.encode("utf8")) > 8192:
        parser.error("selection must be nonempty and at most 8192 UTF-8 bytes")
    request = f"identify\t{args.backend}\t{selector.encode('utf8').hex()}\t{token}\nclose\n"
    result = subprocess.run([args.worker, "--stdio"], input=request.encode("ascii"),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=False)
    if result.stderr:
        raise RuntimeError("native SDK emitted diagnostics; private diagnostics are not copied")
    records = []
    at = 0
    while at < len(result.stdout):
        if len(result.stdout)-at < 8:
            raise RuntimeError("truncated packet header")
        metadata, payload = struct.unpack_from("<II", result.stdout, at)
        at += 8
        if not 2 <= metadata <= 65536 or payload or at+metadata > len(result.stdout):
            raise RuntimeError("invalid evidence packet")
        records.append(json.loads(result.stdout[at:at+metadata].decode("utf8", errors="strict")))
        at += metadata
    # Preserve evidence alongside truthful cleanup. In particular, USB release
    # cannot be checked through stock Aravis and must not look successful.
    print(json.dumps({"observations": records, "workerExitCode": result.returncode,
                      "hardwareQualification": False}, indent=2))
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())

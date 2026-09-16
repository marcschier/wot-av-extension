"""Run every configured CTest target once, rejecting stale or mixed-build evidence."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

from gate import binary_inventory
from codec_fixture import TOOL_PLUGINS


EXPECTED_TESTS = {
    "p0.digest", "p0.metadata", "p0.loopback", "media.metadata",
    "media.jpeg", "media.loopback", "media.codecs",
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint(values):
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode("utf8")).hexdigest()


def snapshot(project, build, sdk):
    sources = {}
    for directory in ("src", "test", "patches", "tools", "cmake"):
        for path in sorted((project / directory).rglob("*")):
            if path.is_file() and path.suffix in (".c", ".h", ".py", ".ps1", ".patch", ".json", ".in", ".cjs"):
                sources[str(path.relative_to(project))] = sha256(path)
    for name in ("CMakeLists.txt", "dependencies.lock.json", "sources.lock.json"):
        sources[name] = sha256(project / name)
    binaries = binary_inventory(build / "bin" / "onvif_media_worker.exe")
    for path in sorted((build / "bin").glob("*.exe")):
        binaries.setdefault(str(path.relative_to(build)), {"sha256": sha256(path), "bytes": path.stat().st_size})
    for path in sorted((build / "gio").glob("*.dll")):
        binaries[str(path.relative_to(build))] = {"sha256": sha256(path), "bytes": path.stat().st_size}
    sdk_files = list((sdk / "bin").glob("*.dll"))
    sdk_files += [sdk / relative for relative in (
        r"include\gstreamer-1.0\gst\gst.h", r"include\gstreamer-1.0\gst\gstversion.h",
        r"include\glib-2.0\glib.h", r"lib\glib-2.0\include\glibconfig.h",
        r"include\libxml2\libxml\xmlversion.h", r"lib\gio\modules\gioopenssl.dll",
    )]
    for name in ("gstreamer-1.0", "gstbase-1.0", "gstapp-1.0", "gstrtp-1.0",
            "gstsdp-1.0", "gstnet-1.0", "gstvideo-1.0", "gstaudio-1.0",
            "gio-2.0", "gobject-2.0", "glib-2.0", "xml2"):
        sdk_files.append(sdk / "lib" / (name + ".lib"))
    for plugin in sorted((build / "plugins").glob("*.dll")):
        if plugin.name != "gstrtsp.dll":
            original = sdk / "lib" / "gstreamer-1.0" / plugin.name
            if sha256(original) != sha256(plugin):
                raise ValueError(f"Private bundle differs from selected SDK: {plugin.name}")
            sdk_files.append(original)
    sdk_files.extend(sdk / "lib" / "gstreamer-1.0" / (name + ".dll") for name in TOOL_PLUGINS)
    sdk_files.extend(sdk / "bin" / name for name in ("gst-inspect-1.0.exe", "gst-launch-1.0.exe"))
    if sha256(sdk / "lib" / "gio" / "modules" / "gioopenssl.dll") != sha256(build / "gio" / "gioopenssl.dll"):
        raise ValueError("Private TLS module differs from selected SDK")
    sdk_inputs = {str(path.relative_to(sdk)): sha256(path) for path in sorted(sdk_files)}
    return dict(sourceInputs=sources, sourceFingerprint=fingerprint(sources),
        nativeBinaries=binaries, sdkInputs=sdk_inputs, sdkFingerprint=fingerprint(sdk_inputs),
        ctestConfigurationSha256=sha256(build / "CTestTestfile.cmake"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-root", type=Path, required=True)
    parser.add_argument("--sdk-root", type=Path, required=True)
    parser.add_argument("--sdk-archive", type=Path)
    parser.add_argument("--ctest", default="ctest")
    args = parser.parse_args()
    if sys.flags.optimize:
        parser.error("Qualification requires Python assertions; disable Python optimization.")
    project = Path(__file__).resolve().parents[1]
    build, sdk = args.build_root.resolve(strict=True), args.sdk_root.resolve(strict=True)
    if build == project or not build.is_relative_to(project):
        parser.error("Build and reports must remain below the owned native directory.")
    cache = {}
    for line in (build / "CMakeCache.txt").read_text().splitlines():
        match = re.match(r"([^:#]+):[^=]+=(.*)", line)
        if match:
            cache[match[1]] = match[2]
    if Path(cache["P0_GSTREAMER_ROOT"]).resolve() != sdk:
        parser.error("CTest and this cohort must use the same explicit SDK.")
    archive = None
    if args.sdk_archive:
        actual = sha256(args.sdk_archive)
        expected = json.loads((project / "dependencies.lock.json").read_text())["gstreamer"]["installer"]["sha256"]
        if actual != expected:
            parser.error("Cached SDK archive does not match the approved lock; nothing was executed.")
        archive = {"path": str(args.sdk_archive.resolve()), "sha256": actual, "lockMatched": True}
    upstream = Path(cache["P0_UPSTREAM_ROOT"])
    upstream_inputs = {}
    source_lock = json.loads((project / "sources.lock.json").read_text())
    for relative, expected in source_lock["gitBlobs"].items():
        path = upstream.joinpath(*relative.split("/"))
        data = path.read_bytes()
        if hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest() != expected:
            parser.error(f"Pristine upstream pin changed: {relative}")
        upstream_inputs[relative] = hashlib.sha256(data).hexdigest()
    before = snapshot(project, build, sdk)
    environment = dict(os.environ, PATH=str(sdk / "bin") + os.pathsep + os.environ.get("PATH", ""))
    inventory = subprocess.run([str(build / "bin" / "onvif_media_worker.exe"), "--inventory"],
        env=environment, capture_output=True, text=True, check=True, timeout=15)
    started_ns = time.time_ns()
    started_utc = datetime.now(timezone.utc).isoformat()
    junit = build / "final-cohort-ctest.xml"
    command = [args.ctest, "--test-dir", str(build), "--output-on-failure",
        "--output-junit", str(junit), "--output-log", str(build / "final-cohort-ctest.log")]
    failures, ctest_rows, suites = [], [], {}
    try:
        completed = subprocess.run(command, timeout=600)
        code = completed.returncode
    except subprocess.TimeoutExpired:
        code = -1
        failures.append("The bounded whole-cohort CTest deadline expired.")
    if code:
        failures.append(f"CTest exited {code}; no passing subset is substituted.")
    after = snapshot(project, build, sdk)
    if before != after:
        failures.append("Functional sources, binaries, SDK or CTest configuration changed during the cohort.")
    if not junit.is_file() or junit.stat().st_mtime_ns < started_ns:
        failures.append("Fresh CTest JUnit evidence is missing.")
    else:
        for row in ET.parse(junit).getroot().iter("testcase"):
            output = row.findtext("system-out", "")
            passed = (row.find("failure") is None and row.find("error") is None and
                row.find("skipped") is None and row.get("status", "run") not in ("notrun", "disabled"))
            ctest_rows.append(dict(name=row.get("name"), passed=passed, seconds=float(row.get("time", "0")),
                namedChecks=re.findall(r"^ok \d+ (/\S+)", output, re.M)))
        if {row["name"] for row in ctest_rows} != EXPECTED_TESTS or not all(row["passed"] for row in ctest_rows):
            failures.append("Every expected CTest target must run and pass, with no skips.")
    for name, filename in (("p0", "qualification.json"), ("runtime", "runtime-qualification.json"),
            ("codecs", "codec-qualification.json")):
        path = build / filename
        if not path.is_file() or path.stat().st_mtime_ns < started_ns:
            failures.append(f"Fresh complete {name} evidence is missing.")
            continue
        result = json.loads(path.read_text(encoding="utf8"))
        rows = result["cases"]
        passed = sum(row.get("pass", row.get("status") == "pass") for row in rows.values())
        expected_worker = "p0_fixture_worker.exe" if name == "p0" else "onvif_media_worker.exe"
        expected_hash = before["nativeBinaries"][str(Path("bin") / expected_worker)]["sha256"]
        if result.get("selection") != "all" or result.get("workerSha256") != expected_hash or passed != len(rows):
            failures.append(f"{name} must be ALL, complete, and from this cohort's measured worker.")
        if not result.get("workerStable", True):
            failures.append(f"{name} worker changed during execution.")
        suites[name] = dict(report=filename, reportSha256=sha256(path), passed=passed,
            total=len(rows), caseNames=list(rows), workerSha256=result["workerSha256"])
    report = dict(scope="single-unfiltered-current-native-CTest-cohort", startedUtc=started_utc,
        completedUtc=datetime.now(timezone.utc).isoformat(), pass_=not failures, failures=failures,
        ctestCommand=command, ctestExit=code, ctest=ctest_rows, suites=suites,
        stableInputs=before == after, **before, inventory=json.loads(inventory.stdout),
        sdkRoot=str(sdk), sdkArchive=archive, upstreamRoot=str(upstream),
        upstreamCommit=source_lock["commit"], upstreamSha256=upstream_inputs,
        tools=dict(python=sys.version, cmakeCompiler=cache["CMAKE_C_COMPILER"],
            ninja=cache["CMAKE_MAKE_PROGRAM"], node=cache["P0_NODE_EXECUTABLE"]),
        hardwareTested=False, networkScope="owned Python-stdlib 127.0.0.1/127.0.0.2 fixtures only",
        certification=False, distributionApproved=False)
    report["pass"] = report.pop("pass_")
    destination = build / "final-cohort.json"
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(f"Cohort {'PASS' if report['pass'] else 'FAIL'}: {len(ctest_rows)} CTest targets; {destination}")
    for failure in failures:
        print(f"FAIL: {failure}")
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

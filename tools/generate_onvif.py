"""Inventory ONVIF authored delivery inputs separately from AV and canonical generation."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
EXTENSIONS = {".ts", ".cjs", ".json", ".jsonld", ".toml", ".xml", ".wsdl", ".xsd",
              ".ttl", ".c", ".h", ".in", ".patch", ".ps1", ".py", ".md", ".txt",
              ".yml", ".yaml"}


def expected_manifest():
    ownership = json.loads((ROOT / "publication-ownership.json").read_bytes())
    if ownership["schemaVersion"] != 1:
        raise ValueError("Unsupported publication ownership version")
    files = set(ownership["onvifAuthoredFiles"] + ownership["sharedAuthoredFiles"])
    excluded = set(ownership["excludedBuildDirectoryNames"])
    for relative in ownership["onvifAuthoredRoots"]:
        directory = ROOT.joinpath(*relative.split("/"))
        if not directory.is_dir():
            raise ValueError("Missing authored ONVIF directory: " + relative)
        for path in directory.rglob("*"):
            parts = path.relative_to(ROOT).parts
            if any(part in excluded for part in parts):
                continue
            if path.is_symlink():
                raise ValueError("Symlink in authored ONVIF inputs: " + str(path))
            if path.is_file() and (path.suffix in EXTENSIONS or path.name in {".gitignore", ".gitattributes", "CMakeLists.txt"}):
                files.add(path.relative_to(ROOT).as_posix())
    for pattern in ownership["onvifAuthoredGlobs"]:
        for path in ROOT.glob(pattern):
            if path.is_file():
                files.add(path.relative_to(ROOT).as_posix())
    if set(ownership["avGeneratedFiles"]).intersection(files):
        raise ValueError("ONVIF authored inventory must not take ownership of AV generated files")
    if any(name.startswith(tuple(tree + "/" for tree in ownership["preservedUnownedTrees"])) for name in files):
        raise ValueError("A protected archive/vendor/private tree entered ONVIF authored ownership")

    def record(name):
        path = ROOT.joinpath(*name.split("/"))
        if not path.is_file() or path.is_symlink():
            raise ValueError("Missing or symlinked authored input: " + name)
        data = path.read_bytes()
        return {"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    generated_name = ownership["onvifCanonicalManifest"]
    generated = json.loads(ROOT.joinpath(*generated_name.split("/")).read_bytes())
    generated_paths = {entry["path"] for entry in generated["artifacts"]}
    if set(ownership["avGeneratedFiles"]).intersection("bindings/onvif/" + name for name in generated_paths):
        raise ValueError("Canonical ONVIF and AV output ownership overlaps")
    lock = json.loads((ROOT / "bindings" / "onvif" / "sources.lock.json").read_bytes())
    return {
        "schemaVersion": 1,
        "scope": "Local authored ONVIF implementation/delivery inventory; no AV regeneration, archive rehash, site, registry or binary publication.",
        "hashAlgorithm": "SHA-256 of complete representation bytes; self hash excluded",
        "generationCommand": ownership["onvifPublicationGenerator"],
        "validationCommand": "python -B tools/validate_onvif.py",
        "avOwnership": {"manifest": "release-manifest.json", "outputs": ownership["avGeneratedFiles"],
                        "verification": "python -B tools/validate.py; regenerate only after all shared documentation is stable"},
        "canonicalGeneration": {**record(generated_name), "artifactsIncludingManifest": len(generated["artifacts"]) + 1,
                                "registryDigest": generated["registryDigest"], "sourceLockDigest": generated["sourceLockDigest"]},
        "sourcePolicy": {"lock": "bindings/onvif/sources.lock.json",
                        "verify": "python -B tools/fetch_onvif_sources.py --check --scope vendored",
                        "vendoredDocuments": sum(source["storage"] == "vendored" for source in lock["sources"]),
                        "restrictedFetchOnlyIds": [source["id"] for source in lock["sources"] if source["storage"] == "fetch-only"],
                        "profilePdfsBundled": False, "sourceDocumentsWritten": False},
        "publication": {"firstPartyLicenseSelected": False, "distributionApproved": False,
                        "nativeBinaryApproved": False, "certificationEstablished": False},
        "files": [record(name) for name in sorted(files)]
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare exact manifest bytes without writing")
    args = parser.parse_args()
    value = expected_manifest()
    data = (json.dumps(value, indent=4, ensure_ascii=True) + "\n").encode("utf8")
    output = ROOT / "onvif-release-manifest.json"
    if args.check:
        if not output.is_file() or output.read_bytes() != data:
            raise ValueError("ONVIF publication inventory is stale; after authors finish, run python -B tools/generate_onvif.py")
    else:
        output.write_bytes(data)
    print(json.dumps({"result": "verified" if args.check else "generated",
                      "authoredFiles": len(value["files"]), "canonicalArtifacts": value["canonicalGeneration"]["artifactsIncludingManifest"],
                      "avOutputsWritten": 0, "distributionApproved": False}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        print("ONVIF publication inventory error: " + str(error), file=sys.stderr)
        raise SystemExit(1)

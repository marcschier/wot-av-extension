"""Audit physical preservation and explicitly registered specification evolution."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

from repository import AV_ROOT, REPO_ROOT, RUNTIME_ROOT

PUBLICATION = AV_ROOT / "support" / "publication"
LEDGER = PUBLICATION / "relocation-plan.json"
LEDGER_SHA256 = "f6a84a879a4dc196a3c8965ae0bc5848331a440f245311a143030ebc04248cd7"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*arguments):
    return subprocess.check_output(["git", "--no-pager", *arguments], cwd=REPO_ROOT)


def original(entry):
    return git("cat-file", "blob", entry["gitBlob"])


def path(name):
    parts = name.split("/")
    if any(part in ("", ".", "..") or "\\" in part or ":" in part for part in parts):
        raise ValueError("Unsafe repository coordinate: " + name)
    target = REPO_ROOT.joinpath(*parts)
    if target.is_symlink() or not target.resolve().is_relative_to(REPO_ROOT):
        raise ValueError("Symlink or escaped relocation target: " + name)
    return target


def require(condition, message):
    if not condition:
        raise ValueError(message)


def normalized(value, replacements):
    if isinstance(value, dict):
        return {key: normalized(item, replacements) for key, item in value.items()}
    if isinstance(value, list):
        return [normalized(item, replacements) for item in value]
    return replacements.get(value, value) if isinstance(value, str) else value


def verify_path_only(ledger, *, package=False):
    require(sha(LEDGER.read_bytes()) == LEDGER_SHA256, "Frozen ledger bytes changed")
    require(git("rev-parse", "HEAD").decode().strip() == ledger["baseline"]["commit"],
            "Relocation-phase HEAD differs from the approved baseline")
    require(not git("diff", "--cached", "--name-only"), "Relocation must not change the Git index")
    entries = ledger["entries"]
    require(len(entries) == 909, "Frozen original inventory is not 909")
    index = {}
    for record in git("ls-files", "--stage", "-z").split(b"\0"):
        if record:
            meta, name = record.decode().split("\t")
            mode, blob, stage = meta.split()
            require(stage == "0", "Unmerged Git index entry: " + name)
            index[name] = (mode, blob)
    require(index == {e["originalPath"]: (e["originalMode"], e["gitBlob"]) for e in entries},
            "Original modes/blobs or index membership changed")
    changes, exact, protected = [], 0, 0
    for entry in entries:
        name = entry["destinationPath"]
        target = path(name)
        require(target.is_file(), "Missing relocated original: " + name)
        content = target.read_bytes()
        current_sha = sha(content)
        unchanged = len(content) == entry["bytes"] and current_sha == entry["sha256"]
        if not entry["transformsAllowed"]:
            require(unchanged, "Protected representation changed: " + name)
            protected += 1
        exact += unchanged
        if entry["originalPath"] not in (name, "readme.md"):
            require(not path(entry["originalPath"]).exists(),
                    "An original runtime file remains at its old path: " + entry["originalPath"])
        if not unchanged:
            require(bool(entry["transformsAllowed"]), "Unapproved transformation: " + name)
            changes.append({
                "originalPath": entry["originalPath"], "destinationPath": name,
                "originalSha256": entry["sha256"], "bytes": len(content), "sha256": current_sha,
                "transformKinds": entry["transformsAllowed"],
                "reason": "Active physical coordinates, owning-tool output metadata or dependency workspace coordinates only.",
                "validationGates": entry["validationGates"],
            })
    require(protected == 290, "Exact-only protection count changed")
    by_old = {entry["originalPath"]: entry for entry in entries}
    lock = json.loads(path("onvif/sources.lock.json").read_bytes())
    old_lock = json.loads(original(by_old["bindings/onvif/sources.lock.json"]))
    for key in old_lock.keys() - {"pathConvention", "profileCatalog", "sourcePolicy", "editorialDecisions"}:
        require(lock[key] == old_lock[key], "Native source-lock content changed: " + key)

    catalog = json.loads(path("onvif/catalog.json").read_bytes())
    requirements = json.loads(path("onvif/requirements-index.json").read_bytes())
    pins = ledger["verifiedExistingInventories"]
    replacements = {e["destinationPath"]: e["originalPath"] for e in entries
                    if e["destinationPath"] != e["originalPath"]}
    replacements.update({
        catalog["registryDigest"]: pins["canonicalRegistryDigest"],
        requirements["digest"]: pins["canonicalRequirementsDigest"],
        sha(path("onvif/sources.lock.json").read_bytes()): pins["canonicalSourceLockDigest"],
    })
    canonical_checked = 0
    for entry in entries:
        if entry["initialOwner"] != "onvif-canonical-generator":
            continue
        name = entry["destinationPath"]
        if name == "onvif/model-manifest.json":
            continue
        data = path(name).read_bytes()
        if name.endswith((".json", ".jsonld")):
            before = json.loads(original(entry))
            after = normalized(json.loads(data), replacements)
            require(after == before, "Non-coordinate canonical content changed: " + name)
        else:
            require(sha(data) == entry["sha256"], "Canonical non-JSON content changed: " + name)
        canonical_checked += 1
    require(canonical_checked == 304, "Canonical artifact membership changed")
    manifest = json.loads(path("onvif/model-manifest.json").read_bytes())
    owned = {e["logicalArtifactPath"]: e for e in entries
             if e["initialOwner"] == "onvif-canonical-generator"
             and e["destinationPath"] != "onvif/model-manifest.json"}
    require(len(manifest["artifacts"]) == 304
            and {item["path"] for item in manifest["artifacts"]} == set(owned),
            "Canonical logical manifest membership changed")
    for item in manifest["artifacts"]:
        require(item["physicalPath"] == owned[item["path"]]["destinationPath"],
                "Canonical physical/logical coordinates diverged: " + item["path"])
        content = path(item["physicalPath"]).read_bytes()
        require(item["bytes"] == len(content) and item["sha256"] == sha(content),
                "Canonical manifest has stale bytes: " + item["path"])
    for old_name in ("vocabulary/context.jsonld", "examples/dataset.nq"):
        entry = by_old[old_name]
        require(sha(path(entry["destinationPath"]).read_bytes()) == entry["sha256"],
                "AV context or named graphs changed: " + old_name)
    from rdflib import Graph
    from rdflib.compare import isomorphic
    for old_name in ("vocabulary/ontology.ttl", "shapes/av.shacl.ttl"):
        entry = by_old[old_name]
        before = Graph().parse(data=original(entry).decode(), format="turtle")
        after = Graph().parse(path(entry["destinationPath"]), format="turtle")
        require(isomorphic(before, after), "AV normative graph changed: " + old_name)
    old_package_lock = json.loads(original(by_old["package-lock.json"]))
    package_lock = json.loads(path("package-lock.json").read_bytes())
    expected_packages = {}
    for name, value in old_package_lock["packages"].items():
        target = name.replace("packages/binding-onvif", "onvif/samples/reference-runtime", 1) \
            if name.startswith("packages/binding-onvif") else name
        expected_packages[target] = value
    require(set(package_lock["packages"]) == set(expected_packages), "Dependency lock membership changed")
    for name, value in expected_packages.items():
        if name in ("", "node_modules/@wot-av/binding-onvif"):
            continue
        for field in ("version", "resolved", "integrity"):
            require(package_lock["packages"][name].get(field) == value.get(field),
                    "Dependency pin changed: " + name + " " + field)
    package_json = json.loads((RUNTIME_ROOT / "package.json").read_bytes())
    staging = ledger["packageStaging"]
    require(package_json["exports"] == staging["publicExports"], "Public npm exports changed")
    require(package_json["bin"] == staging["bin"], "Public npm executable changed")
    require(manifest["packageAssets"] == staging["flatAssetLogicalSources"],
            "The 14 flat logical aliases changed")
    native_tests = path("onvif/tools/tests/native-media")
    sys.path.insert(0, str(native_tests))
    spec = importlib.util.spec_from_file_location("relocation_native_cohort", native_tests / "cohort_gate.py")
    require(spec is not None and spec.loader is not None, "Cannot load the native cohort inventory")
    cohort = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cohort)
    expected_sources = {item["logicalSourcePath"]: path(item["physicalSourcePath"])
                        for item in ledger["nativeCohort"]["sourceMap"]}
    require(cohort.SOURCE_PATHS == expected_sources and len(cohort.source_inventory()) == 43,
            "Native cohort lost or changed its 43-key physical source map")
    required_tests = set(ledger["nativeCohort"]["requiredCtestTargets"])
    cmake = (RUNTIME_ROOT / "native-media" / "CMakeLists.txt").read_text()
    require(set(re.findall(r"add_test\(\s*NAME\s+([\w.]+)", cmake)) == required_tests
            and cohort.EXPECTED_TESTS == required_tests, "One of seven required CTest definitions was lost")
    from check_docs import markdown_references
    active_docs = [path(e["destinationPath"]) for e in entries
                   if e["transformsAllowed"] and e["destinationPath"].endswith(".md")]
    active_docs.extend([
        REPO_ROOT / "readme.md", PUBLICATION / "relocation-plan.md",
        PUBLICATION / "relocation-implementation.md",
    ])
    for document in active_docs:
        try:
            markdown_references(document, document.read_text(encoding="utf8"))
        except ValueError as error:
            raise ValueError(f"Active link in {document.relative_to(REPO_ROOT)}: {error}") from error
    expected_paths = set(staging["generatedOnlyPackagePaths"])
    expected_paths.update(resource for entry in entries for resource in entry["packageResourcePaths"])
    require(len(expected_paths) == 528, "Frozen logical package inventory differs from 528")
    if package:
        actual = {"package.json", "NOTICE.md"}
        actual.update("dist/" + file.relative_to(RUNTIME_ROOT / "dist").as_posix()
                      for file in (RUNTIME_ROOT / "dist").rglob("*") if file.is_file())
        require(actual == expected_paths,
                "Logical package paths changed: " + repr({"missing": sorted(expected_paths - actual),
                                                         "extra": sorted(actual - expected_paths)}))
    return {
        "schemaVersion": 1, "phase": "path-only-relocation", "baselineCommit": ledger["baseline"]["commit"],
        "ledgerSha256": LEDGER_SHA256, "originalFiles": len(entries), "movedPaths": 901,
        "exactOriginalRepresentations": exact, "exactOnlyProtectedFiles": protected,
        "canonicalArtifactsSemanticallyUnchanged": canonical_checked,
        "avContextAndNamedGraphsByteUnchanged": True, "avOntologyAndShapesIsomorphic": True,
        "sourceRecordsAndDependencyPinsUnchanged": True,
        "nativeFingerprintInputs": 43, "requiredCtestDefinitions": len(required_tests),
        "activeMarkdownLinksChecked": len(active_docs),
        "logicalPackagePaths": len(expected_paths), "stagedPackageChecked": package,
        "indexUnchanged": True, "newRootReadmeIsNotAnOriginalDuplicate": True,
        "newMetadataFiles": sorted(
            (set(git("ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")) - {""}
             - {entry["destinationPath"] for entry in entries})
            | {"readme.md", "av/support/publication/relocation-result.json",
               "av/support/publication/redirect-index.json"}
        ),
        "nativeQualification": "Not run: requires explicit operator-provisioned SDK/source/build inputs; all seven CTest targets remain required.",
        "behaviorEvidence": "See relocation-implementation.md; this checker does not substitute for the AV, Node or native suites.",
        "transforms": changes,
    }


def token_hash(data):
    tokens = re.findall(r'"(?:[^"\\]|\\.)*"|[^\s{}\[\],:]+|[{}\[\],:]', data.decode("utf8"))
    return sha("\n".join(tokens).encode("utf8"))


def lock_fields(packages):
    return {name: {key: value[key] for key in ("version", "resolved", "integrity", "link") if key in value}
            for name, value in packages.items()}


def revision_constraint(record, before, after):
    """Bind a reviewed edit to both its committed input and current output."""
    name = record["path"]
    require(record.get("baselineSha256") == (None if before is None else sha(before)),
            "Evolution baseline bytes differ: " + name)
    require(bool(record.get("expectedSha256")), "Evolution lacks an exact output constraint: " + name)
    require(sha(after) == record["expectedSha256"], "Unreviewed evolution bytes: " + name)


def committed_files(commit):
    result = {}
    for record in git("ls-tree", "-r", "-z", commit).split(b"\0"):
        if record:
            meta, name = record.decode().split("\t")
            mode, kind, blob = meta.split()
            require(kind == "blob", "Unsupported committed entry: " + name)
            result[name] = (mode, blob)
    return result


def verify_evolution(register, ledger):
    evolutions = register.get("evolutions", [])
    if not evolutions:
        return ledger["baseline"]["commit"], None
    require(len({item["id"] for item in evolutions}) == len(evolutions), "Duplicate evolution ID")
    evolution = evolutions[-1]
    authority, separator, pointer = evolution["changeRecord"].partition("#/")
    require(separator and authority == "onvif/support/editorial/standards-decisions.json"
            and pointer == "vocabularyRevision", "Unrecognized post-integration change authority")
    decision = json.loads(path(authority).read_bytes())[pointer]
    require(evolution["id"] == decision["id"] and evolution["baselineCommit"] == decision["baselineCommit"],
            "Evolution disagrees with its dated change record")
    commit = evolution["baselineCommit"]
    require(re.fullmatch(r"[a-f0-9]{40}", commit) is not None, "Evolution requires an immutable commit")
    require(git("rev-parse", commit + "^{tree}").decode().strip() == evolution["baselineTree"],
            "Evolution committed tree differs")
    baseline = committed_files(commit)
    records = {item["path"]: item for item in evolution["files"]}
    require(records and len(records) == len(evolution["files"]), "Empty or duplicate evolution file inventory")
    ownership = json.loads(path("publication-ownership.json").read_bytes())
    generated = set(ownership["sharedPublication"]["generatedFiles"]) | {
        "av/support/publication/release-manifest.json", "onvif/support/publication/release-manifest.json",
        "av/support/publication/integration-result.json",
    }
    for name, record in records.items():
        require(name != "av/support/publication/transformation-register.json", "Evolution register cannot hash itself")
        before = git("cat-file", "blob", baseline[name][1]) if name in baseline else None
        revision_constraint(record, before, path(name).read_bytes())
    changes = set(git("diff", "--name-only", commit, "--").decode().splitlines())
    changes.update(name for name in git("ls-files", "--others", "--exclude-standard", "-z").decode().split("\0") if name)
    require(changes <= set(records) | generated | {"av/support/publication/transformation-register.json"},
            "Unregistered post-integration edits: " + repr(sorted(changes - set(records) - generated
                                                                 - {"av/support/publication/transformation-register.json"})))
    return commit, evolution


def classify(name, manifest):
    if name.startswith(".github/") or name in {
        ".gitattributes", ".gitignore", "readme.md", "package.json", "package-lock.json",
        "publication-ownership.json", "requirements-dev.txt",
    }:
        return "administration"
    parts = name.split("/")
    if len(parts) < 2 or parts[0] not in {"av", "onvif"}:
        return None
    if parts[1] in {"tools", "samples", "examples", "support"}:
        return {"tools": "tools", "samples": "samples", "examples": "examples", "support": "support"}[parts[1]]
    if parts[0] == "onvif" and parts[1] == "requirements":
        return "core"
    if name in manifest or (len(parts) == 2 and parts[1] in {
        "spec.md", "index.html", "readme.md", "terms.json", "context.jsonld", "ontology.ttl",
        "av.shacl.ttl", "sources.lock.json", "profile-editions.json", "model-manifest.json",
    }):
        return "core"
    return None


def verify(ledger, *, package=False):
    require(sha(LEDGER.read_bytes()) == LEDGER_SHA256, "Frozen ledger bytes changed")
    register = json.loads((PUBLICATION / "transformation-register.json").read_bytes())
    baseline_commit, evolution = verify_evolution(register, ledger)
    require(git("rev-parse", "HEAD").decode().strip() == baseline_commit,
            "Integration HEAD differs from the approved baseline")
    require(not git("diff", "--cached", "--name-only"), "Integration must not change the Git index")
    entries = ledger["entries"]
    require(len(entries) == 909, "Frozen original inventory is not 909")
    index = {}
    for record in git("ls-files", "--stage", "-z").split(b"\0"):
        if record:
            meta, name = record.decode().split("\t")
            mode, blob, stage = meta.split()
            require(stage == "0", "Unmerged Git index entry: " + name)
            index[name] = (mode, blob)
    expected_index = committed_files(baseline_commit) if evolution else {
        e["originalPath"]: (e["originalMode"], e["gitBlob"]) for e in entries
    }
    require(index == expected_index,
            "Original modes/blobs or index membership changed")

    require(register["ledgerSha256"] == LEDGER_SHA256, "Transformation register names a different baseline")
    require(sha((PUBLICATION / "relocation-result.json").read_bytes()) == register["pathOnlyResultSha256"],
            "Historical path-only result changed")
    by_old = {entry["originalPath"]: entry for entry in entries}
    reviewed = {entry["originalPath"]: entry for entry in register["entries"]}
    require(len(reviewed) == len(register["entries"]) and set(reviewed) <= set(by_old),
            "Duplicate or unknown transformation original")
    allowed_records = {
        "av/support/publication/relocation-result.json", "av/support/publication/integration.md",
        "av/support/migration/specification-clarifications.md",
        "onvif/support/editorial/standards-decisions.json", "onvif/model-translation.json",
    }
    for name, record in reviewed.items():
        require(bool(by_old[name]["transformsAllowed"]), "Register cannot relax exact-only protection: " + name)
        require(record["reason"].strip() and record["kind"] in {
            "path-only", "path-only-and-format", "normative-evolution", "integration", "generated-integration",
        }, "Unexplained transformation: " + name)
        authority, _, fragment = record["changeRecord"].partition("#")
        require(authority in allowed_records and path(authority).is_file(), "Unknown change authority: " + name)
        if fragment.startswith("/"):
            value = json.loads(path(authority).read_bytes())
            for part in fragment[1:].split("/"):
                key = part.replace("~1", "/").replace("~0", "~")
                value = value[int(key)] if isinstance(value, list) else value[key]
            require(value is not None, "Missing change record: " + name)
        elif fragment:
            require(fragment in path(authority).read_text(encoding="utf8"), "Missing decision ID: " + name)
        require(record["kind"] == "generated-integration" or
                bool(record.get("expectedSha256") or record.get("tokenSha256")),
                "Changed original lacks a byte/token constraint: " + name)
        if record["kind"] == "generated-integration":
            require(record["currentPath"] in {
                "av/support/publication/release-manifest.json", "onvif/support/publication/release-manifest.json",
            }, "Only current publication inventories may use generated constraints: " + name)
        if record.get("evolution"):
            require(evolution is not None and record["evolution"] == evolution["id"], "Unknown original evolution: " + name)
            previous = record.get("previousConstraints", [])
            require(previous and previous[-1]["baselineCommit"] == baseline_commit, "Missing prior original constraint: " + name)
            prior = previous[-1]
            before = git("show", baseline_commit + ":" + record["currentPath"])
            require(bool(prior.get("expectedSha256") or prior.get("tokenSha256")), "Prior constraint was discarded: " + name)
            if prior.get("expectedSha256"):
                require(sha(before) == prior["expectedSha256"], "Prior original byte constraint differs: " + name)
            if prior.get("tokenSha256"):
                require(token_hash(before) == prior["tokenSha256"], "Prior original token constraint differs: " + name)

    current_paths, transforms, exact, protected = {}, [], 0, 0
    for entry in entries:
        record = reviewed.get(entry["originalPath"])
        name = record["currentPath"] if record else entry["destinationPath"]
        require(name.casefold() not in {value.casefold() for value in current_paths.values()},
                "Case-insensitive original destination collision: " + name)
        current_paths[entry["originalPath"]] = name
        target = path(name)
        require(target.is_file(), "Missing retained original: " + name)
        content = target.read_bytes()
        unchanged = len(content) == entry["bytes"] and sha(content) == entry["sha256"]
        if not entry["transformsAllowed"]:
            require(unchanged, "Protected representation changed: " + name)
            protected += 1
        exact += unchanged
        if not unchanged or name != entry["destinationPath"]:
            require(record is not None, "Unregistered original transformation: " + name)
            if record.get("expectedSha256"):
                require(sha(content) == record["expectedSha256"], "Unreviewed bytes after registered change: " + name)
            if record.get("tokenSha256"):
                require(token_hash(content) == record["tokenSha256"], "Non-whitespace JSON change: " + name)
            transforms.append({
                "originalPath": entry["originalPath"], "destinationPath": name,
                "originalSha256": entry["sha256"], "bytes": len(content), "sha256": sha(content),
                "kind": record["kind"], "reason": record["reason"], "changeRecord": record["changeRecord"],
            })
        if entry["originalPath"] not in (name, "readme.md"):
            require(not path(entry["originalPath"]).exists(), "Original remains at legacy runtime path: " + entry["originalPath"])
    require(protected == 290, "Exact-only protection count changed")

    manifest = json.loads(path("onvif/model-manifest.json").read_bytes())
    artifacts = {entry["path"]: entry for entry in manifest["artifacts"]}
    require(len(artifacts) == len(manifest["artifacts"]), "Duplicate canonical logical paths")
    physical = {item["physicalPath"]: item for item in artifacts.values()}
    require(len(physical) == len(artifacts), "Duplicate canonical physical paths")
    original_canonical = [e for e in entries if e["initialOwner"] == "onvif-canonical-generator"
                          and e["destinationPath"] != "onvif/model-manifest.json"]
    require(len(original_canonical) == 304, "Original canonical inventory changed")
    require({e["logicalArtifactPath"] for e in original_canonical} <= set(artifacts),
            "An original canonical logical artifact was lost")
    native_ids = 0
    for entry in original_canonical:
        item = artifacts[entry["logicalArtifactPath"]]
        require(item["physicalPath"] == current_paths[entry["originalPath"]], "Current original/model mapping disagrees")
        if entry["originalPath"].endswith(".tm.json"):
            require(json.loads(path(item["physicalPath"]).read_bytes())["id"] == json.loads(original(entry))["id"],
                    "An original native model ID changed: " + item["path"])
            native_ids += 1
    for item in artifacts.values():
        content = path(item["physicalPath"]).read_bytes()
        require(item["bytes"] == len(content) and item["sha256"] == sha(content),
                "Canonical manifest has stale bytes: " + item["path"])
    require(native_ids == 285, "An original native Thing Model was lost")
    require(manifest["registryDigest"] == ledger["verifiedExistingInventories"]["canonicalRegistryDigest"],
            "Original qualified operation/type registry changed")
    lock = json.loads(path("onvif/sources.lock.json").read_bytes())
    old_lock = json.loads(original(by_old["bindings/onvif/sources.lock.json"]))
    for key in old_lock.keys() - {"pathConvention", "profileCatalog", "sourcePolicy", "editorialDecisions"}:
        require(lock[key] == old_lock[key], "Native source-lock authority changed: " + key)
    for old_name in ("vocabulary/context.jsonld", "examples/dataset.nq"):
        require(sha(path(current_paths[old_name]).read_bytes()) == by_old[old_name]["sha256"],
                "AV context or named graphs changed: " + old_name)
    av_terms = json.loads(path("av/terms.json").read_bytes())
    require(len(av_terms["classes"]) == 7 and len(av_terms["properties"]) == 29, "Thin AV model changed")

    package_lock = json.loads(path("package-lock.json").read_bytes())
    require(lock_fields(package_lock["packages"]) == register["dependencyLockFields"],
            "A registered dependency version/resolution/integrity/link field changed")
    old_packages = json.loads(original(by_old["package-lock.json"]))["packages"]
    for name, fields in lock_fields(old_packages).items():
        target = name.replace("packages/binding-onvif", "onvif/samples/reference-runtime", 1) \
            if name.startswith("packages/binding-onvif") else name
        if name == "":
            continue
        expected = dict(fields)
        if name == "node_modules/@wot-av/binding-onvif":
            expected["resolved"] = "onvif/samples/reference-runtime"
        require(lock_fields(package_lock["packages"]).get(target) == expected, "Original dependency pin changed: " + name)
    package_json = json.loads((RUNTIME_ROOT / "package.json").read_bytes())
    staging = ledger["packageStaging"]
    require(package_json["exports"] == staging["publicExports"] and package_json["bin"] == staging["bin"],
            "An original public package export or executable changed")
    require(all(manifest["packageAssets"].get(key) == value for key, value in staging["flatAssetLogicalSources"].items()),
            "An original flat artifact alias changed")

    native_tests = path("onvif/tools/tests/native-media")
    sys.path.insert(0, str(native_tests))
    spec = importlib.util.spec_from_file_location("integration_native_cohort", native_tests / "cohort_gate.py")
    require(spec is not None and spec.loader is not None, "Cannot load native cohort inventory")
    cohort = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cohort)
    require(cohort.SOURCE_PATHS == {item["logicalSourcePath"]: path(item["physicalSourcePath"])
                                   for item in ledger["nativeCohort"]["sourceMap"]}
            and len(cohort.source_inventory()) == 43, "Native 43-key source inventory changed")
    required_tests = set(ledger["nativeCohort"]["requiredCtestTargets"])
    cmake = (RUNTIME_ROOT / "native-media" / "CMakeLists.txt").read_text()
    require(set(re.findall(r"add_test\(\s*NAME\s+([\w.]+)", cmake)) == required_tests
            and cohort.EXPECTED_TESTS == required_tests, "One of seven required CTest definitions was lost")

    expected_package = set()
    if package:
        provenance = json.loads((RUNTIME_ROOT / "dist" / "package-provenance.json").read_bytes())
        expected_package = {"package.json", "NOTICE.md", "dist/package-provenance.json"}
        expected_package.update("dist/" + item["path"] for item in provenance["files"])
        actual = {"package.json", "NOTICE.md"} | {
            "dist/" + file.relative_to(RUNTIME_ROOT / "dist").as_posix()
            for file in (RUNTIME_ROOT / "dist").rglob("*") if file.is_file()
        }
        require(expected_package == actual, "Staged package differs from its exact provenance inventory")
        require(provenance["canonicalArtifacts"] == len(artifacts) + 1, "Staged package canonical inventory is stale")
        for item in provenance["files"]:
            data = (RUNTIME_ROOT / "dist" / item["path"]).read_bytes()
            require(item["bytes"] == len(data) and item["sha256"] == sha(data), "Staged package bytes are stale: " + item["path"])

    all_names = {name for name in git("ls-files", "--cached", "--others", "--exclude-standard", "-z").decode().split("\0")
                 if name and path(name).is_file()}
    all_names.add("av/support/publication/integration-result.json")
    classes = {name: classify(name, physical) for name in all_names}
    unclassified = sorted(name for name, category in classes.items() if category is None)
    require(not unclassified, "Unclassified active files: " + repr(unclassified))
    originals = set(current_paths.values())
    require(originals <= all_names, "An original is absent from the active file inventory")
    added = sorted(all_names - originals)
    return {
        "schemaVersion": 2, "phase": "specification-integration", "baselineCommit": ledger["baseline"]["commit"],
        "evolutionBaselineCommit": baseline_commit if evolution else None,
        "evolutionId": evolution["id"] if evolution else None,
        "evolutionConstrainedFiles": len(evolution["files"]) if evolution else 0,
        "ledgerSha256": LEDGER_SHA256, "originalFiles": len(entries), "retainedOriginalFiles": len(originals),
        "exactOriginalRepresentations": exact, "exactOnlyProtectedFiles": protected,
        "registeredTransformations": len(transforms), "originalCanonicalArtifactsRetained": len(original_canonical),
        "originalNativeModelIdsPreserved": native_ids, "canonicalArtifactsIncludingManifest": len(artifacts) + 1,
        "canonicalRoles": dict(sorted(Counter(item["role"] for item in artifacts.values()).items())),
        "sourceRecordsAndDependencyPinsUnchanged": True, "dependencyLockRecords": len(package_lock["packages"]),
        "nativeFingerprintInputs": 43, "requiredCtestDefinitions": len(required_tests),
        "logicalPackagePaths": len(expected_package) if package else None, "stagedPackageChecked": package,
        "currentFiles": len(all_names), "newFiles": len(added), "fullPartition": dict(sorted(Counter(classes.values()).items())),
        "unclassifiedPaths": unclassified, "indexUnchanged": True,
        "newFileInventory": [{"path": name, "category": classes[name]} for name in added],
        "qualification": {
            "nativeOnvifRuntime": "Separate executed qualification is recorded in onvif/support/reports/native-relocated-qualification.md and its provenance JSON; this preservation audit does not rerun native tests.",
            "linuxAndHardware": "Separate Linux software qualification is recorded in onvif/tools/adapters/linux/README.md; all physical-camera hardware remains unverified. This audit does not execute Linux cohorts.",
            "formalReleaseApproved": False, "referenceChecksEstablishFullProfileConformance": False,
        },
        "transforms": transforms,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", action="store_true", help="Also require the exact current staged package inventory")
    parser.add_argument("--path-only", action="store_true", help="Run the historical strict semantic comparison; does not admit later normative evolution")
    parser.add_argument("--record", action="store_true", help="Write the current integration result; never rewrite the original ledger or path-only result")
    args = parser.parse_args()
    ledger = json.loads(LEDGER.read_bytes())
    if args.path_only and args.record:
        parser.error("Historical path-only evidence is frozen; --record applies only to current integration")
    result = (verify_path_only if args.path_only else verify)(ledger, package=args.package)
    if args.record:
        (PUBLICATION / "integration-result.json").write_bytes((json.dumps(result, indent=4, ensure_ascii=True) + "\n").encode())
    if not args.path_only:
        from check_docs import markdown_references
        for name in ("readme.md", "av/readme.md", "onvif/readme.md", "av/support/publication/integration.md"):
            document = path(name)
            markdown_references(document, document.read_text(encoding="utf8"))
        if args.package:
            for generator in ("onvif/tools/generate_onvif.py", "av/tools/generate.py"):
                subprocess.run([sys.executable, "-B", str(path(generator)), "--check"],
                               cwd=REPO_ROOT, check=True)
    print(json.dumps({key: value for key, value in result.items()
                      if key not in {"transforms", "newFileInventory", "newMetadataFiles"}}, indent=4))


if __name__ == "__main__":
    main()

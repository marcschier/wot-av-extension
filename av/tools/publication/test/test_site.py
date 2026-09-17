"""Offline stager tests; Git writes and HTTP listeners belong only to fixtures."""

from __future__ import annotations

import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PureWindowsPath
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit


MODULE = Path(__file__).absolute().parents[1] / "stage-site.py"
SPEC = importlib.util.spec_from_file_location("public_site", MODULE)
site = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = site
SPEC.loader.exec_module(site)
REPOSITORY = MODULE.parents[3]
BASE = "/wot-av-extension/"
CSP = ("default-src 'none'; style-src 'unsafe-inline'; img-src data:; "
       "font-src data:; base-uri 'none'; form-action 'none'")


def encoded(value):
    return (json.dumps(value, ensure_ascii=True, indent=4) + "\n").encode("ascii")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def synthetic_user_path(name):
    """Fabricated exclusion/rejection input, never an actual user's provenance."""
    return str(PureWindowsPath("C:\\", "Users", "fixture", name))


def document(title, body):
    return (f'<!DOCTYPE html>\n<html lang="en"><head>'
            f'<meta http-equiv="Content-Security-Policy" content="{CSP}">'
            f'<title>{title}</title><style>body {{ color: black; }}</style></head>'
            f'<body><h1 id="title">{title}</h1>{body}</body></html>\n').encode("utf-8")


class ReadSpy:
    def __init__(self, stream, maximum_return=site.CHUNK, stop_after=None):
        self.stream = stream
        self.maximum_return = maximum_return
        self.stop_after = stop_after
        self.requests = []
        self.bytes_read = 0

    def fileno(self):
        return self.stream.fileno()

    def read(self, size=-1):
        self.requests.append(size)
        if not 0 <= size <= site.CHUNK:
            raise MemoryError(f"Single read requested {size} bytes; budget is {site.CHUNK}")
        if self.stop_after is not None and self.bytes_read >= self.stop_after:
            return b""
        data = self.stream.read(min(size, self.maximum_return))
        self.bytes_read += len(data)
        return data


@contextlib.contextmanager
def bounded_reads(*, maximum_return=site.CHUNK, stop_after=None, before_read=None):
    original = site.regular_reader
    readers = []

    @contextlib.contextmanager
    def reader(path, limit=site.MAX_FILE_BYTES):
        with original(path, limit) as stream:
            if before_read is not None:
                before_read(path)
            spy = ReadSpy(stream, maximum_return, stop_after)
            readers.append((path, spy))
            yield spy

    with patch.object(site, "regular_reader", reader):
        yield readers


class BoundedReadTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="wot-site-read-test-")
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "sample.json"

    def test_json_validation_uses_chunk_bounded_reads(self):
        data = encoded({"value": "x" * (site.CHUNK * 2 + 17)})
        self.path.write_bytes(data)
        with bounded_reads() as readers:
            site.validate_data_file(self.path, self.path.name, site.MAX_FILE_BYTES)
        self.assertEqual(len(readers), 2, "Exercise raw scanning and the actual JSON read_bytes call")
        for path, reader in readers:
            self.assertEqual(path, self.path)
            self.assertEqual(reader.bytes_read, len(data))
            self.assertLessEqual(max(reader.requests), site.CHUNK)
            self.assertGreater(len(reader.requests), 2)

    def test_read_bytes_retries_short_reads_without_partial_success(self):
        data = b"abcdefg" * (site.CHUNK // 3)
        self.path.write_bytes(data)
        with bounded_reads(maximum_return=97) as readers:
            self.assertEqual(site.read_bytes(self.path, len(data)), data)
        self.assertEqual(readers[0][1].bytes_read, len(data))
        self.assertGreater(len(readers[0][1].requests), len(data) // 97)

    def test_read_bytes_empty_and_exact_chunk_boundaries(self):
        for size in (0, site.CHUNK - 1, site.CHUNK, site.CHUNK + 1):
            with self.subTest(size=size):
                data = b"x" * size
                self.path.write_bytes(data)
                with bounded_reads() as readers:
                    self.assertEqual(site.read_bytes(self.path, size), data)
                self.assertEqual(readers[0][1].bytes_read, size)
                self.assertEqual(readers[0][1].requests[-1], 1, "Probe EOF at the exact byte bound")

    def test_oversized_file_fails_before_any_read(self):
        self.path.write_bytes(b"abcdef")
        with bounded_reads() as readers:
            with self.assertRaisesRegex(site.SiteError, "^SIZE:"):
                site.read_bytes(self.path, 5)
        self.assertEqual(readers, [])

    def test_growing_file_stops_at_limit_plus_one(self):
        self.path.write_bytes(b"abcdef")
        with bounded_reads(before_read=lambda path: path.write_bytes(b"abcdef" + b"x" * site.CHUNK)) as readers:
            with self.assertRaisesRegex(site.SiteError, "^SIZE:"):
                site.read_bytes(self.path, 6)
        self.assertEqual(readers[0][1].bytes_read, 7)
        self.assertEqual(readers[0][1].requests, [7])

    def test_size_change_within_limit_is_not_accepted(self):
        self.path.write_bytes(b"abcdef")
        with bounded_reads(before_read=lambda path: path.write_bytes(b"abcdefg")):
            with self.assertRaisesRegex(site.SiteError, "^RACE:"):
                site.read_bytes(self.path, 100)

    def test_premature_eof_is_not_partial_success(self):
        self.path.write_bytes(b"x" * (site.CHUNK + 1))
        with bounded_reads(stop_after=site.CHUNK) as readers:
            with self.assertRaisesRegex(site.SiteError, "^RACE:"):
                site.read_bytes(self.path, site.CHUNK + 1)
        self.assertEqual(readers[0][1].bytes_read, site.CHUNK)

    def test_public_test_source_has_no_machine_specific_runtime_path(self):
        pattern = rb"(?i)(?:[a-z]:[\\/]+users[\\/]|site-packages[\\/])"
        self.assertIsNone(re.search(pattern, Path(__file__).read_bytes()))
        self.assertRegex(synthetic_user_path("source").encode("ascii"), pattern)

    def test_synthetic_private_paths_stay_negative_and_public_logical_sources_pass(self):
        private = synthetic_user_path("source")
        self.assertEqual(PureWindowsPath(private).parts, ("C:\\", "Users", "fixture", "source"))
        for data in (private.encode("ascii"), encoded({"oldSource": private})):
            with self.subTest(data=data):
                self.path.write_bytes(data)
                with self.assertRaisesRegex(site.SiteError, "^PUBLIC_CONTENT:"):
                    site.validate_data_file(self.path, self.path.name, 4096)
        public = encoded({"oldSource": "record:synthetic-fixture-origin"})
        self.path.write_bytes(public)
        site.validate_data_file(self.path, self.path.name, 4096)
        self.assertEqual(self.path.read_bytes(), public)


class Fixture:
    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wot-site-test-")
        self.base = Path(self.temporary.name)
        self.root = self.base / "repository"
        self.root.mkdir()
        self.paths = set()
        self.policy = json.loads((REPOSITORY / site.POLICY).read_bytes())
        self.file_policy = json.loads((REPOSITORY / site.FILE_POLICY).read_bytes())
        self.publication = json.loads((REPOSITORY / site.PUBLICATION_POLICY).read_bytes())
        self.write(".gitattributes", b"* -text\n")
        self.write(site.STAGER, b"# Controlled fixture input, not the executing stager.\n")
        self.write(site.CHECKER, b"throw new Error('Fixture certificate must be injected explicitly');\n")
        self.write(site.SOURCE_SEAL, encoded({"fixtureProof": True, "privateInputs": [synthetic_user_path("input")]}))
        for record in self.file_policy["files"]:
            name = record["source"]
            if name.endswith((".json", ".jsonld")):
                data = encoded({"example": True, "properties": {"password": {"type": "string"}}})
            elif name.endswith(".ttl"):
                data = b"@prefix ex: <https://example.org/vocabulary#> .\nex:Term ex:note \"unchanged\" .\n"
            elif name.endswith(".html") and record["role"] == "notice":
                data = b"<!DOCTYPE html><html><script>original_notice_script()</script><p>Original notice.</p></html>\n"
            else:
                data = b"Original copyright, permissions and disclaimer.\n"
            self.write(name, data)
        self.write("av/terms.json", b'{\n    "a/b": {"~": "pointer target"},\n    "precise": 9007199254740993.1\n}\n')
        self.write("av/context.jsonld", encoded({"@context": {"av": "https://example.org/wot/av/0.2#"}}))
        self.write("av/support/migration/specification-clarifications.md", b"# Clarifications\nPublic supporting source.\n")
        self.write("av/support/migration/dimensions-technical-disposition.md", b"# Disposition\nSupporting source.\n")
        self.write("onvif/support/editorial/standards-decisions.json",
                   encoded({"vocabularyRevision": {"NativeContract": "retained filename"},
                            "unstagedEvidence": synthetic_user_path("editorial")}))
        self.av_body = (
            '<p><a href="support/migration/specification-clarifications.md">edition change record</a> '
            '<a href="support/migration/dimensions-technical-disposition.md"><em>AV-D09</em> disposition</a></p>'
            '<p><a href="terms.json?view=complete#/%61~1b/~0">pointer</a> '
            '<a href="context.jsonld">context</a><a href="../onvif/index.html#title">ONVIF</a></p>'
            '<pre><code>&lt;a href="support/migration/specification-clarifications.md"&gt;</code></pre>')
        self.onvif_body = (
            '<p><a href="support/editorial/standards-decisions.json#/vocabularyRevision">migration record</a> '
            '<a href="support/editorial/standards-decisions.json">decision record</a></p>'
            '<a href="binding.schema.json#/$defs/x~1y/~0/0">schema pointer</a>'
            '<a href="model-manifest.json">manifest</a>'
            '<a href="models/native/DeviceThing.tm.json">native model</a>')
        self.write_html()
        self.canonical = []
        self.add_canonical("onvif/context.jsonld", "normative-vocabulary",
                           "https://example.org/wot/onvif/context/v0.1",
                           encoded({"@context": {"onvif": "https://example.org/wot/onvif#"}}))
        self.add_canonical("onvif/binding.schema.json", "normative-schema",
                           "https://example.org/wot/onvif/schemas/binding.schema.json",
                           encoded({"$id": "https://example.org/wot/onvif/schemas/binding.schema.json",
                                    "$defs": {"x/y": {"~": ["schema target"]}}}))
        self.add_canonical("onvif/requirements-index.json", "normative-catalog",
                           "https://example.org/wot/onvif/generated/requirements-index.json",
                           encoded({"requirements": [{"source": "onvif/requirements/profile-a.json"}]}))
        dependencies = ["https://example.org/wot/onvif/context/v0.1", "https://www.w3.org/2022/wot/td/v1.1"]
        self.add_canonical("onvif/models/native/DeviceThing.tm.json", "thing-model",
                           "https://example.org/wot/onvif/models/DeviceThing.tm.json",
                           encoded({"id": "https://example.org/wot/onvif/models/DeviceThing.tm.json",
                                    "@type": ["tm:ThingModel", "onvif:NativeContract"],
                                    "@context": dependencies,
                                    "links": [{"rel": "tm:extends", "href": "https://example.org/wot/onvif/models/Other.tm.json"}]}),
                           dependencies + ["https://example.org/wot/onvif/models/Other.tm.json"])
        self.add_canonical("onvif/models/native/Other.tm.json", "thing-model",
                           "https://example.org/wot/onvif/models/Other.tm.json", encoded({"id": "unchanged-other"}))
        self.add_canonical("onvif/models/events/PullPointSubscription.tm.json", "thing-model",
                           "https://example.org/wot/onvif/models/events/PullPointSubscription.tm.json",
                           encoded({"event": True}))
        self.add_canonical("onvif/models/native/clients/Profile-A-1.0.json", "client-requirement-manifest",
                           "https://example.org/wot/onvif/models/clients/Profile-A-1.0.json", encoded({"client": True}))
        self.add_canonical("onvif/support/reports/coverage.json", "informative-evidence",
                           "https://example.org/wot/onvif/coverage/coverage.json",
                           encoded({"excluded": synthetic_user_path("coverage")}))
        self.refresh_manifest(review=True)
        self.write_policy()
        self.git("init", "--quiet", "--initial-branch=main")
        self.git("config", "user.name", "Site Stager Fixture")
        self.git("config", "user.email", "site-fixture@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.autocrlf", "false")
        self.git("config", "core.hooksPath", str(self.base / "unused-hooks"))
        self.seal(commit=True)
        self.output = self.base / "stage"

    def close(self):
        self.temporary.cleanup()

    def git(self, *args):
        environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        environment.update(GIT_OPTIONAL_LOCKS="0", GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1",
                           GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull)
        result = subprocess.run(["git", "--no-pager", *args], cwd=self.root,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                check=True, timeout=30, env=environment)
        return result.stdout

    def write(self, name, data):
        path = self.root.joinpath(*name.split("/"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.paths.add(name)

    def read(self, name):
        return self.root.joinpath(*name.split("/")).read_bytes()

    def write_html(self):
        self.write("av/index.html", document(self.policy["smoke"][1]["title"], self.av_body))
        self.write("onvif/index.html", document(self.policy["smoke"][2]["title"], self.onvif_body))

    def add_canonical(self, path, role, identity, data, dependencies=()):
        self.write(path, data)
        self.canonical.append({"physicalPath": path, "path": path.removeprefix("onvif/"),
                               "role": role, "logicalId": identity, "dependencies": list(dependencies),
                               "sha256": sha(data), "bytes": len(data)})

    def refresh_manifest(self, *, review=False):
        for row in self.canonical:
            data = self.read(row["physicalPath"])
            row["sha256"], row["bytes"] = sha(data), len(data)
        self.write("onvif/model-manifest.json", encoded({
            "formatVersion": 1, "publication": "Original private-bundle wording is not silently redacted.",
            "packageAssets": {"do-not-expand": "unselected-source.json"},
            "artifacts": self.canonical,
        }))
        if review:
            rows = sorted(({"path": r["physicalPath"], "role": r["role"], "logicalId": r["logicalId"]}
                           for r in self.canonical if r["role"] != "informative-evidence"),
                          key=lambda item: item["path"])
            self.file_policy["canonical"]["membershipSha256"] = sha(json.dumps(
                rows, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii"))

    def write_policy(self):
        self.write(site.POLICY, encoded(self.policy))
        self.write(site.FILE_POLICY, encoded(self.file_policy))
        self.write(site.PUBLICATION_POLICY, encoded(self.publication))

    def seal(self, *, commit=False):
        if commit:
            self.git("add", "--all", "--", ".")
            self.git("commit", "--quiet", "--allow-empty", "-m", "Controlled fixture snapshot")
        head = self.git("rev-parse", "HEAD").decode("ascii").strip()
        stamps = {name: site.Fingerprint(len(self.read(name)), sha(self.read(name))) for name in self.paths}
        self.certificate = site.SourceCertificate(
            head, stamps, {site.SOURCE_SEAL: stamps[site.SOURCE_SEAL], site.CHECKER: stamps[site.CHECKER]})

    def verified_certificate(self, tree, node):
        return self.certificate

    def plan(self, **options):
        return site.make_plan(self.root, BASE, certificate_reader=self.verified_certificate, **options)

    def prepare(self, **options):
        return site.prepare(self.root, BASE, self.output, certificate_reader=self.verified_certificate, **options)

    def check(self, **options):
        return site.check(self.root, self.output, certificate_reader=self.verified_certificate, **options)

    def tar(self, plan, records=None, *, directories=False):
        target = self.base / "artifact.tar"
        if records is None:
            records = [(name, (self.output / name).read_bytes(), tarfile.REGTYPE) for name in reversed(sorted(plan.stamps))]
        with tarfile.open(target, "w", format=tarfile.PAX_FORMAT) as archive:
            if directories:
                for name in ["", *sorted(site.parent_paths(set(plan.stamps)))]:
                    info = tarfile.TarInfo("./" + name + ("/" if name else ""))
                    info.type = tarfile.DIRTYPE
                    info.mtime = 1.25
                    archive.addfile(info)
            for name, data, kind in records:
                info = tarfile.TarInfo("./" + name)
                info.type = kind
                info.size = len(data) if kind == tarfile.REGTYPE else 0
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    info.linkname = "index.html"
                archive.addfile(info, io.BytesIO(data) if info.size else None)
        return target


class FixtureCase(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.addCleanup(self.fixture.close)

    def error(self, code, callback):
        with self.assertRaises(site.SiteError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code, str(caught.exception))
        return caught.exception

    def edited(self, *, review=False, commit=True, refresh=True):
        if refresh:
            self.fixture.refresh_manifest(review=review)
        self.fixture.write_policy()
        self.fixture.seal(commit=commit)


class SourceAndPolicyTests(FixtureCase):
    def test_committed_bundle_copies_canonical_examples_and_notices_exactly(self):
        f = self.fixture
        plan = f.prepare()
        self.assertEqual(f.check().content_sha256, plan.content_sha256)
        for path, item in plan.selection.items.items():
            if item.role != "specification":
                self.assertEqual((f.output / path).read_bytes(), f.read(item.source), path)
        mapping = json.loads((f.output / "artifact-map.json").read_bytes())
        by_id = {row["logicalId"]: row for row in mapping["artifacts"]}
        device = by_id["https://example.org/wot/onvif/models/DeviceThing.tm.json"]
        self.assertEqual(device["retrievalPath"], BASE + "onvif/models/native/DeviceThing.tm.json")
        self.assertIn("onvif/models/native/Other.tm.json", plan.stamps)
        self.assertIn("onvif/models/events/PullPointSubscription.tm.json", plan.stamps)
        self.assertEqual(mapping["omitted"][0]["staged"], False)
        self.assertNotIn("onvif/support/reports/coverage.json", plan.stamps)
        self.assertIn(b"onvif:NativeContract", (f.output / device["path"]).read_bytes())
        self.assertIn(b"9007199254740993.1", (f.output / "av/terms.json").read_bytes())
        self.assertIn(b"original_notice_script", (f.output / "notices/w3c-document-2023.html.txt").read_bytes())
        self.assertEqual(len(plan.stamps), len(f.file_policy["files"]) + len(f.canonical) - 1 + len(site.GENERATED))

    def test_reproducible_output_has_no_private_proof_inventory(self):
        f = self.fixture
        first = f.prepare()
        second_path = f.base / "second-stage"
        second = site.prepare(f.root, BASE, second_path, certificate_reader=f.verified_certificate)
        self.assertEqual(first.manifest, second.manifest)
        for name in first.stamps:
            self.assertEqual((f.output / name).read_bytes(), (second_path / name).read_bytes())
        public = (f.output / "site-manifest.json").read_bytes()
        self.assertNotIn(str(f.root).encode(), public)
        self.assertNotIn(b"privateInputs", public)
        self.assertNotIn(b"source-input-manifest", public)
        self.assertNotIn(b"publication-manifest", public)
        self.assertEqual(first.manifest["sourceDate"], "2026-09-16")

    def test_preview_binds_dirty_bytes_and_cannot_verify_deployment_archive(self):
        f = self.fixture
        original = f.plan().manifest["provenance"]["sourceSnapshotSha256"]
        f.write("av/terms.json", f.read("av/terms.json").replace(b"pointer target", b"changed target"))
        f.seal()
        plan = f.prepare(preview=True)
        self.assertEqual(plan.manifest["provenance"]["mode"], "preview-uncommitted")
        self.assertNotEqual(plan.manifest["provenance"]["sourceSnapshotSha256"], original)
        self.assertEqual(plan.manifest["sourceCommit"], f.certificate.source_commit)
        self.assertIn(b"PREVIEW", (f.output / "index.html").read_bytes())
        archive = f.tar(plan)
        self.error("PREVIEW", lambda: site.verify_archive(f.root, archive, f.output, certificate_reader=f.verified_certificate))
        self.assertEqual(f.check().content_sha256, plan.content_sha256)

    def test_deployment_rejects_uncommitted_worktree_even_with_current_certificate(self):
        f = self.fixture
        f.write("av/terms.json", f.read("av/terms.json") + b" ")
        f.seal()
        self.error("UNCOMMITTED", f.prepare)
        self.assertFalse(f.output.exists())

    def test_deployment_rejects_staged_changes_even_when_worktree_matches_head(self):
        f = self.fixture
        before = f.read("av/terms.json")
        f.write("av/terms.json", before + b" ")
        f.git("add", "--", "av/terms.json")
        f.write("av/terms.json", before)
        self.error("UNCOMMITTED", f.prepare)

    def test_deployment_rejects_untracked_selected_input(self):
        f = self.fixture
        f.git("rm", "--cached", "--quiet", "--", "av/terms.json")
        self.error("UNCOMMITTED", f.prepare)

    def test_assume_unchanged_does_not_hide_dirty_source(self):
        f = self.fixture
        f.git("update-index", "--assume-unchanged", "--", "av/terms.json")
        f.write("av/terms.json", f.read("av/terms.json") + b" ")
        f.seal()
        self.error("UNCOMMITTED", f.prepare)

    def test_expected_commit_and_zero_sha_are_not_snapshot_claims(self):
        for commit in ("f" * 40, "0" * 40, "bad\ncontent_sha256=forged"):
            with self.subTest(commit=commit):
                self.error("SOURCE_COMMIT", lambda: self.fixture.prepare(expected_commit=commit))
        self.assertFalse(self.fixture.output.exists())

    def test_changed_input_invalidates_preview_certificate(self):
        f = self.fixture
        f.write("av/terms.json", f.read("av/terms.json") + b" ")
        self.error("STALE_CERTIFICATE", lambda: f.prepare(preview=True))

    def test_changed_proof_invalidates_certificate(self):
        f = self.fixture
        f.write(site.SOURCE_SEAL, b'{"fixtureProof":false}\n')
        self.error("STALE_CERTIFICATE", lambda: f.prepare(preview=True))

    def test_certificate_requires_proof_and_correct_commit(self):
        f = self.fixture
        old = f.certificate
        f.certificate = site.SourceCertificate(old.source_commit, old.files)
        self.error("SOURCE_PROOF", f.prepare)
        f.certificate = site.SourceCertificate("a" * 40, old.files, old.proofs)
        self.error("STALE_CERTIFICATE", f.prepare)

    def test_canonical_hashes_are_not_overridden_by_certificate(self):
        f = self.fixture
        f.write("onvif/requirements-index.json", b'{"different":"canonical bytes"}\n')
        f.seal(commit=True)
        self.error("CANONICAL", f.prepare)

    def test_membership_change_needs_explicit_review_not_a_role_glob(self):
        f = self.fixture
        f.add_canonical("onvif/models/native/Added.tm.json", "thing-model",
                        "https://example.org/wot/onvif/models/Added.tm.json", b"{}\n")
        self.edited()
        self.error("ALLOWLIST", f.prepare)
        self.edited(review=True)
        plan = f.prepare()
        self.assertIn("onvif/models/native/Added.tm.json", plan.stamps)
        self.assertEqual(len(plan.selection.items), len(f.file_policy["files"]) + len(f.canonical) - 1)

    def test_unknown_role_and_unmapped_dependency_fail_closed(self):
        f = self.fixture
        f.canonical[0]["role"] = "source-input"
        self.edited()
        self.error("ALLOWLIST", f.prepare)
        f.canonical[0]["role"] = "normative-vocabulary"
        f.canonical[0]["dependencies"] = ["https://unapproved.example/no-download"]
        self.edited(review=True)
        self.error("CANONICAL", f.prepare)

    def test_policy_cannot_admit_private_source_or_hidden_checkout(self):
        f = self.fixture
        for path in ("local-only/secret.json", "onvif/support/reports/private.json",
                     "av/tools/private.json", "onvif/samples/code.json", ".git/config",
                     "av/readme.md", "onvif/support/publication/source-input-manifest.json"):
            with self.subTest(path=path):
                self.error("PATH" if path == ".git/config" else "ALLOWLIST", lambda: site.admitted_path(path))
        f.file_policy["files"][0]["path"] = "onvif/support/reports/private.json"
        self.edited()
        self.error("ALLOWLIST", f.prepare)

    def test_public_source_status_is_required_but_false_formal_approvals_allow_site(self):
        f = self.fixture
        plan = f.prepare()
        landing = (f.output / "index.html").read_text(encoding="utf-8")
        self.assertIn("Public GitHub source repository", landing)
        self.assertIn("Formal publication approvals remain false", landing)
        self.assertIn("Unassigned", landing)
        self.assertIn("no new rights", landing)
        self.assertEqual(plan.manifest["sourceVisibility"], "public")
        f.policy["sourceVisibility"] = "private"
        self.edited()
        self.error("POLICY", f.plan)

    def test_resource_limits_are_bounded_and_site_size_boundary_is_exact(self):
        f = self.fixture
        baseline = f.plan()
        size = sum(item.bytes for item in baseline.stamps.values())
        for limit, allowed in ((size + 1, True), (size, False), (size - 1, False)):
            with self.subTest(limit=limit):
                f.policy["limits"]["siteBytes"] = limit
                self.edited()
                if allowed:
                    self.assertEqual(sum(item.bytes for item in f.plan().stamps.values()), size)
                else:
                    self.error("SIZE", f.plan)
        f.policy["limits"]["siteBytes"] = site.MAX_BYTES + 1
        self.edited()
        self.error("POLICY", f.plan)

    def test_file_count_limit_is_derived_from_actual_selection(self):
        f = self.fixture
        expected = len(f.plan().stamps)
        f.policy["limits"]["files"] = expected
        self.edited()
        self.assertEqual(len(f.plan().stamps), expected)
        f.policy["limits"]["files"] = expected - 1
        self.edited()
        self.error("SIZE", f.plan)

    def test_real_checker_command_failure_is_not_a_success_certificate(self):
        f = self.fixture
        self.error("SOURCE_CHECK", lambda: site.run_process(
            [sys.executable, "-c", "raise SystemExit(9)"], f.root, "SOURCE_CHECK"))
        self.error("SOURCE_CHECK", lambda: site.run_process(
            [str(f.base / "missing-node")], f.root, "SOURCE_CHECK"))
        self.error("PATH_CASE", lambda: site.committed_certificate(site.SourceTree(f.root), None))

    def test_process_arguments_are_not_interpolated_as_shell_code(self):
        token = 'literal; & echo "not a command"'
        output = site.run_process([sys.executable, "-c", "import sys;print(sys.argv[1])", token],
                                  self.fixture.root, "COMMAND")
        self.assertEqual(output.decode().strip(), token)


class FilesystemTests(FixtureCase):
    def test_existing_output_is_never_wiped_including_empty_directory(self):
        f = self.fixture
        f.output.mkdir()
        self.error("OUTPUT", f.prepare)
        marker = f.output / "keep.txt"
        marker.write_bytes(b"user data")
        self.error("OUTPUT", f.prepare)
        self.assertEqual(marker.read_bytes(), b"user data")

    def test_repository_descendant_ancestor_and_parent_traversal_are_not_outputs(self):
        f = self.fixture
        for output in (f.root, f.root / "site", f.base, f.base / "unused" / ".." / "stage"):
            with self.subTest(output=output):
                self.error("OUTPUT", lambda: site.prepare(f.root, BASE, output, certificate_reader=f.verified_certificate))
        self.assertTrue((f.root / ".git").is_dir())

    def test_missing_output_parent_is_not_created(self):
        f = self.fixture
        output = f.base / "unknown-parent" / "site"
        self.error("FILESYSTEM", lambda: site.prepare(f.root, BASE, output, certificate_reader=f.verified_certificate))
        self.assertFalse(output.parent.exists())

    def test_portable_paths_reject_traversal_aliases_and_windows_reserved_names(self):
        for path in ("../private.json", "/absolute.json", "C:/drive.json", "av\\file.json",
                     "av/%2fsecret.json", "av/a/../b.json", "av//b.json", "av/file.json:stream",
                     "av/AUX.txt", "av/CON.json", "av/trailing./x.json", ".hidden.json",
                     "av/line\nbreak.json", "av/../.git/config"):
            with self.subTest(path=path):
                self.error("PATH", lambda: site.portable_path(path))
        self.assertEqual(site.portable_path(".nojekyll"), ".nojekyll")

    def test_unicode_casefold_and_directory_collisions_are_rejected(self):
        for paths in (["av/A.json", "av/a.json"], ["av/A/x.json", "av/a/y.json"],
                      ["av/\u212a.json", "av/K.json"], ["av/ss.json", "av/\u00df.json"],
                      ["av/a", "av/a/b.json"]):
            with self.subTest(paths=paths):
                with self.assertRaises(site.SiteError) as caught:
                    site.unique_paths(paths)
                self.assertIn(caught.exception.code, {"PATH", "PATH_COLLISION"})
        self.error("PATH", lambda: site.portable_path("av/e\u0301.json"))

    def test_source_case_is_checked_on_case_insensitive_filesystems(self):
        f = self.fixture
        file = f.root / "av/terms.json"
        file.rename(f.root / "av/intermediate.json")
        (f.root / "av/intermediate.json").rename(f.root / "av/TERMS.json")
        self.error("PATH_CASE", lambda: f.prepare(preview=True))

    def test_source_hardlinks_are_rejected_before_copy(self):
        f = self.fixture
        os.link(f.root / "av/terms.json", f.base / "linked-input.json")
        self.error("LINK", lambda: f.prepare(preview=True))
        self.assertFalse(f.output.exists())

    def test_staged_hardlinks_are_rejected_even_with_matching_bytes(self):
        f = self.fixture
        f.prepare()
        os.link(f.output / "av/terms.json", f.base / "linked-stage.json")
        self.error("LINK", f.check)

    def test_native_symlink_file_directory_and_output_ancestors_are_rejected(self):
        f = self.fixture
        target = f.base / "owned-target"
        target.mkdir()
        (target / "sample.json").write_bytes(b"{}\n")
        link = f.base / "test-link"
        try:
            os.symlink(target, link, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"Native symlink creation unavailable ({error.errno}); junction/reparse and hardlink cases still run")
        self.error("LINK", lambda: site.read_bytes(link / "sample.json"))
        self.error("LINK", lambda: site.prepare(f.root, BASE, link / "stage", certificate_reader=f.verified_certificate))
        file_link = f.base / "file-link.json"
        os.symlink(target / "sample.json", file_link)
        self.error("LINK", lambda: site.read_bytes(file_link))

    def test_windows_reparse_ancestor_is_rejected(self):
        f = self.fixture
        original = Path.lstat

        def reparse(path):
            value = original(path)
            if path == f.root / "av":
                return SimpleNamespace(st_mode=value.st_mode, st_file_attributes=0x400)
            return value

        with patch.object(Path, "lstat", reparse):
            self.error("LINK", lambda: site.read_bytes(f.root / "av/terms.json"))

    def test_native_windows_junction_is_rejected_without_following_it(self):
        if os.name != "nt":
            self.assertEqual(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400), 0x400)
            return
        f = self.fixture
        target, junction = f.base / "junction-target", f.base / "junction"
        target.mkdir()
        result = subprocess.run([os.environ.get("COMSPEC", "cmd.exe"), "/c", "mklink", "/J",
                                 str(junction), str(target)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        self.error("LINK", lambda: site.prepare(f.root, BASE, junction / "stage", certificate_reader=f.verified_certificate))
        self.assertEqual(list(target.iterdir()), [])

    def test_file_limit_is_checked_before_large_read(self):
        f = self.fixture
        path = f.base / "bounded.txt"
        path.write_bytes(b"abcdef")
        self.assertEqual(site.read_bytes(path, 6), b"abcdef")
        self.error("SIZE", lambda: site.read_bytes(path, 5))
        self.assertEqual(site.fingerprint(path, 6), site.Fingerprint(6, sha(b"abcdef")))

    def test_site_check_uses_bounded_reads_for_selected_json(self):
        f = self.fixture
        f.write("av/terms.json", f.read("av/terms.json") + b" " * (site.CHUNK * 2))
        self.edited()
        prepared = f.prepare()
        with bounded_reads() as readers:
            checked = f.check()
        self.assertEqual(checked.content_sha256, prepared.content_sha256)
        selected = [reader for path, reader in readers if path == f.root / "av/terms.json"]
        self.assertGreaterEqual(len(selected), 2)
        self.assertTrue(all(reader.bytes_read == len(f.read("av/terms.json")) for reader in selected))
        self.assertTrue(all(max(reader.requests) <= site.CHUNK for reader in selected))

    def test_extra_hidden_missing_and_corrupt_stage_files_fail(self):
        f = self.fixture
        f.prepare()
        extra = f.output / "av/extra.json"
        extra.write_bytes(b"{}\n")
        self.error("SITE_MEMBERS", f.check)
        extra.unlink()
        hidden = f.output / ".gitkeep"
        hidden.write_bytes(b"")
        self.error("PATH", f.check)
        hidden.unlink()
        selected = f.output / "av/terms.json"
        original = selected.read_bytes()
        selected.unlink()
        self.error("SITE_MEMBERS", f.check)
        selected.write_bytes(original + b" ")
        self.error("SITE_DIGEST", f.check)

    def test_forged_manifest_cannot_authorize_changed_stage_bytes(self):
        f = self.fixture
        plan = f.prepare()
        forged = copy.deepcopy(plan.manifest)
        target = f.output / "av/terms.json"
        data = b'{"forged":true}\n'
        target.write_bytes(data)
        for row in forged["files"]:
            if row["path"] == "av/terms.json":
                row["bytes"], row["sha256"] = len(data), sha(data)
        forged["payloadBytes"] = sum(row["bytes"] for row in forged["files"])
        forged["contentSha256"] = site.manifest_content_sha(forged)
        (f.output / "site-manifest.json").write_bytes(encoded(forged))
        self.error("MANIFEST", f.check)


class CommandAndMetadataTests(FixtureCase):
    def test_prepare_check_and_archive_workflow_outputs_are_exactly_one_verified_digest(self):
        f = self.fixture
        output = f.base / "github-output"
        output.write_bytes(b"")
        original_prepare, original_check, original_archive = site.prepare, site.check, site.verify_archive

        def injected(function):
            def invoke(*args, **kwargs):
                kwargs["certificate_reader"] = f.verified_certificate
                return function(*args, **kwargs)
            return invoke

        with patch.object(site, "ROOT", f.root), patch.object(site, "prepare", side_effect=injected(original_prepare)), \
                patch.object(site, "check", side_effect=injected(original_check)), \
                patch.object(site, "verify_archive", side_effect=injected(original_archive)), \
                patch.dict(os.environ, {"GITHUB_SHA": f.certificate.source_commit, "GITHUB_OUTPUT": str(output)}):
            with contextlib.redirect_stdout(io.StringIO()) as printed:
                result = site.main(["prepare", "--base-path", BASE, "--output", str(f.output)])
            self.assertEqual(result, 0)
            plan = f.plan()
            expected = f"content_sha256={plan.content_sha256}\n"
            self.assertEqual(printed.getvalue(), expected)
            self.assertEqual(output.read_text(), expected)
            with contextlib.redirect_stdout(io.StringIO()) as printed:
                self.assertEqual(site.main(["check", "--site", str(f.output)]), 0)
            self.assertEqual(printed.getvalue(), expected)
            self.assertEqual(output.read_text(), expected)
            archive = f.tar(plan)
            output.write_bytes(b"")
            with contextlib.redirect_stdout(io.StringIO()) as printed:
                self.assertEqual(site.main(["verify-archive", "--site", str(f.output), "--archive", str(archive)]), 0)
            self.assertEqual(printed.getvalue(), expected)
            self.assertEqual(output.read_text(), expected)

    def test_preview_does_not_emit_a_deployment_job_output(self):
        f = self.fixture
        output = f.base / "github-output"
        output.write_bytes(b"")
        original = site.prepare

        def injected(*args, **kwargs):
            return original(*args, **kwargs, certificate_reader=f.verified_certificate)

        with patch.object(site, "ROOT", f.root), patch.object(site, "prepare", side_effect=injected), \
                patch.dict(os.environ, {"GITHUB_SHA": f.certificate.source_commit, "GITHUB_OUTPUT": str(output)}), \
                contextlib.redirect_stdout(io.StringIO()) as printed:
            self.assertEqual(site.main(["prepare", "--base-path", BASE, "--output", str(f.output), "--preview"]), 0)
        self.assertRegex(printed.getvalue(), r"^content_sha256=[0-9a-f]{64}\n$")
        self.assertEqual(output.read_bytes(), b"")
        self.assertEqual(json.loads((f.output / "site-manifest.json").read_bytes())["provenance"]["mode"],
                         "preview-uncommitted")

    def test_invalid_github_sha_has_no_success_output_or_personal_path(self):
        f = self.fixture
        with patch.object(site, "ROOT", f.root), patch.dict(os.environ, {"GITHUB_SHA": "abc\nspoof=value"}), \
                contextlib.redirect_stdout(io.StringIO()) as printed, contextlib.redirect_stderr(io.StringIO()) as errors:
            result = site.main(["prepare", "--base-path", BASE, "--output", str(f.output)])
        self.assertEqual(result, 1)
        self.assertEqual(printed.getvalue(), "")
        self.assertIn("SOURCE_COMMIT", errors.getvalue())
        self.assertNotIn(str(f.root), errors.getvalue())
        self.assertNotIn("spoof=value", errors.getvalue())
        self.assertFalse(f.output.exists())

    def test_github_output_rejects_token_injection_existing_data_and_hardlinks(self):
        f = self.fixture
        output = f.base / "github-output"
        output.write_bytes(b"user=value\n")
        with patch.dict(os.environ, {"GITHUB_OUTPUT": str(output)}), contextlib.redirect_stdout(io.StringIO()) as printed:
            self.error("OUTPUT", lambda: site.emit_digest("a" * 64 + "\nspoof=true", github_output=True))
            self.error("OUTPUT", lambda: site.emit_digest("a" * 64, github_output=True))
            self.assertEqual(output.read_bytes(), b"user=value\n")
            output.write_bytes(b"")
            os.link(output, f.base / "linked-github-output")
            self.error("OUTPUT", lambda: site.emit_digest("a" * 64, github_output=True))
            self.assertEqual(printed.getvalue(), "")

    def test_smoke_supports_configure_pages_aliases_and_rejects_conflicts(self):
        expected = {"site_url": self.fixture.policy["siteUrl"], "base_path": BASE,
                    "expected_commit": self.fixture.certificate.source_commit, "content_sha": "a" * 64}
        with patch.dict(os.environ, {"SITE_URL": expected["site_url"], "SITE_BASE_PATH": BASE[:-1],
                                     "EXPECTED_COMMIT": expected["expected_commit"],
                                     "EXPECTED_CONTENT_SHA256": expected["content_sha"]}, clear=True):
            self.assertEqual(site.smoke_environment(), expected)
            with patch.dict(os.environ, {"BASE_PATH": BASE, "CONTENT_SHA": "a" * 64}):
                self.assertEqual(site.smoke_environment(), expected)
            with patch.dict(os.environ, {"BASE_PATH": "/wrong/"}):
                self.error("SMOKE_INPUT", site.smoke_environment)
            with patch.dict(os.environ, {"CONTENT_SHA": "b" * 64}):
                self.error("SMOKE_INPUT", site.smoke_environment)

    def test_malformed_manifest_provenance_fails_without_traceback(self):
        f = self.fixture
        f.output.mkdir()
        (f.output / "site-manifest.json").write_bytes(b'{"provenance":[]}\n')
        with patch.object(site, "ROOT", f.root), contextlib.redirect_stdout(io.StringIO()) as printed, \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(site.main(["check", "--site", str(f.output)]), 1)
        self.assertEqual(printed.getvalue(), "")
        self.assertIn("MANIFEST", errors.getvalue())
        self.assertNotIn("Traceback", errors.getvalue())
        self.assertNotIn(str(f.root), errors.getvalue())

    def test_remote_metadata_shapes_do_not_coerce_floats_or_unhashable_keys(self):
        f = self.fixture
        plan = f.plan()
        for field, bad_value, code in (("bytes", "5", "SMOKE_CONTENT"), ("bytes", True, "SMOKE_CONTENT"),
                                       ("sha256", ["a" * 64], "SMOKE_CONTENT")):
            with self.subTest(field=field, value=bad_value):
                manifest = copy.deepcopy(plan.manifest)
                manifest["files"][0][field] = bad_value
                self.error(code, lambda: site.validate_public_manifest(
                    manifest, plan.config, plan.selection, plan.manifest["sourceCommit"], plan.content_sha256))
        manifest = copy.deepcopy(plan.manifest)
        manifest["transformations"][0]["hrefBefore"] = []
        self.error("SMOKE_CONTENT", lambda: site.validate_public_manifest(
            manifest, plan.config, plan.selection, plan.manifest["sourceCommit"], plan.content_sha256))

    def test_source_html_race_cannot_change_certified_presentation(self):
        f = self.fixture
        original = site.SourceTree.read

        def changed(tree, name, limit=site.MAX_FILE_BYTES):
            data = original(tree, name, limit)
            if name == "av/index.html":
                return data.replace(b"edition change record", b"uncertified edit")
            return data

        with patch.object(site.SourceTree, "read", changed):
            self.error("STALE_CERTIFICATE", f.prepare)
        self.assertFalse(f.output.exists())


class ArchiveTests(FixtureCase):
    def test_gnu_pax_markers_are_metadata_only_not_payload_path_exceptions(self):
        truncated = "./onvif/models/abstract/0.2-proposed/services/PaxHeaders/AuthenticationBehaviorBinding_43dd4bf43c17."
        self.assertEqual(len(truncated.encode("utf-8")), 100)
        for name in ("./PaxHeaders/.", truncated):
            self.assertEqual(site.tar_name(name, metadata=True), "@PaxHeader")
            self.error("PATH", lambda: site.tar_name(name))
        for name in ("./PaxHeaders/..", "./../PaxHeaders/.", "./PaxHeaders/./index.html",
                     truncated[:-2] + ".", truncated[:-2] + "..",
                     truncated.replace("PaxHeaders", "NotHeaders")):
            with self.subTest(path=name):
                self.error("PATH", lambda: site.tar_name(name, metadata=True))

    def test_real_gnu_tar_posix_long_path_matches_upload_action_and_gnu_format_fails(self):
        tar = shutil.which("tar")
        if tar is None:
            self.skipTest("GNU tar is not provisioned")
        version = subprocess.run([tar, "--version"], check=True, stdout=subprocess.PIPE, text=True).stdout
        if "GNU tar" not in version:
            self.skipTest("The selected tar is not GNU tar")
        f = self.fixture
        name = "onvif/models/abstract/0.2-proposed/services/PausableSubscriptionManagerBinding_6c64f922c80e.tm.json"
        self.assertEqual(len(("./" + name).encode("utf-8")), 101)
        f.add_canonical(name, "thing-model", "https://example.org/wot/onvif/models/long.tm.json", b'{"exact":9007199254740993.1}\n')
        f.add_canonical("onvif/models/abstract/0.2-proposed/services/AuthenticationBehaviorBinding_43dd4bf43c17.tm.json",
                        "thing-model", "https://example.org/wot/onvif/models/truncated-marker.tm.json", b"{}\n")
        self.edited(review=True)
        plan = f.prepare()
        archive = f.base / "artifact.tar"
        command = [tar, "--dereference", "--hard-dereference", "--directory", f.output.name,
                   "--create", "--file", archive.name, "--exclude=.git", "--exclude=.github", "."]
        subprocess.run(command, cwd=f.base, env=dict(os.environ, TAR_OPTIONS="--format=posix"),
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        with tarfile.open(archive) as actual:
            info = actual.getmember("./" + name)
            self.assertEqual(info.pax_headers["path"], "./" + name)
            self.assertEqual(actual.extractfile(info).read(), f.read(name))
        checked = site.verify_archive(f.root, archive, f.output, certificate_reader=f.verified_certificate)
        self.assertEqual(checked.content_sha256, plan.content_sha256)
        subprocess.run(command, cwd=f.base, env=dict(os.environ, TAR_OPTIONS="--format=gnu"),
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        self.error("ARCHIVE_TYPE", lambda: site.inspect_archive(archive, plan))

    def test_exact_archive_with_directory_headers_and_safe_pax_is_accepted(self):
        f = self.fixture
        name = "onvif/models/native/Feature-" + "a" * 70 + ".tm.json"
        f.add_canonical(name, "thing-model", "https://example.org/wot/onvif/models/long.tm.json", b"{}\n")
        self.edited(review=True)
        plan = f.prepare()
        archive = f.tar(plan, directories=True)
        checked = site.verify_archive(f.root, archive, f.output, certificate_reader=f.verified_certificate)
        self.assertEqual(checked.content_sha256, plan.content_sha256)
        self.assertEqual(set(checked.stamps), set(plan.stamps))

    def test_archive_extra_missing_duplicate_and_changed_bytes_are_rejected(self):
        f = self.fixture
        plan = f.prepare()
        records = [(name, (f.output / name).read_bytes(), tarfile.REGTYPE) for name in sorted(plan.stamps)]
        changed = [(name, data + b"x" if name == "av/terms.json" else data, kind) for name, data, kind in records]
        variants = ((records + [("extra.json", b"{}", tarfile.REGTYPE)], "ARCHIVE_MEMBERS"),
                    (records[1:], "ARCHIVE_MEMBERS"),
                    (records + [records[0]], "ARCHIVE_MEMBERS"),
                    (changed, "ARCHIVE_SIZE"))
        for entries, code in variants:
            with self.subTest(code=code):
                archive = f.tar(plan, entries)
                self.error(code, lambda: site.inspect_archive(archive, plan))
        changed = [(name, data.replace(b"pointer target", b"altered target") if name == "av/terms.json" else data, kind)
                   for name, data, kind in records]
        self.error("ARCHIVE_DIGEST", lambda: site.inspect_archive(f.tar(plan, changed), plan))

    def test_archive_cannot_forge_its_own_site_manifest(self):
        f = self.fixture
        plan = f.prepare()
        records = [(name, (f.output / name).read_bytes(), tarfile.REGTYPE) for name in sorted(plan.stamps)]
        forged = [(name, data.replace(b'"sourceVisibility": "public"', b'"sourceVisibility": "PUBLIC"')
                   if name == "site-manifest.json" else data, kind) for name, data, kind in records]
        self.error("ARCHIVE_DIGEST", lambda: site.inspect_archive(f.tar(plan, forged), plan))

    def test_tar_absolute_traversal_encoded_and_backslash_paths_are_rejected(self):
        f = self.fixture
        plan = f.prepare()
        for name in ("../outside.json", "/absolute.json", "C:/drive.json", "av\\terms.json",
                     "%2fprivate.json", "././index.html", "av/../index.html", ".hidden"):
            with self.subTest(name=name):
                self.error("PATH", lambda: site.inspect_archive(f.tar(plan, [(name, b"{}", tarfile.REGTYPE)]), plan))

    def test_tar_symlinks_hardlinks_devices_fifo_and_gnu_extensions_are_rejected(self):
        f = self.fixture
        plan = f.prepare()
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE,
                     tarfile.FIFOTYPE, tarfile.GNUTYPE_LONGNAME):
            with self.subTest(kind=kind):
                archive = f.tar(plan, [("index.html", b"", kind)])
                self.error("ARCHIVE_TYPE", lambda: site.inspect_archive(archive, plan))

    def test_oversized_tar_payload_is_rejected_before_allocation(self):
        f = self.fixture
        plan = f.prepare()
        info = tarfile.TarInfo("av/terms.json")
        info.size = 999_999_999
        archive = f.base / "oversized.tar"
        archive.write_bytes(info.tobuf() + bytes(1024))
        reads, original = [], site.exact_read

        def bounded(stream, count):
            reads.append(count)
            return original(stream, count)

        with patch.object(site, "exact_read", bounded):
            self.error("ARCHIVE_SIZE", lambda: site.inspect_archive(archive, plan))
        self.assertEqual(reads, [512])

    def test_pax_metadata_is_bounded_and_path_override_cannot_escape(self):
        f = self.fixture
        plan = f.prepare()
        archive = f.base / "pax.tar"
        for fields, code in (({"path": "../outside.json"}, "PATH"),
                             ({"GNU.sparse.map": "0,100"}, "ARCHIVE_PAX"),
                             ({"size": "1000000000"}, "ARCHIVE_SIZE")):
            with self.subTest(fields=fields):
                data = tarfile.TarInfo.create_pax_global_header(fields)
                archive.write_bytes(data + bytes(1024))
                self.error(code, lambda: site.inspect_archive(archive, plan))
        info = tarfile.TarInfo("PaxHeaders/index.html")
        info.type, info.size = tarfile.XHDTYPE, site.CHUNK + 1
        archive.write_bytes(info.tobuf() + bytes(1024))
        self.error("ARCHIVE_PAX", lambda: site.inspect_archive(archive, plan))
        self.error("ARCHIVE_PAX", lambda: site.pax_fields(b"11 mtime=1\n11 mtime=2\n"))

    def test_tar_truncation_nonzero_tail_and_unsafe_directory_fail(self):
        f = self.fixture
        plan = f.prepare()
        archive = f.tar(plan)
        original = archive.read_bytes()
        archive.write_bytes(original + b"hidden second archive")
        self.error("ARCHIVE_END", lambda: site.inspect_archive(archive, plan))
        archive.write_bytes(original[:512])
        self.error("ARCHIVE_TRUNCATED", lambda: site.inspect_archive(archive, plan))
        archive = f.tar(plan, [("unapproved/", b"", tarfile.DIRTYPE)])
        self.error("ARCHIVE_MEMBERS", lambda: site.inspect_archive(archive, plan))

    def test_archive_byte_limit_is_strict_and_archive_hardlinks_are_rejected(self):
        f = self.fixture
        plan = f.prepare()
        archive = f.tar(plan)
        size = archive.stat().st_size
        plan.config.policy["limits"]["archiveBytes"] = size + 1
        site.inspect_archive(archive, plan)
        plan.config.policy["limits"]["archiveBytes"] = size
        self.error("SIZE", lambda: site.inspect_archive(archive, plan))
        plan.config.policy["limits"]["archiveBytes"] = site.MAX_BYTES
        os.link(archive, f.base / "archive-hardlink.tar")
        self.error("LINK", lambda: site.inspect_archive(archive, plan))


class FixtureHTTP:
    def __init__(self, fixture, plan):
        self.fixture, self.plan = fixture, plan
        self.overrides, self.calls, self.delays = {}, [], {}
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def do_GET(self):
                route = urlsplit(self.path).path
                owner.calls.append((self.command, self.path, dict(self.headers)))
                response = owner.overrides.get(route)
                if callable(response):
                    response = response()
                if response is None:
                    relative = route.removeprefix(BASE)
                    if route.startswith(BASE) and (not relative or relative.endswith("/")):
                        relative += "index.html"
                    if route.startswith(BASE) and relative in plan.stamps:
                        body = (fixture.output / relative).read_bytes()
                        media = "text/html" if relative.endswith(".html") else "application/json"
                        response = (200, {"Content-Type": media}, body)
                    else:
                        response = (404, {"Content-Type": "text/html"}, b"not found")
                status, headers, body = response
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if route in owner.delays:
                    time.sleep(owner.delays[route])
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class Clock:
    def __init__(self):
        self.value = 0.0

    def now(self):
        return self.value

    def sleep(self, delay):
        self.value += delay


class SmokeTests(FixtureCase):
    def setUp(self):
        super().setUp()
        self.plan = self.fixture.prepare()
        self.http = FixtureHTTP(self.fixture, self.plan)
        self.addCleanup(self.http.close)

    def smoke(self, **options):
        values = {"site_url": self.http.origin + BASE, "base_path": BASE,
                  "expected_commit": self.plan.manifest["sourceCommit"], "content_sha": self.plan.content_sha256,
                  "allow_test_origin": self.http.origin, "deadline_seconds": 2, "retry_seconds": .05}
        values.update(options)
        return site.smoke(self.fixture.root, **values)

    def finite_failure(self, code, **options):
        clock = Clock()
        options.update(deadline_seconds=.2, retry_seconds=.1, clock=clock.now, sleep=clock.sleep)
        error = self.error(code, lambda: self.smoke(**options))
        self.assertEqual(clock.value, .2)
        self.assertIn("no rollback", str(error))

    def test_owned_http_smoke_checks_every_policy_target_without_credentials_or_proxies(self):
        self.http.overrides[BASE + "site-manifest.json"] = (
            200, {"Content-Type": "application/json", "Set-Cookie": "auth=must-not-be-returned"},
            (self.fixture.output / "site-manifest.json").read_bytes())
        with patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "HTTPS_PROXY": "http://127.0.0.1:1",
                                     "GITHUB_TOKEN": "not-transmitted", "COOKIE": "not-transmitted"}):
            self.assertEqual(self.smoke(), self.plan.content_sha256)
        requested = {urlsplit(path).path for _, path, _ in self.http.calls}
        self.assertEqual(requested, {BASE + "site-manifest.json"} |
                         {BASE + item["requestPath"] for item in self.fixture.policy["smoke"]})
        self.assertEqual(len(self.http.calls), 1 + len(self.fixture.policy["smoke"]))
        for method, path, headers in self.http.calls:
            self.assertEqual(method, "GET")
            self.assertEqual(urlsplit(path).query, "content_sha256=" + self.plan.content_sha256)
            self.assertNotIn("Authorization", headers)
            self.assertNotIn("Cookie", headers)
            self.assertEqual(headers["Accept-Encoding"], "identity")

    def test_production_origin_is_exact_and_test_override_requires_literal_loopback(self):
        policy = self.fixture.policy
        self.assertEqual(site.smoke_origin(policy["siteUrl"], policy, None), "https://marcschier.github.io")
        for url in ("http://marcschier.github.io/wot-av-extension/",
                    "https://other.github.io/wot-av-extension/", "https://marcschier.github.io:443/wot-av-extension/",
                    "https://name:secret@marcschier.github.io/wot-av-extension/",
                    "https://marcschier.github.io/wot-av-extension/?key=secret",
                    "https://marcschier.github.io/elsewhere/", "https://marcschier.github.io/wot-av-extension/#x"):
            with self.subTest(url=url):
                self.error("SMOKE_ORIGIN", lambda: site.smoke_origin(url, policy, None))
        for origin in ("http://localhost:99", "http://192.0.2.1:99", "https://127.0.0.1:99"):
            with self.subTest(origin=origin):
                self.error("SMOKE_ORIGIN", lambda: site.smoke_origin(origin + BASE, policy, origin))
        self.assertEqual(self.http.calls, [])

    def test_200_error_page_is_not_a_successful_deployment(self):
        self.http.overrides[BASE] = (200, {"Content-Type": "text/html"}, b"<html>404 error</html>")
        self.finite_failure("DEPLOYED_CONTENT_MISMATCH")

    def test_wrong_json_content_type_is_not_accepted_by_hash_alone(self):
        path = "av/terms.json"
        self.http.overrides[BASE + path] = (200, {"Content-Type": "text/html"},
                                            (self.fixture.output / path).read_bytes())
        self.finite_failure("DEPLOYED_CONTENT_MISMATCH")

    def test_metadata_commit_hash_and_html_json_parse_failures_are_distinct_from_unavailable(self):
        manifest = copy.deepcopy(self.plan.manifest)
        manifest["sourceCommit"] = "b" * 40
        self.http.overrides[BASE + "site-manifest.json"] = (200, {"Content-Type": "application/json"}, encoded(manifest))
        self.finite_failure("DEPLOYED_CONTENT_MISMATCH")
        self.http.overrides[BASE + "site-manifest.json"] = (200, {"Content-Type": "application/json"}, b"<html>not JSON</html>")
        self.finite_failure("DEPLOYED_CONTENT_MISMATCH")
        self.http.overrides[BASE + "site-manifest.json"] = (404, {"Content-Type": "text/html"}, b"not deployed")
        self.finite_failure("SITE_UNAVAILABLE")

    def test_served_manifest_cannot_add_arbitrary_network_probe_paths(self):
        manifest = copy.deepcopy(self.plan.manifest)
        manifest["files"][0]["path"] = "https://outside.example/steal"
        manifest["contentSha256"] = site.manifest_content_sha(manifest)
        self.http.overrides[BASE + "site-manifest.json"] = (200, {"Content-Type": "application/json"}, encoded(manifest))
        self.finite_failure("DEPLOYED_CONTENT_MISMATCH", content_sha=manifest["contentSha256"])
        self.assertEqual({urlsplit(path).path for _, path, _ in self.http.calls}, {BASE + "site-manifest.json"})

    def test_bounded_retry_accepts_later_cdn_content_without_rollback(self):
        remaining = [True]

        def not_yet():
            if remaining:
                remaining.pop()
                return (404, {"Content-Type": "text/html"}, b"not yet")
            return None

        self.http.overrides[BASE + "site-manifest.json"] = not_yet
        clock = Clock()
        self.assertEqual(self.smoke(clock=clock.now, sleep=clock.sleep), self.plan.content_sha256)
        self.assertEqual(clock.value, .05)
        self.assertEqual(len(self.http.calls), 2 + len(self.fixture.policy["smoke"]))

    def test_cross_origin_redirect_is_refused_without_following_it(self):
        self.http.overrides[BASE + "site-manifest.json"] = (
            301, {"Location": "https://outside.example/steal", "Content-Type": "text/html"}, b"")
        self.error("SMOKE_REDIRECT", self.smoke)
        self.assertEqual(len(self.http.calls), 1)

    def test_only_canonical_same_origin_trailing_slash_redirect_is_followed(self):
        self.http.overrides[BASE + "av"] = (301, {"Location": "av/", "Content-Type": "text/html"}, b"")
        data, media = site.fetch_public(self.http.origin + BASE + "av?content_sha256=" + self.plan.content_sha256,
                                       base_path=BASE, limit=self.plan.stamps["av/index.html"].bytes,
                                       deadline=time.monotonic() + 2)
        self.assertEqual(media, "text/html")
        self.assertEqual(data, (self.fixture.output / "av/index.html").read_bytes())
        self.assertEqual(len(self.http.calls), 2)
        self.assertTrue(self.http.calls[1][1].endswith("content_sha256=" + self.plan.content_sha256))

    def test_http_response_size_and_deadline_are_bounded(self):
        self.http.overrides[BASE + "large.json"] = (200, {"Content-Type": "application/json"}, b"x" * 100)
        self.error("SMOKE_CONTENT", lambda: site.fetch_public(self.http.origin + BASE + "large.json",
                   base_path=BASE, limit=10, deadline=time.monotonic() + 1))
        self.http.overrides[BASE + "slow.json"] = (200, {"Content-Type": "application/json"}, b"{}")
        self.http.delays[BASE + "slow.json"] = .2
        started = time.monotonic()
        self.error("HTTP_UNAVAILABLE", lambda: site.fetch_public(self.http.origin + BASE + "slow.json",
                   base_path=BASE, limit=2, deadline=started + .05))
        self.assertLess(time.monotonic() - started, 1)

    def test_smoke_rejects_preview_and_malformed_digest_before_probing(self):
        self.error("SMOKE_INPUT", lambda: self.smoke(content_sha="abc\nother=value"))
        self.error("SMOKE_INPUT", lambda: self.smoke(expected_commit="0" * 40))
        self.assertEqual(self.http.calls, [])
        manifest = copy.deepcopy(self.plan.manifest)
        manifest["provenance"]["mode"] = "preview-uncommitted"
        self.http.overrides[BASE + "site-manifest.json"] = (200, {"Content-Type": "application/json"}, encoded(manifest))
        self.finite_failure("DEPLOYED_CONTENT_MISMATCH")

    def test_unapproved_test_origin_and_release_flags_are_not_cli_options(self):
        with contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaises(SystemExit) as caught:
                site.main(["smoke", "--allow-test-origin", self.http.origin])
        self.assertEqual(caught.exception.code, 2)

        self.assertIn("unrecognized arguments", errors.getvalue())
        for flag in ("--release", "--release=false"):
            with self.subTest(flag=flag), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as caught:
                    site.main(["prepare", "--base-path", BASE, "--output", str(self.fixture.base / "never"), flag])
                self.assertEqual(caught.exception.code, 2)


class TimingTests(FixtureCase):
    def test_180_second_limit_is_accepted_and_larger_or_nonpositive_limits_are_rejected(self):
        f = self.fixture
        plan = f.prepare()
        server = FixtureHTTP(f, plan)
        self.addCleanup(server.close)
        arguments = {"site_url": server.origin + BASE, "base_path": BASE,
                     "expected_commit": plan.manifest["sourceCommit"], "content_sha": plan.content_sha256,
                     "allow_test_origin": server.origin}
        self.assertEqual(site.smoke(f.root, deadline_seconds=180, **arguments), plan.content_sha256)
        server.calls.clear()
        for seconds in (181, 0, -1):
            with self.subTest(seconds=seconds):
                self.error("SMOKE_INPUT", lambda: site.smoke(f.root, deadline_seconds=seconds, **arguments))
        self.error("SMOKE_INPUT", lambda: site.smoke(f.root, retry_seconds=11, **arguments))
        self.assertEqual(server.calls, [])

    def test_request_timeout_is_ten_seconds_or_the_remaining_global_budget(self):
        plan = self.fixture.prepare()
        server = FixtureHTTP(self.fixture, plan)
        self.addCleanup(server.close)
        constructors, socket_timeouts = [], []

        class Response:
            status = 200

            def __init__(self):
                self.closed = False

            def getheader(self, name, default=None):
                return {"Content-Type": "application/json", "Content-Length": "2"}.get(name, default)

            def isclosed(self):
                return self.closed

            def read(self, count):
                self.closed = True
                return b"{}"

            def close(self):
                self.closed = True

        class Connection:
            def __init__(self, host, port, timeout):
                constructors.append(timeout)
                self.sock = SimpleNamespace(settimeout=socket_timeouts.append)

            def request(self, method, target, headers):
                if method != "GET":
                    raise AssertionError("Unexpected HTTP method")

            def getresponse(self):
                return Response()

            def close(self):
                return

        with patch.object(site.http.client, "HTTPConnection", Connection):
            for remaining, expected in ((180, 10), (7, 7)):
                constructors.clear()
                socket_timeouts.clear()
                clock = Clock()
                result = site.fetch_public(server.origin + BASE + "probe.json", base_path=BASE,
                                           limit=2, deadline=remaining, clock=clock.now)
                self.assertEqual(result, (b"{}", "application/json"))
                self.assertEqual(constructors, [expected])
                self.assertEqual(socket_timeouts, [expected, expected])


class ContentTests(FixtureCase):
    def test_four_pinned_anchor_edits_preserve_source_bytes_and_positions(self):
        f = self.fixture
        f.av_body = "<p>\u03a9</p>\n" + f.av_body
        f.write_html()
        self.edited()
        originals = {path: f.read(path) for path in ("av/index.html", "onvif/index.html")}
        plan = f.prepare()
        self.assertEqual(len(plan.manifest["transformations"]), 4)
        for path, data in originals.items():
            self.assertEqual(f.read(path), data)
            expected = data
            for decision in f.policy["supportingSources"]:
                if decision["document"] != path:
                    continue
                old_tag = f'<a href="{decision["href"]}">'.encode()
                start = expected.index(old_tag)
                replacement = (f'<a href="{f.policy["repository"]}/blob/'
                               f'{f.certificate.source_commit}/{decision["sourcePath"]}">').encode()
                expected = expected[:start] + replacement + expected[start + len(old_tag):]
                closing = expected.index(b"</a>", start)
                fragment = decision["href"].partition("#")[2]
                suffix = (" (supporting source" + (f"; JSON Pointer {fragment}" if fragment else "") + ")").encode()
                expected = expected[:closing] + suffix + expected[closing:]
            self.assertEqual((f.output / path).read_bytes(), expected)
        for record in plan.manifest["transformations"]:
            source = originals[record["document"]]
            offset = record["sourceHrefByteOffset"]
            self.assertEqual(source[offset:offset + len(record["hrefBefore"])].decode(), record["hrefBefore"])
            self.assertEqual(record["sourceSha256"], sha(source))
            self.assertIn(f"/blob/{f.certificate.source_commit}/", record["hrefAfter"])
            tag_start = source.rfind(b"<a ", 0, offset)
            self.assertEqual(record["nodeStartTag"], 1 + len(re.findall(rb"<[a-zA-Z][^>]*>", source[:tag_start])))
            self.assertEqual(record["sourceLine"], 1 + source[:tag_start].count(b"\n"))
            line_start = source.rfind(b"\n", 0, tag_start) + 1
            self.assertEqual(record["sourceColumn"], len(source[line_start:tag_start].decode("utf-8")))
            self.assertIn("supporting source", record["labelSuffix"])
            self.assertNotIn("requires", record["labelSuffix"])
            self.assertIn(record["hrefAfter"].encode(), (f.output / record["document"]).read_bytes())
        self.assertIn(b'&lt;a href="support/migration/specification-clarifications.md"&gt;',
                      (f.output / "av/index.html").read_bytes())
        self.assertIn(b"JSON Pointer /vocabularyRevision", (f.output / "onvif/index.html").read_bytes())

    def test_missing_or_duplicate_approved_anchor_is_not_silently_rewritten(self):
        f = self.fixture
        original = f.av_body
        f.av_body = original.replace('href="support/migration/specification-clarifications.md"', 'href="#title"')
        f.write_html()
        self.edited()
        self.error("HTML_TRANSFORM", f.prepare)
        f.av_body = original + '<a href="support/migration/specification-clarifications.md">duplicate</a>'
        f.write_html()
        self.edited()
        self.error("HTML_TRANSFORM", f.prepare)

    def test_json_pointer_decodes_percent_then_tilde_and_checks_array_indices(self):
        data = {"a/b": {"~": ["zero", "one"]}, "~1": "literal tilde one", "": 0}
        pointer = site.decode_fragment("/a%7E1b/~0/1")
        self.assertEqual(site.json_pointer(data, pointer), "one")
        self.assertEqual(site.json_pointer(data, "/~01"), "literal tilde one")
        self.assertEqual(site.json_pointer(data, "/"), 0)
        for pointer in ("/a~1b/~0/01", "/a~1b/~0/-", "/a~1b/~0/2", "/a~2b", "/a~", "plain", "/missing"):
            with self.subTest(pointer=pointer):
                self.error("JSON_POINTER", lambda: site.json_pointer(data, pointer))
        self.error("FRAGMENT", lambda: site.decode_fragment("%ff"))
        self.error("FRAGMENT", lambda: site.decode_fragment("%Q0"))

    def test_local_links_preserve_query_case_fragments_and_project_prefix(self):
        policy = self.fixture.policy
        self.assertEqual(site.resolve_link("av/index.html", "../onvif/index.html#title", policy),
                         ("onvif/index.html", "title"))
        self.assertEqual(site.resolve_link("av/index.html", "terms.json?q=a#/%61~1b/~0", policy),
                         ("av/terms.json", "/a~1b/~0"))
        self.assertEqual(site.resolve_link("index.html", "av/", policy), ("av/index.html", ""))
        self.assertIsNone(site.resolve_link("index.html", "https://external.example/a#b", policy))
        for href in ("../../escape.json", "/different/av/", "//other.example/a", "av\\terms.json",
                     "av/%2fsecret", "av/%5csecret", "av/%252e%252e/private", "av/%2e%2e/private",
                     "av/%xx", "javascript:alert(1)", "file:///private/input", "https://user:pass@example.test/a"):
            with self.subTest(href=href):
                with self.assertRaises(site.SiteError):
                    site.resolve_link("av/index.html", href, policy)

    def test_link_case_missing_target_html_fragment_and_json_pointer_fail(self):
        f = self.fixture
        for href, code in (("TERMS.json", "LOCAL_LINK"), ("missing.json", "LOCAL_LINK"),
                           ("#missing-id", "HTML_FRAGMENT"), ("terms.json#/missing", "JSON_POINTER")):
            with self.subTest(href=href):
                f.av_body += f'<a href="{href}">bad link</a>'
                f.write_html()
                self.edited()
                f.output = f.base / ("stage-" + code.lower() + "-" + str(len(f.av_body)))
                self.error(code, f.prepare)
                f.av_body = f.av_body[:f.av_body.rfind('<a href=')]

    def test_scripts_event_handlers_remote_resources_and_css_escape_are_rejected(self):
        bad = (
            "<script>bad()</script>", '<p onclick="bad()">event</p>',
            '<img srcset="https://outside.example/a 2x">', '<iframe srcdoc="bad"></iframe>',
            '<svg><image href="https://outside.example/a"/></svg>',
            "<style>@import 'https://outside.example/a';</style>",
            r"<style>p { background: \75rl(https://outside.example/a); }</style>",
            r"<style>\40import 'x';</style>",
            "<style>p { background: image-set('https://outside.example/a'); }</style>",
            '<p style="behavior:url(#title)">bad</p>',
        )
        for markup in bad:
            with self.subTest(markup=markup):
                with self.assertRaises(site.SiteError) as caught:
                    site.HTMLAudit(document("Safe", markup).decode())
                self.assertIn(caught.exception.code, {"HTML_ACTIVE", "HTML_RESOURCE"})

    def test_csp_weakening_refresh_duplicate_id_and_malformed_html_fail(self):
        clean = document("Safe", '<p id="p">content</p>').decode()
        cases = ((clean.replace("default-src 'none'", "default-src *"), "HTML_CSP"),
                 (clean.replace("Content-Security-Policy", "refresh"), "HTML_CSP"),
                 (clean.replace("</body>", '<p id="p">duplicate</p></body>'), "HTML_ID"),
                 (clean.replace("</p>", "</div>"), "HTML_STRUCTURE"),
                 (clean.replace('href=', 'href=').replace("</head>", '<meta http-equiv="refresh" content="0"></head>'), "HTML_CSP"))
        for text, code in cases:
            with self.subTest(code=code):
                self.error(code, lambda: site.HTMLAudit(text))

    def test_css_same_document_fragments_resolve_without_fetching(self):
        f = self.fixture
        f.av_body += '<svg><defs><marker id="arrow"><path d="M0 0"/></marker></defs><path marker-end="url(#arrow)" d="M1 1"/></svg>'
        f.write_html()
        self.edited()
        f.prepare()
        f.av_body = f.av_body.replace("url(#arrow)", "url(#absent-arrow)")
        f.write_html()
        self.edited()
        f.output = f.base / "missing-css-fragment"
        self.error("HTML_FRAGMENT", f.prepare)

    def test_json_syntax_and_exact_decimal_values_are_not_rewritten(self):
        value = site.strict_json(b'{"number":9007199254740993.1,"small":1e-400}')
        self.assertEqual(str(value["number"]), "9007199254740993.1")
        self.assertEqual(str(value["small"]), "1E-400")
        for raw in (b'{"a":1,"\\u0061":2}', b'{"x":NaN}', b'{"x":Infinity}', b'"\\ud800"', b'{"x":}'):
            with self.subTest(raw=raw):
                with self.assertRaises(site.SiteError) as caught:
                    site.strict_json(raw)
                self.assertIn(caught.exception.code, {"JSON_DUPLICATE", "JSON_SYNTAX"})

    def test_privacy_scan_rejects_raw_and_json_escaped_paths_and_credentials(self):
        f = self.fixture
        target = f.base / "scan.json"
        values = (b'{"oldSource":"D:\\\\git\\\\private\\\\input"}',
                  b'{"oldSource":"\\u0043:\\u005c\\u005cUsers\\u005c\\u005ctest"}',
                  b'{"source":"/home/test/private"}',
                  b'{"token":"ghp_abcdefghijklmnopqrstuvwxyz1234567890"}',
                  b'{"url":"https://name:secret@example.test/a"}',
                  b'{"key":"-----BEGIN PRIVATE KEY-----"}')
        for value in values:
            with self.subTest(value=value):
                target.write_bytes(value)
                self.error("PUBLIC_CONTENT", lambda: site.validate_data_file(target, "sample.json", 4096))
        target.write_bytes(b'{"properties":{"password":{"type":"string"}},"access_token":{"type":"string"}}')
        site.validate_data_file(target, "sample.json", 4096)

    def test_private_selected_canonical_bytes_fail_without_stage_redaction(self):
        f = self.fixture
        f.write("onvif/requirements-index.json", encoded({"oldSource": synthetic_user_path("source")}))
        self.edited()
        original = f.read("onvif/requirements-index.json")
        self.error("PUBLIC_CONTENT", f.prepare)
        self.assertEqual(f.read("onvif/requirements-index.json"), original)

    def test_public_w3c_notice_url_is_not_mistaken_for_a_local_user_directory(self):
        f = self.fixture
        path = f.base / "original-notice.html.txt"
        original = b'<a href="https://www.w3.org/users/myprofile/">Account</a>\n'
        path.write_bytes(original)
        site.validate_data_file(path, path.name, 4096)
        self.assertEqual(path.read_bytes(), original)
        for text in ('"/home/fixture/source"', '"file:///home/fixture/source"',
                     '"https://www.w3.org/users/myprofile/" "/Users/fixture/source"',
                     '"https://username:password@www.w3.org/users/myprofile/"',
                     '"https://www.w3.org:invalid/users/myprofile/"',
                     '"&#67;&#58;&#92;Users&#92;fixture&#92;source"'):
            with self.subTest(text=text):
                self.error("PUBLIC_CONTENT", lambda: site.scan_private(text))
        site.scan_private("https://public.example/home/document")

    def test_streaming_privacy_scan_detects_markers_across_chunk_boundaries(self):
        f = self.fixture
        path = f.base / "boundary.txt"
        path.write_bytes(b"x" * (site.CHUNK - 3) + b" " + synthetic_user_path("input").encode("ascii"))
        self.error("PUBLIC_CONTENT", lambda: site.validate_data_file(path, path.name, site.CHUNK + 128))
        data = b"x" * (site.CHUNK - 12) + b' https://www.w3.org/users/myprofile/ '
        path.write_bytes(data)
        site.validate_data_file(path, path.name, site.CHUNK + 128)

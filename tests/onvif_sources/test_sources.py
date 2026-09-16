"""Offline contracts for the public ONVIF source lock, not device conformance."""

from __future__ import annotations

import copy
import hashlib
import io
import json
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

from fetch_onvif_sources import (
    SourceError,
    SourceRegistry,
    _NoRedirect,
    export_sources,
    fetch_sources,
    load_lock,
    parse_xml_metadata,
    validate_profile_catalog,
    verify_sources,
)

COMMIT = "68ee1b540a40f848c9599eba2c55b87547c588d6"
BASE = f"https://raw.githubusercontent.com/onvif/specs/{COMMIT}/"
NOTICE = b"Fixture copyright; unchanged distribution permitted; AS IS."
CHILD = (
    b'<?xml version="1.0"?>\n<!-- ' + NOTICE + b" -->\n"
    b'<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" '
    b'targetNamespace="urn:child" version="1.0"/>'
)
PARENT = (
    b'<?xml version="1.0"?>\n<!-- ' + NOTICE + b" -->\n"
    b'<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" '
    b'targetNamespace="urn:parent" version="2.0">'
    b'<xs:import namespace="urn:child" schemaLocation="../child.xsd"/>'
    b"</xs:schema>"
)


def record(identifier, relative_path, data, *, kind="xsd", notice_ids=()):
    metadata = parse_xml_metadata(data) if kind in ("wsdl", "xsd", "xml") else {}
    return {
        "id": identifier,
        "kind": kind,
        "url": BASE + relative_path.removeprefix("specs/"),
        "aliases": [],
        "relativePath": relative_path,
        "storage": "vendored",
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "redistribution": {
            "status": "permitted-unchanged",
            "basis": "Synthetic test fixture; not an ONVIF license.",
            "noticeIds": list(notice_ids),
            "requiredMarkers": [NOTICE.decode()] if kind != "notice" else [],
        },
        **metadata,
    }


class Response(io.BytesIO):
    def __init__(self, data, url, *, headers=None, status=200):
        super().__init__(data)
        self.url = url
        self.status = status
        self.headers = headers or {}

    def geturl(self):
        return self.url


class SourceFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="onvif-source-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo"
        self.cache = Path(self.temp.name) / "cache"
        self.notice = record("notice", "notices/fixture.txt", NOTICE, kind="notice")
        self.notice["url"] = "https://www.w3.org/copyright/software-license-2015/"
        self.child = record("child", "specs/wsdl/child.xsd", CHILD, notice_ids=["notice"])
        self.parent = record("parent", "specs/wsdl/nested/parent.xsd", PARENT)
        self.parent["imports"][0]["sourceId"] = "child"
        self.lock = {
            "schemaVersion": 1,
            "baseline": {"repository": "onvif/specs", "commit": COMMIT, "release": "26.06"},
            "sources": [self.parent, self.child, self.notice],
        }
        for source, data in ((self.parent, PARENT), (self.child, CHILD), (self.notice, NOTICE)):
            path = self.local(source)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def local(self, source):
        return self.root.joinpath("third_party", "onvif", *source["relativePath"].split("/"))

    def registry(self):
        return SourceRegistry(self.lock)

    def relock(self, source, data):
        source["sha256"] = hashlib.sha256(data).hexdigest()
        source["bytes"] = len(data)
        self.local(source).write_bytes(data)


class OfflineVerificationTests(SourceFixture):
    def test_complete_hash_namespace_version_import_and_notice_check_is_offline(self):
        with patch("urllib.request.build_opener", side_effect=AssertionError("network forbidden")):
            result = verify_sources(self.registry(), self.root)
        self.assertEqual(set(result), {"parent", "child", "notice"})

    def test_missing_source_is_an_error(self):
        self.local(self.child).unlink()
        with self.assertRaisesRegex(SourceError, "missing.*child"):
            verify_sources(self.registry(), self.root)

    def test_tampered_source_is_an_error(self):
        self.local(self.child).write_bytes(CHILD.replace(b"1.0", b"9.0"))
        with self.assertRaisesRegex(SourceError, "SHA-256.*child"):
            verify_sources(self.registry(), self.root)

    def test_missing_notice_fails_even_for_single_selected_xml_root(self):
        self.local(self.notice).unlink()
        with self.assertRaisesRegex(SourceError, "missing.*notice"):
            verify_sources(self.registry(), self.root, source_ids=["parent"])

    def test_stripped_notice_fails_even_if_hash_is_relocked(self):
        self.relock(self.child, CHILD.replace(NOTICE, b"removed"))
        with self.assertRaisesRegex(SourceError, "notice.*child"):
            verify_sources(self.registry(), self.root)

    def test_missing_dependency_record_fails_before_parsing(self):
        self.lock["sources"].remove(self.child)
        with self.assertRaisesRegex(SourceError, "unresolved.*child"):
            self.registry()

    def test_unrecorded_actual_import_is_not_silently_ignored(self):
        self.parent["imports"] = []
        with self.assertRaisesRegex(SourceError, "import.*parent"):
            verify_sources(self.registry(), self.root)

    def test_changed_namespace_and_version_are_not_silently_accepted(self):
        for field, value in (("targetNamespace", "urn:wrong"), ("schemaVersions", ["99.0"])):
            with self.subTest(field=field):
                lock = copy.deepcopy(self.lock)
                lock["sources"][0][field] = value
                with self.assertRaisesRegex(SourceError, "metadata|namespace"):
                    verify_sources(SourceRegistry(lock), self.root)

    def test_wrong_import_namespace_is_an_error(self):
        self.parent["imports"][0]["namespace"] = "urn:wrong"
        with self.assertRaisesRegex(SourceError, "namespace"):
            self.registry()

    def test_wrong_source_id_for_import_url_is_an_error(self):
        self.parent["imports"][0]["sourceId"] = "parent"
        with self.assertRaisesRegex(SourceError, "import"):
            self.registry()

    def test_dtd_entities_and_xinclude_never_trigger_external_fetch(self):
        for data in (
            b'<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///private">]><x>&secret;</x>',
            b'<x xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="https://example.org/x"/></x>',
            '<!DOCTYPE x [<!ENTITY secret "x">]><x/>'.encode("utf-16"),
        ):
            with self.subTest(data=data[:20]), self.assertRaises(SourceError):
                parse_xml_metadata(data)

    def test_xml_base_is_not_allowed_to_change_import_resolution(self):
        data = PARENT.replace(b'version="2.0"', b'version="2.0" xml:base="https://example.org/"')
        with self.assertRaisesRegex(SourceError, "xml:base"):
            parse_xml_metadata(data)

    def test_symbolic_link_escape_is_rejected(self):
        outside = self.root / "outside.xsd"
        outside.write_bytes(CHILD)
        target = self.local(self.child)
        target.unlink()
        try:
            target.symlink_to(outside)
        except OSError as error:
            self.skipTest(f"Host does not permit unprivileged symlinks: {error}")
        with self.assertRaisesRegex(SourceError, "symlink|escape"):
            verify_sources(self.registry(), self.root)

    def test_derived_vendor_root_cannot_hide_a_symlink(self):
        with patch.object(Path, "is_symlink", lambda path: path.name == "third_party"):
            with self.assertRaisesRegex(SourceError, "symlink|escape"):
                verify_sources(self.registry(), self.root)

    def test_registered_import_lookup_is_local_and_namespace_sensitive(self):
        with patch("urllib.request.build_opener", side_effect=AssertionError("network forbidden")):
            self.assertEqual(self.registry().resolve_import("parent", "../child.xsd", "urn:child")["id"], "child")
            with self.assertRaisesRegex(SourceError, "unresolved"):
                self.registry().resolve_import("parent", "../child.xsd", "urn:wrong")

    def test_multiple_files_in_one_namespace_keep_distinct_path_identities(self):
        data = CHILD.replace(b"urn:child", b"urn:parent")
        self.relock(self.child, data)
        self.child["targetNamespace"] = "urn:parent"
        data = PARENT.replace(b'namespace="urn:child"', b'namespace="urn:parent"')
        self.relock(self.parent, data)
        self.parent["imports"][0]["namespace"] = "urn:parent"
        self.assertIn("child", verify_sources(self.registry(), self.root))

    def test_xml_root_must_match_the_recorded_source_kind(self):
        self.parent["kind"] = "wsdl"
        with self.assertRaisesRegex(SourceError, "kind|root"):
            verify_sources(self.registry(), self.root)


class LockPolicyTests(SourceFixture):
    def test_relative_paths_cannot_escape_or_use_windows_ambiguous_names(self):
        paths = (
            "../outside.xsd", "/outside.xsd", "C:/outside.xsd", r"..\outside.xsd",
            "specs/a/../child.xsd", "specs/child.xsd:stream", "specs/CON", "specs/a.",
        )
        for relative in paths:
            with self.subTest(relative=relative):
                lock = copy.deepcopy(self.lock)
                lock["sources"][1]["relativePath"] = relative
                with self.assertRaisesRegex(SourceError, "path"):
                    SourceRegistry(lock)

    def test_import_escape_and_external_unlocked_locations_are_errors(self):
        locations = (
            "../../../../../../outside.xsd", "file:///private.xsd", "//example.org/x.xsd",
            "../%2e%2e/x.xsd", "https://example.org/schema.xsd", r"..\child.xsd",
            "../child.xsd?secret=value", "../child.xsd#fragment",
        )
        for location in locations:
            with self.subTest(location=location):
                lock = copy.deepcopy(self.lock)
                lock["sources"][0]["imports"][0]["location"] = location
                with self.assertRaises(SourceError):
                    SourceRegistry(lock)

    def test_fetch_urls_require_locked_public_hosts_https_and_exact_commit_paths(self):
        urls = (
            BASE.replace(COMMIT, "main") + "wsdl/child.xsd",
            "http://www.w3.org/2001/xml.xsd",
            "https://www.w3.org.evil.example/schema.xsd",
            "https://user:password@www.w3.org/2001/xml.xsd",
            "https://www.w3.org:444/2001/xml.xsd",
            "https://www.w3.org/2001/xml.xsd?token=value",
        )
        for url in urls:
            with self.subTest(url=url):
                lock = copy.deepcopy(self.lock)
                lock["sources"][1]["url"] = url
                with self.assertRaisesRegex(SourceError, "URL|commit"):
                    SourceRegistry(lock)

    def test_duplicate_source_ids_paths_and_urls_fail(self):
        for field in ("id", "relativePath", "url"):
            with self.subTest(field=field):
                lock = copy.deepcopy(self.lock)
                lock["sources"][1][field] = lock["sources"][0][field]
                with self.assertRaisesRegex(SourceError, "duplicate"):
                    SourceRegistry(lock)

    def test_duplicate_json_members_fail(self):
        lock_path = self.root / "duplicate.json"
        lock_path.write_text('{"schemaVersion": 1, "schemaVersion": 1}', encoding="utf-8")
        with self.assertRaisesRegex(SourceError, "duplicate"):
            load_lock(lock_path)

    def test_nonfinite_json_numbers_are_rejected(self):
        lock_path = self.root / "nonfinite.json"
        lock_path.write_text('{"schemaVersion": 1, "value": NaN}', encoding="utf-8")
        with self.assertRaisesRegex(SourceError, "non-finite"):
            load_lock(lock_path)

    def test_unknown_selection_is_not_an_empty_success(self):
        with self.assertRaisesRegex(SourceError, "unknown"):
            verify_sources(self.registry(), self.root, source_ids=["not-in-lock"])

    def test_malformed_lock_shapes_are_explicit_source_errors(self):
        for mutation in (
            lambda lock: lock.update(schemaVersion=True),
            lambda lock: lock.update(baseline=None),
            lambda lock: lock["sources"][0].update(kind={}),
            lambda lock: lock["sources"][0].update(redistribution=None),
            lambda lock: lock["sources"][0]["imports"][0].update(sourceId=[]),
            lambda lock: lock.update(sourceGroups={"broken": ["unknown"]}),
        ):
            with self.subTest(mutation=mutation):
                lock = copy.deepcopy(self.lock)
                mutation(lock)
                with self.assertRaises(SourceError):
                    SourceRegistry(lock)


class FetchAndExportTests(SourceFixture):
    def test_fetch_requires_explicit_network_consent(self):
        with patch("urllib.request.build_opener", side_effect=AssertionError("network forbidden")):
            with self.assertRaisesRegex(SourceError, "explicit"):
                fetch_sources(self.registry(), self.root, self.cache)

    def test_redirect_handler_refuses_even_same_host_redirects(self):
        with self.assertRaisesRegex(SourceError, "redirect refused"):
            _NoRedirect().redirect_request(None, None, 302, "Found", {}, self.child["url"])

    def test_fetch_cannot_use_a_repository_publication_directory_as_cache(self):
        self.local(self.child).unlink()
        with patch("urllib.request.build_opener", side_effect=AssertionError("network forbidden")):
            with self.assertRaisesRegex(SourceError, "cache.*outside|repository"):
                fetch_sources(self.registry(), self.root, self.root / "third_party" / "onvif", allow_network=True)

    def test_fetch_uses_only_locked_url_and_writes_exact_bytes_to_cache(self):
        self.local(self.child).unlink()
        response = Response(CHILD, self.child["url"])
        with patch("urllib.request.build_opener") as build:
            build.return_value.open.return_value = response
            result = fetch_sources(self.registry(), self.root, self.cache, allow_network=True)
            request = build.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, self.child["url"])
        self.assertIn("child", result)
        self.assertFalse(self.local(self.child).exists())
        self.assertEqual(self.cache.joinpath(*self.child["relativePath"].split("/")).read_bytes(), CHILD)

    def test_hash_length_redirect_encoding_and_status_fail_without_partial_cache_file(self):
        for data, url, headers, status in (
            (CHILD.replace(b"1.0", b"9.0"), self.child["url"], {}, 200),
            (CHILD + b"x", self.child["url"], {}, 200),
            (CHILD, "https://www.w3.org/redirected", {}, 200),
            (CHILD, self.child["url"], {"Content-Encoding": "gzip"}, 200),
            (CHILD, self.child["url"], {}, 206),
            (CHILD, self.child["url"], {"Content-Length": "999999999"}, 200),
        ):
            with self.subTest(data=data[-10:], url=url, headers=headers, status=status):
                self.local(self.child).unlink(missing_ok=True)
                with patch("urllib.request.build_opener") as build:
                    build.return_value.open.return_value = Response(data, url, headers=headers, status=status)
                    with self.assertRaises(SourceError):
                        fetch_sources(self.registry(), self.root, self.cache, allow_network=True)
                self.assertFalse(self.cache.joinpath(*self.child["relativePath"].split("/")).exists())

    def test_export_copies_dependency_notice_and_source_provenance_unchanged(self):
        destination = self.root / "export"
        exported = export_sources(self.registry(), self.root, destination, source_ids=["parent"])
        self.assertEqual(set(exported), {"parent", "child", "notice"})
        for source, data in ((self.parent, PARENT), (self.child, CHILD), (self.notice, NOTICE)):
            self.assertEqual(destination.joinpath(*source["relativePath"].split("/")).read_bytes(), data)
        subset = load_lock(destination / "sources.lock.json")
        self.assertEqual(subset.sources["child"]["sha256"], self.child["sha256"])

    def test_export_refuses_uncleared_redistribution_even_with_cached_bytes(self):
        self.child["storage"] = "fetch-only"
        self.child["redistribution"]["status"] = "review-required"
        target = self.cache.joinpath(*self.child["relativePath"].split("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(CHILD)
        with self.assertRaisesRegex(SourceError, "redistribution"):
            export_sources(self.registry(), self.root, self.root / "export", cache=self.cache)
        self.assertFalse((self.root / "export").exists())

    def test_export_keeps_only_resolvable_subset_source_groups(self):
        self.lock["sourceGroups"] = {"roots": ["parent"], "all": ["parent", "child", "notice"]}
        destination = self.root / "export"
        export_sources(self.registry(), self.root, destination, source_ids=["child"])
        subset = load_lock(destination / "sources.lock.json")
        for group in subset.lock["sourceGroups"].values():
            self.assertTrue(set(group) <= set(subset.sources))
        self.assertNotIn("parent", subset.sources)

    def test_export_conflict_is_detected_before_any_source_is_copied(self):
        destination = self.root / "export"
        existing = destination.joinpath(*self.child["relativePath"].split("/"))
        existing.parent.mkdir(parents=True)
        existing.write_bytes(b"existing user data")
        with self.assertRaisesRegex(SourceError, "different bytes"):
            export_sources(self.registry(), self.root, destination)
        self.assertEqual(existing.read_bytes(), b"existing user data")
        self.assertFalse(destination.joinpath(*self.notice["relativePath"].split("/")).exists())


class PublicCatalogTests(unittest.TestCase):
    def test_all_seven_profile_editions_use_actual_source_metadata_and_role_scope(self):
        registry = load_lock(ROOT / "bindings" / "onvif" / "sources.lock.json")
        catalog = ROOT / "bindings" / "onvif" / "catalog" / "profile-editions.json"
        validate_profile_catalog(catalog, registry)
        data = json.loads(catalog.read_text(encoding="utf-8"))
        expected = {
            "A": ("1.0", "2017-06", 25),
            "C": ("1.0", "2013-12", 17),
            "D": ("1.0", "2021-06", 35),
            "G": ("1.1", "2025-10", 19),
            "M": ("1.1", "2024-03", 49),
            "S": ("1.3", "2019-11", 42),
            "T": ("1.0", "2018-09", 77),
        }
        self.assertEqual({p["profileId"] for p in data["profiles"]}, set(expected))
        for profile in data["profiles"]:
            edition, date, pages = expected[profile["profileId"]]
            self.assertEqual((profile["edition"], profile["documentDate"], profile["pageCount"]),
                             (edition, date, pages))
            self.assertEqual(profile["roles"], ["device", "client"])
            self.assertFalse(profile["establishesProductConformance"])
            source = registry.sources[profile["documentSourceId"]]
            self.assertEqual(source["sha256"], profile["documentSha256"])
            self.assertEqual(source["url"], profile["documentUrl"])
            self.assertTrue(profile["sourceAnchors"])
            self.assertEqual(source["storage"], "reference-only")
        self.assertEqual(data["historicalProfiles"][0]["profileId"], "Q")
        self.assertEqual(data["historicalProfiles"][0]["publicationState"], "retired")
        self.assertEqual({item["id"] for item in data["excludedReleaseCandidates"]}, {"V", "Security-Add-on"})
        self.assertFalse(data["separateAddOns"][0]["blanketDependencyOfSelectedProfiles"])

    def test_shipped_source_subset_and_notices_are_byte_exact(self):
        registry = load_lock(ROOT / "bindings" / "onvif" / "sources.lock.json")
        with patch("urllib.request.build_opener", side_effect=AssertionError("network forbidden")):
            verified = verify_sources(registry, ROOT, scope="vendored")
        self.assertGreater(len(verified), 25)
        self.assertEqual(registry.lock["baseline"]["commit"], COMMIT)

    def test_profile_source_metadata_cannot_drift_from_the_catalog(self):
        registry = load_lock(ROOT / "bindings" / "onvif" / "sources.lock.json")
        registry.sources["profile-S-1.3"]["documentDate"] = "2019-12"
        with self.assertRaisesRegex(SourceError, "profile document source mismatch"):
            validate_profile_catalog(ROOT / "bindings" / "onvif" / "catalog" / "profile-editions.json", registry)

    def test_discovery_closure_is_locked_but_not_silently_vendored_or_substituted(self):
        registry = load_lock(ROOT / "bindings" / "onvif" / "sources.lock.json")
        expected = {
            "xmlsoap-ws-addressing-2004": "http://schemas.xmlsoap.org/ws/2004/08/addressing",
            "xmlsoap-ws-discovery-2005-wsdl": "http://schemas.xmlsoap.org/ws/2005/04/discovery",
            "xmlsoap-ws-discovery-2005-xsd": "http://schemas.xmlsoap.org/ws/2005/04/discovery",
        }
        self.assertEqual(set(registry.lock["sourceGroups"]["nativeDiscovery"]), set(expected))
        for identifier, namespace in expected.items():
            source = registry.sources[identifier]
            self.assertEqual(source["targetNamespace"], namespace)
            self.assertEqual(source["storage"], "fetch-only")
            self.assertEqual(source["redistribution"]["status"], "review-required")
            self.assertFalse(ROOT.joinpath("third_party", "onvif", *source["relativePath"].split("/")).exists())
        with patch("urllib.request.build_opener", side_effect=AssertionError("network forbidden")):
            with self.assertRaisesRegex(SourceError, "missing.*fetch-only"):
                verify_sources(registry, ROOT)

    def test_no_pdf_or_unregistered_third_party_source_is_bundled(self):
        registry = load_lock(ROOT / "bindings" / "onvif" / "sources.lock.json")
        directory = ROOT / "third_party" / "onvif"
        expected = {source["relativePath"] for source in registry.sources.values()
                    if source["storage"] == "vendored"} | {"README.md"}
        actual = {path.relative_to(directory).as_posix() for path in directory.rglob("*") if path.is_file()}
        self.assertEqual(actual, expected)
        self.assertFalse(list(directory.rglob("*.pdf")))
        for identifier in ("w3c-xml", "w3c-xop"):
            source = registry.sources[identifier]
            self.assertIn(source["url"], source["attribution"])
            self.assertIn("w3c-document-license-2023", source["redistribution"]["noticeIds"])

    def test_per_file_versions_are_not_replaced_by_release_or_profile_editions(self):
        registry = load_lock(ROOT / "bindings" / "onvif" / "sources.lock.json")
        for path, version in (
            ("wsdl/ver10/device/wsdl/devicemgmt.wsdl", "26.06"),
            ("wsdl/ver10/media/wsdl/media.wsdl", "21.06"),
            ("wsdl/ver10/pacs/accesscontrol.wsdl", "20.12"),
            ("wsdl/ver10/pacs/types.xsd", "19.12"),
            ("wsdl/ver10/schema/metadatastream.xsd", "25.12"),
            ("wsdl/ver10/accessrules/wsdl/accessrules.wsdl", "18.12"),
        ):
            self.assertEqual(registry.sources["onvif:" + path]["schemaVersions"], [version])

    def test_editorial_native_names_resolve_and_unsettled_normative_choices_remain_unsettled(self):
        registry = load_lock(ROOT / "bindings" / "onvif" / "sources.lock.json")
        data = json.loads((ROOT / "bindings" / "onvif" / "catalog" / "editorial-decisions.json").read_text())
        decisions = {item["id"]: item for item in data["decisions"]}
        for item in decisions.values():
            for identifier in item["sourceIds"]:
                self.assertIn(identifier, registry.sources)
            operations = [item["nativeOperation"]] if "nativeOperation" in item else [
                {"namespace": item["nativeOperationNamespace"], "name": name}
                for name in item.get("nativeOperationNames", [])
            ]
            for operation in operations:
                candidates = [registry.sources[key] for key in item["sourceIds"]
                              if registry.sources[key]["kind"] == "wsdl"
                              and registry.sources[key]["targetNamespace"] == operation["namespace"]]
                self.assertEqual(len(candidates), 1)
                source = candidates[0]
                document = ET.parse(ROOT.joinpath("third_party", "onvif", *source["relativePath"].split("/")))
                names = {element.get("name") for element in document.findall(
                    ".//{http://schemas.xmlsoap.org/wsdl/}portType/{http://schemas.xmlsoap.org/wsdl/}operation",
                )}
                self.assertIn(operation["name"], names)
                if operation["name"] == "SetUser":
                    self.assertNotIn("SetUsers", names)
        for key in ("profile-g-settrackconfiguration-condition", "profile-s-ptz-node-choice"):
            self.assertEqual(decisions[key]["status"], "unresolved-normative-interpretation")
            self.assertIsNone(decisions[key]["decision"])
        self.assertEqual(decisions["profile-m-metadata-element-path"]["nativeElementPath"],
                         ["MetadataStream", "VideoAnalytics", "Frame"])


if __name__ == "__main__":
    unittest.main()

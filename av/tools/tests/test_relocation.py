"""Regression checks for the current preservation audit, not new AV semantics."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from relocatecheck import classify, lock_fields, path, token_hash
from check_docs import snippet_references


class RelocationIntegrationTests(unittest.TestCase):
    def test_complete_domain_partition_uses_declared_canonical_files(self):
        manifest = {"onvif/models/native/DeviceThing.tm.json": {}}
        for name, expected in {
            "package-lock.json": "administration",
            "av/spec.md": "core",
            "onvif/requirements/profile-a.json": "core",
            "onvif/models/native/DeviceThing.tm.json": "core",
            "onvif/samples/adapters/native/linux/worker.cpp": "samples",
            "onvif/tools/adapters/linux/build-test.sh": "tools",
            "av/examples/source.td.json": "examples",
            "av/support/history/v0.1-proposed/terms.json": "support",
        }.items():
            self.assertEqual(classify(name, manifest), expected)

    def test_unknown_roots_and_undeclared_core_files_are_not_admitted(self):
        for name in ("local-only/private.json", "unexpected.json", "onvif/unknown.json"):
            self.assertIsNone(classify(name, {}))

    def test_json_whitespace_constraints_preserve_large_numeric_and_string_tokens(self):
        source = b'{"n":18446744073709551615,"decimal":1.2300e+02,"text":"a b"}'
        expanded = b'{\n    "n": 18446744073709551615,\n    "decimal": 1.2300e+02,\n    "text": "a b"\n}\n'
        self.assertEqual(token_hash(source), token_hash(expanded))
        for changed in (
            source.replace(b"18446744073709551615", b"18446744073709551616"),
            source.replace(b"1.2300e+02", b"123"),
            source.replace(b"a b", b"ab"),
        ):
            self.assertNotEqual(token_hash(source), token_hash(changed))

    def test_lock_constraints_include_every_integrity_and_workspace_link_field(self):
        packages = {"node_modules/example": {
            "version": "1.2.3", "resolved": "https://registry.invalid/example.tgz",
            "integrity": "sha512-example", "dev": True,
        }, "node_modules/workspace": {"resolved": "onvif/samples/reference-runtime", "link": True}}
        fields = lock_fields(packages)
        self.assertNotIn("dev", fields["node_modules/example"])
        for key in ("version", "resolved", "integrity"):
            changed = {**packages, "node_modules/example": {**packages["node_modules/example"], key: "changed"}}
            self.assertNotEqual(fields, lock_fields(changed))
        self.assertEqual(fields["node_modules/workspace"], {"resolved": "onvif/samples/reference-runtime", "link": True})

    def test_unsafe_repository_coordinates_are_rejected(self):
        for name in ("../outside", "/absolute", "C:/outside", "av//spec.md", "av\\spec.md"):
            with self.assertRaises(ValueError):
                path(name)

    def test_publication_fixture_excerpts_resolve_from_the_original_source(self):
        source = path("av/tools/publication/test/fixtures/spec.md")
        text = source.read_text(encoding="utf8")
        self.assertEqual(snippet_references(text, source_path=source), 1)
        with self.assertRaises(ValueError):
            snippet_references(text.replace('"large": 900719925474099312345',
                                            '"large": 900719925474099312346'), source_path=source)


if __name__ == "__main__":
    unittest.main()

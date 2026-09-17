"""Regression checks for the current preservation audit, not new AV semantics."""

import sys
import re
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from relocatecheck import classify, lock_fields, path, token_hash, revision_constraint, sha
from check_docs import check_fences, snippet_references


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

    def test_revision_constraints_require_exact_committed_inputs_and_current_outputs(self):
        before, after = b"old class", b"renamed class"
        record = {"path": "onvif/terms.json", "baselineSha256": sha(before), "expectedSha256": sha(after)}
        revision_constraint(record, before, after)
        with self.assertRaisesRegex(ValueError, "baseline bytes differ"):
            revision_constraint(record, b"unreviewed baseline", after)
        with self.assertRaisesRegex(ValueError, "Unreviewed evolution bytes"):
            revision_constraint(record, before, b"unreviewed result")
        with self.assertRaisesRegex(ValueError, "exact output constraint"):
            revision_constraint({**record, "expectedSha256": None}, before, after)
        revision_constraint({**record, "baselineSha256": None}, None, after)
        with self.assertRaisesRegex(ValueError, "baseline bytes differ"):
            revision_constraint({**record, "baselineSha256": None}, before, after)

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
        guide = path("onvif/support/notes/onvif-binding-reference.md")
        self.assertEqual(snippet_references(guide.read_text(encoding="utf8"), source_path=guide), 1)

    def test_td_excerpt_uses_complete_source_and_rejects_visible_value_or_context_drift(self):
        source = path("onvif/spec.md")
        text = source.read_text(encoding="utf8")
        excerpt = re.search(r"<!-- td-excerpt: .+ -->\n```jsonc\n[\s\S]*?\n```", text)[0]
        self.assertEqual(snippet_references(excerpt, source_path=source), 1)
        for invalid in (
            excerpt.replace('"onvif:NativeContract"', '"onvif:Device"'),
            excerpt.replace('"/@context",', ""),
            excerpt.replace("// ...", "// arbitrary comment"),
            excerpt.replace("    // ...\n", ""),
            excerpt[excerpt.index("```jsonc"):],
        ):
            with self.subTest(invalid=invalid[:100]), self.assertRaisesRegex(ValueError, "TD excerpt"):
                snippet_references(invalid, source_path=source)

    def test_td_excerpts_do_not_relax_ordinary_json_fences(self):
        for invalid in (
            '```json\n{\n    "a": 1\n    // ...\n}\n```\n',
            '```json\n{\n    "a": ...\n}\n```\n',
            '```json\n{\n    "a": 1,\n}\n```\n',
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                check_fences(invalid, "ordinary JSON")


if __name__ == "__main__":
    unittest.main()

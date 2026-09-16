"""Host-portable tests of definitions/parsers; does not execute Linux or an SDK."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import protocol


TOOLS = Path(__file__).resolve().parents[3]
POLICY = TOOLS / "adapters" / "linux"
spec = importlib.util.spec_from_file_location("source_policy", POLICY / "source-policy.py")
source_policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source_policy)


class FramingTests(unittest.TestCase):
    @staticmethod
    def packet(metadata, payload=b""):
        data = json.dumps(metadata).encode()
        return struct.pack("<II", len(data), len(payload)) + data + payload

    def test_owned_synthetic_packet(self):
        data = self.packet({"kind": "frame"}, b"synthetic-only") + self.packet({"kind": "closed"})
        self.assertEqual(protocol.unpack(data)[0][1], b"synthetic-only")

    def test_truncated_headers_and_bodies(self):
        valid = self.packet({"kind": "closed"})
        for length in range(1, len(valid)):
            with self.subTest(length=length), self.assertRaises((AssertionError, ValueError)):
                protocol.unpack(valid[:length])

    def test_invalid_sizes_and_payload_kind(self):
        for data in (struct.pack("<II", 65537, 0), struct.pack("<II", 2, 16777217),
                     self.packet({"kind": "closed"}, b"not-a-frame")):
            with self.subTest(data=data), self.assertRaises(AssertionError):
                protocol.unpack(data)

    def test_malformed_utf8_and_json(self):
        for value in (b"\xff\xff", b"{x"):
            with self.subTest(value=value), self.assertRaises((UnicodeError, ValueError)):
                protocol.unpack(struct.pack("<II", len(value), 0) + value)


class DefinitionTests(unittest.TestCase):
    def test_locks_match_existing_native_pin(self):
        sources = json.loads((POLICY / "sources.lock.json").read_text())
        deps = json.loads((POLICY / "dependencies.lock.json").read_text())
        self.assertFalse(sources["automaticFetch"])
        self.assertEqual(sources["aravis"]["version"], deps["aravis"]["exactVersion"])
        native = TOOLS.parent / "samples" / "adapters" / "native" / "linux" / "CMakeLists.txt"
        self.assertIn("aravis-0.8=0.8.36", native.read_text())
        self.assertFalse(deps["hardwareQualified"])
        self.assertFalse(deps["distributionPackagesAreExactPins"])

    def test_fake_fixture_is_exact_and_contains_no_transport(self):
        fixture = json.loads((TOOLS / "fixtures" / "adapters" / "linux" / "aravis-fake.json").read_text())
        self.assertEqual(fixture, {
            "vendor": "Aravis", "model": "Fake", "serial": "1", "pixelFormat": "Mono8",
            "width": "512", "height": "512", "x": "0", "y": "0"})

    def test_source_build_is_opt_in_and_has_no_meson_download_fallback(self):
        script = (POLICY / "build-test.sh").read_text()
        self.assertIn("--bootstrap-aravis", script)
        self.assertIn("--wrap-mode=nodownload", script)
        self.assertIn('-Dtests=false', script)
        self.assertIn('bash "$here/../scripts/linux-build.sh"', script)
        self.assertNotIn("apt-get", script)
        self.assertNotIn("modprobe", script)
        for path in (POLICY / "build-test.sh", POLICY.parent / "scripts" / "linux-build.sh",
                     POLICY.parent / "scripts" / "check-linux-prereqs.sh"):
            with self.subTest(script=path.name):
                self.assertNotIn(b"\r", path.read_bytes(), "Linux shell scripts must retain LF bytes")

    def test_fake_selection_precedes_camera_creation(self):
        code = (TOOLS.parent / "samples" / "adapters" / "genicam" / "aravis.cpp").read_text()
        start = code.index('arv_select_interface("Fake")')
        self.assertLess(start, code.index('arv_camera_new("Fake_1"'))
        self.assertNotIn("arv_update_device_list(", code)


class SourcePolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aravis-policy-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.data = b"synthetic source-policy fixture, not an SDK\n"
        (self.root / "fixture.txt").write_bytes(self.data)
        self.pin = {"commit": "a"*40, "tree": "b"*40, "files": {
            "fixture.txt": hashlib.sha256(self.data).hexdigest()}}
        blob = hashlib.sha1(b"blob " + str(len(self.data)).encode() + b"\0" + self.data).hexdigest()
        self.responses = {
            ("rev-parse", "--show-toplevel"): str(self.root).encode() + b"\n",
            ("rev-parse", "HEAD"): b"a"*40 + b"\n",
            ("rev-parse", "HEAD^{tree}"): b"b"*40 + b"\n",
            ("ls-files", "--others", "-z"): b"",
            ("ls-tree", "-rz", "--full-tree", "HEAD"): b"100644 blob " + blob.encode() + b"\tfixture.txt\0"}

    def verify(self):
        with patch.object(source_policy, "git", side_effect=lambda root, *args: self.responses[args]):
            return source_policy.verify_source(self.root, self.pin)

    def test_accepts_exact_synthetic_tree(self):
        self.assertEqual(self.verify(), 1)

    def test_rejects_wrong_commit(self):
        self.responses[("rev-parse", "HEAD")] = b"c"*40
        with self.assertRaisesRegex(ValueError, "commit"):
            self.verify()

    def test_rejects_wrong_tree(self):
        self.responses[("rev-parse", "HEAD^{tree}")] = b"c"*40
        with self.assertRaisesRegex(ValueError, "tree"):
            self.verify()

    def test_rejects_untracked_input_even_if_ignored(self):
        self.responses[("ls-files", "--others", "-z")] = b"ignored-build-file\0"
        with self.assertRaisesRegex(ValueError, "untracked"):
            self.verify()

    def test_rejects_changed_blob(self):
        (self.root / "fixture.txt").write_bytes(b"modified")
        with self.assertRaisesRegex(ValueError, "blob"):
            self.verify()

    def test_rejects_wrong_sha256(self):
        self.pin["files"]["fixture.txt"] = "0"*64
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self.verify()

    def test_rejects_missing_blob(self):
        (self.root / "fixture.txt").unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify()

    def test_rejects_submodule(self):
        self.responses[("ls-tree", "-rz", "--full-tree", "HEAD")] = b"160000 commit " + b"c"*40 + b"\tsubmodule\0"
        with self.assertRaisesRegex(ValueError, "submodule"):
            self.verify()


if __name__ == "__main__":
    unittest.main()

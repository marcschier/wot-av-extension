"""Declared roots for the relocated native tools, tests and fixtures."""

from pathlib import Path


def repository_root():
    for root in Path(__file__).resolve().parents:
        if (root / "onvif" / "samples" / "reference-runtime" / "native-media" / "CMakeLists.txt").is_file():
            return root
    raise RuntimeError("Cannot locate the native reference-runtime repository.")


REPO_ROOT = repository_root()
NATIVE_ROOT = REPO_ROOT / "onvif" / "samples" / "reference-runtime" / "native-media"
TOOL_ROOT = REPO_ROOT / "onvif" / "tools" / "native-media"
TEST_ROOT = REPO_ROOT / "onvif" / "tools" / "tests" / "native-media"
FIXTURE_ROOT = REPO_ROOT / "onvif" / "tools" / "fixtures" / "native-media"

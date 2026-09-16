"""Bootstrap the shared repository coordinates for standalone ONVIF tools."""

from pathlib import Path
import sys

for _root in Path(__file__).resolve().parents:
    if (_root / "publication-ownership.json").is_file():
        sys.path.insert(0, str(_root))
        break
else:
    raise RuntimeError("Cannot locate the specification repository.")

from av.tools.repository import AV_ROOT, ONVIF_ROOT, REPO_ROOT, RUNTIME_ROOT

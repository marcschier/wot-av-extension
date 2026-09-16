"""Repository coordinates, distinct from either specification's public identities."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
AV_ROOT = REPO_ROOT / "av"
ONVIF_ROOT = REPO_ROOT / "onvif"
RUNTIME_ROOT = ONVIF_ROOT / "samples" / "reference-runtime"

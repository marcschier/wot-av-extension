"""Decode all software-produced JPEGs with the independently installed Pillow/libjpeg."""

import json
from pathlib import Path

from PIL import Image


def main():
    root = Path(__file__).resolve().parents[3] / "samples" / "adapters" / "build-windows"
    results = []
    for name in ("software-native.jpg", "software-ipc.jpg", "software-http.jpg"):
        with Image.open(root / name) as image:
            image.load()
            assert image.format == "JPEG"
            assert image.size == (17, 13)
            rgb = image.convert("RGB")
            top_left = rgb.getpixel((2, 2))
            bottom_right = rgb.getpixel((14, 10))
            assert top_left[0] > 130 and top_left[1] < 70 and top_left[2] < 70
            assert bottom_right[1] > 180 and bottom_right[2] > 180
            results.append({"artifact": name, "width": 17, "height": 13, "decoded": True})
    print(json.dumps({"result": "pass", "decoder": "Pillow/libjpeg", "images": results}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, AssertionError, ValueError) as error:
        print(json.dumps({"result": "fail", "errorClass": type(error).__name__}))
        raise SystemExit(1) from None

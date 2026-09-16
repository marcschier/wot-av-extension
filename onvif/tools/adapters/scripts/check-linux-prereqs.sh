#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Linux ]] || { echo "A real approved Linux target is required." >&2; exit 1; }
aravis=1
usb=1
for arg in "$@"; do
  case "$arg" in
    --without-aravis) aravis=0; usb=0 ;;
    --without-usb) usb=0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
for tool in cmake c++ pkg-config python3; do
  command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool (nothing will be installed)." >&2; exit 1; }
done
pkg-config --atleast-version=1.1.1 openssl || { echo "System OpenSSL >=1.1.1 development files required." >&2; exit 1; }
pkg-config --exists libjpeg || { echo "System libjpeg-turbo/libjpeg development files required." >&2; exit 1; }
if (( aravis )); then
  pkg-config --exact-version=0.8.36 aravis-0.8 || {
    echo "Exactly Aravis 0.8.36 development files are required; no SDK is downloaded." >&2; exit 1;
  }
fi
if (( usb )); then
  pkg-config --atleast-version=1.0.16 libusb-1.0 || {
    echo "USB build requires libusb >=1.0.16 development files." >&2; exit 1;
  }
fi
printf '%s\n' "Package prerequisites found. This is NOT a compilation or hardware result."
cmake --version | head -n 1
pkg-config --modversion openssl libjpeg
if (( aravis )); then pkg-config --modversion aravis-0.8; fi

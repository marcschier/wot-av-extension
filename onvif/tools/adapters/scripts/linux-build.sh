#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bash "$here/check-linux-prereqs.sh" "$@"
aravis=ON
usb=ON
for arg in "$@"; do
  case "$arg" in
    --without-aravis) aravis=OFF; usb=OFF ;;
    --without-usb) usb=OFF ;;
  esac
done
onvif="$(cd -- "$here/../../.." && pwd)"
source="$onvif/samples/adapters/native/linux"
build="$source/build-linux-capture"
cmake -S "$source" -B "$build" -DCMAKE_BUILD_TYPE=Debug \
  -DCAPTURE_WITH_ARAVIS="$aravis" -DCAPTURE_WITH_ARAVIS_USB="$usb" \
  -DCAPTURE_SANITIZERS="${CAPTURE_SANITIZERS:-OFF}"
cmake --build "$build" --parallel 2
ctest --test-dir "$build" --output-on-failure
printf '%s\n' "Build/software tests completed on this Linux host; no real camera was selected."

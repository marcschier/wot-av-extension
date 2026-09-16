#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
onvif="$(cd -- "$here/../../.." && pwd)"
native="$onvif/samples/adapters/native/linux"
source_dir=""
bootstrap=0
system=0
aravis=1
usb=1
args=()
fail() { printf '%s\n' "$*" >&2; exit 1; }
while (( $# )); do
  case "$1" in
    --bootstrap-aravis) bootstrap=1 ;;
    --aravis-source)
      (( $# >= 2 )) || fail "--aravis-source requires a pristine checkout path."
      [[ -z "$source_dir" && -n "$2" ]] || fail "Provide one nonempty source path."
      source_dir="$2"; shift ;;
    --system-aravis) system=1 ;;
    --without-aravis) aravis=0; usb=0; args+=(--without-aravis) ;;
    --without-usb) usb=0; args+=(--without-usb) ;;
    --help)
      printf '%s\n' \
        "Approved Linux runner only; default is offline, exact installed Aravis 0.8.36." \
        "Usage: bash build-test.sh [--without-aravis|--without-usb]" \
        "       [--system-aravis | --aravis-source CHECKOUT | --bootstrap-aravis]" \
        "Only --bootstrap-aravis permits fetching the locked public source." \
        "No package installation, device access or upstream discovery tests."
      exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
  shift
done
(( bootstrap + system + (${#source_dir} > 0) <= 1 )) || fail "Choose only one Aravis dependency source."
if (( ! aravis && (bootstrap || system || ${#source_dir}) )); then
  fail "Aravis dependency options cannot be combined with --without-aravis."
fi
[[ "$(uname -s)" == Linux ]] || fail "A real approved Linux runner is required; no Docker/WSL/service is started."
for tool in python3 cmake c++ pkg-config; do
  command -v "$tool" >/dev/null || fail "Missing prerequisite: $tool; nothing was installed."
done
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else "Python >=3.9 required")'
if (( bootstrap )) || [[ -n "$source_dir" ]]; then
  for tool in git meson ninja; do
    command -v "$tool" >/dev/null || fail "Missing source-build prerequisite: $tool; nothing was installed."
  done
  pkg-config --atleast-version=2.52 glib-2.0 || fail "GLib >=2.52 development files required."
  pkg-config --exists gobject-2.0 gio-2.0 libxml-2.0 zlib || fail "GObject/GIO/libxml2/zlib development files required."
  if (( usb )); then
    pkg-config --atleast-version=1.0.16 libusb-1.0 || fail "USB source build requires libusb >=1.0.16."
  fi
  pin="$(python3 "$here/source-policy.py" --print-pin)"
  mapfile -t fields <<< "$pin"
  (( ${#fields[@]} == 3 )) || fail "Invalid source lock."
  # Separate build/install directories prevent changing the pristine source cache.
  work="$(mktemp -d "$native/build-aravis.XXXXXXXX")"
  if (( bootstrap )); then
    source_dir="$work/source"
    git_safe=(git -c core.hooksPath=/dev/null -c protocol.file.allow=never -c protocol.ext.allow=never)
    "${git_safe[@]}" init --quiet "$source_dir"
    "${git_safe[@]}" -C "$source_dir" fetch --quiet --depth=1 --no-tags "${fields[0]}" "${fields[1]}"
    "${git_safe[@]}" -C "$source_dir" checkout --quiet --detach "${fields[1]}"
  fi
  source_dir="$(cd -- "$source_dir" && pwd)"
  python3 "$here/source-policy.py" --source "$source_dir"
  usb_feature=disabled
  if (( usb )); then usb_feature=enabled; fi
  meson setup "$work/build" "$source_dir" --prefix="$work/install" --libdir=lib \
    --buildtype=debugoptimized --default-library=shared --wrap-mode=nodownload \
    -Dusb="$usb_feature" -Dpacket-socket=disabled -Dtests=false \
    -Dviewer=disabled -Dgst-plugin=disabled -Dintrospection=disabled -Ddocumentation=disabled
  meson compile -C "$work/build" -j 2
  meson install -C "$work/build" --no-rebuild
  export PKG_CONFIG_PATH="$work/install/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
  export LD_LIBRARY_PATH="$work/install/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  pkg-config --exact-version="${fields[2]}" aravis-0.8 || fail "Built Aravis does not match the exact source lock."
fi
export CTEST_NO_TESTS_ACTION=error
python3 -B -m unittest discover -s "$onvif/tools/tests/adapters/linux" -p 'test_*.py'
# A previous pkg-config/USB feature check must not retain another SDK prefix.
cache="$native/build-linux-capture/CMakeCache.txt"
if [[ -f "$cache" ]]; then
  printf '%s\n' "Clearing the generated worker CMake cache before dependency qualification."
  rm -- "$cache"
fi
# Reuse the existing native configure/build/CTest implementation, not a second build graph.
bash "$here/../scripts/linux-build.sh" "${args[@]}"

#!/bin/sh
# Unwrap Electrobun's self-extracting stable app into the expanded bundle, so the app we ship runs
# from wherever the user unzips it: macOS translocation runs quarantined downloads on a read-only
# mount, and the stub's first-launch extraction fails there and the app hangs.
set -eu
desktop="$(cd "$(dirname "$0")/.." && pwd)"
for app in "$desktop"/build/*-macos-*/Mirador.app; do
  [ -d "$app" ] || continue
  payload="$(find "$app/Contents/Resources" -maxdepth 1 -name '*.tar.zst' -print -quit)"
  [ -n "$payload" ] || continue
  staging="$(mktemp -d)"
  tar -C "$staging" --zstd -xf "$payload"
  rm -rf "$app"
  mv "$staging/Mirador.app" "$app"
  rmdir "$staging"
done

#!/bin/bash
# Renders the app icon set, the menu bar image and the tray icons with a waiting dot from the SVGs in desktop/assets. Needs rsvg-convert (brew install librsvg).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p icon.iconset
for size in 16 32 128 256 512; do
  rsvg-convert -w "$size" -h "$size" assets/app-icon.svg -o "icon.iconset/icon_${size}x${size}.png"
  rsvg-convert -w $((size * 2)) -h $((size * 2)) assets/app-icon.svg -o "icon.iconset/icon_${size}x${size}@2x.png"
done
rsvg-convert -w 36 -h 36 assets/tray-icon.svg -o assets/tray-icon.png

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Windows tray icons are .ico, at the sizes the tray asks for from 100% to 200% display scaling.
render_ico() {
  local svg=$1 output=$2 pngs=()
  for size in 16 20 24 32 40 48 64; do
    rsvg-convert -w "$size" -h "$size" "$svg" -o "$work/$size.png"
    pngs+=("$work/$size.png")
  done
  bun scripts/pack-ico.ts "$output" "${pngs[@]}"
}

render_ico assets/app-icon.svg assets/app-icon.ico
for dot in "needs-you #d93d42" "done #2e9e6b"; do
  set -- $dot
  sed "s|</svg>|  <circle cx=\"800\" cy=\"224\" r=\"180\" fill=\"$2\" stroke=\"#fff\" stroke-width=\"44\"/></svg>|" assets/app-icon.svg > "$work/$1.svg"
  rsvg-convert -w 64 -h 64 "$work/$1.svg" -o "assets/tray-icon-$1.png"
  render_ico "$work/$1.svg" "assets/tray-icon-$1.ico"
done

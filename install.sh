#!/bin/sh
# Installs the latest Mirador desktop app on macOS (Apple Silicon) or Linux (x64, arm64), and starts it:
#
#   curl -fsSL https://github.com/sodre90/mirador/releases/latest/download/install.sh | sh
#
# On Windows, install.ps1 does it, from PowerShell.
#
# MIRADOR_DOWNLOAD_URL fetches the release's files from elsewhere, and MIRADOR_APP_DIR puts the macOS app in another folder
# than the one it is in already, else ~/Applications.
#
# sh reads this script from the pipe while it runs, so every program it starts gets /dev/null as its input, or it would
# read the rest of the script; and nothing runs until main, on the last line, so a cut-off download runs nothing.
set -eu

DOWNLOAD_URL=${MIRADOR_DOWNLOAD_URL:-https://github.com/sodre90/mirador/releases/latest/download}
WINDOWS_INSTALL="irm https://github.com/sodre90/mirador/releases/latest/download/install.ps1 | iex"
LINUX_APP=$HOME/.local/share/com.sodre90.mirador/stable/app
LINUX_LIBRARIES="libgtk-3.so.0 libwebkit2gtk-4.1.so.0 libayatana-appindicator3.so.1 librsvg-2.so.2"
APT_PACKAGES="libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2"
DNF_PACKAGES="gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3 librsvg2"

say() { printf '%s\n' "$*"; }

fail() {
  printf 'Mirador was not installed: %s\n' "$*" >&2
  exit 1
}

download() {
  say "Downloading $1"
  curl -fSL --progress-bar "$DOWNLOAD_URL/$1" -o "$2" </dev/null || fail "could not download $DOWNLOAD_URL/$1"
}

runs_from() {
  command -v pgrep >/dev/null 2>&1 && pgrep -f -- "$1" >/dev/null 2>&1 </dev/null
}

as_root() {
  if [ "$(id -u)" = 0 ]; then
    "$@" </dev/null
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@" </dev/null
  else
    fail "installing them needs root: run this as root, or install them yourself and run it again."
  fi
}

# ~/Applications needs no admin rights; an app already in /Applications is updated there while this user can write to it.
macos_app_dir() {
  if [ -n "${MIRADOR_APP_DIR:-}" ]; then
    say "$MIRADOR_APP_DIR"
  elif [ -d /Applications/Mirador.app ] && [ ! -d "$HOME/Applications/Mirador.app" ] && [ -w /Applications ]; then
    say /Applications
  else
    say "$HOME/Applications"
  fi
}

install_macos() {
  # Not uname -m: a shell running under Rosetta reports x86_64 on Apple Silicon too.
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null </dev/null)" = 1 ] ||
    fail "the macOS app is for Apple Silicon. On an Intel Mac, run Mirador from source: https://github.com/sodre90/mirador#from-source"
  app_dir=$(macos_app_dir)
  app=$app_dir/Mirador.app
  if runs_from "$app/Contents/MacOS/"; then
    fail "Mirador is running from $app. Quit it from its menu bar icon, with Run host in the background off, then run this again."
  fi

  download Mirador-macos-arm64.zip "$work/Mirador.zip"
  ditto -x -k "$work/Mirador.zip" "$work/unpacked" </dev/null
  mkdir -p "$app_dir"
  rm -rf "$app"
  mv "$work/unpacked/Mirador.app" "$app"
  xattr -dr com.apple.quarantine "$app" </dev/null 2>/dev/null || true
  say "Installed $app"
  say "Opening Mirador"
  open "$app" </dev/null
}

missing_libraries() {
  known=$({ ldconfig -p || /sbin/ldconfig -p; } 2>/dev/null </dev/null || true)
  for library in $LINUX_LIBRARIES; do
    case $known in
      *"$library ("*) ;;
      *) printf '%s ' "$library" ;;
    esac
  done
}

install_libraries() {
  missing=$(missing_libraries)
  [ -n "$missing" ] || return 0
  say "Mirador needs GTK 3, WebKitGTK 4.1, Ayatana AppIndicator and librsvg. Missing: $missing"
  if command -v apt-get >/dev/null 2>&1; then
    as_root env DEBIAN_FRONTEND=noninteractive apt-get update -q
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -q $APT_PACKAGES
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y $DNF_PACKAGES
  else
    fail "install them with your package manager, then run this again."
  fi
}

check_glibc() {
  reported=$(getconf GNU_LIBC_VERSION 2>/dev/null </dev/null) || return 0
  case $reported in
    'glibc '[0-9]*.[0-9]*) ;;
    *) return 0 ;;
  esac
  version=${reported#* }
  major=${version%%.*}
  minor=${version#*.}
  if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 36 ]; }; then
    fail "Mirador's Linux app needs glibc 2.36 or newer (Ubuntu 24.04, Debian 12, Fedora 37 or later); this system has glibc $version."
  fi
}

install_linux() {
  case $(uname -m) in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) fail "Mirador's Linux app is built for x64 and arm64, not $(uname -m)." ;;
  esac
  if runs_from "$LINUX_APP/bin/"; then
    fail "Mirador is running. Quit it from its tray icon, with Run host in the background off, then run this again."
  fi
  check_glibc

  install_libraries
  download "Mirador-linux-$arch-Setup.tar.gz" "$work/setup.tar.gz"
  mkdir "$work/setup"
  tar -xzf "$work/setup.tar.gz" -C "$work/setup" </dev/null
  "$work/setup/installer" </dev/null >"$work/installer.log" 2>&1 || {
    cat "$work/installer.log" >&2
    fail "its installer failed."
  }
  [ -x "$LINUX_APP/bin/launcher" ] || fail "the installer finished, but $LINUX_APP/bin/launcher is missing."
  say "Installed Mirador in $LINUX_APP"
  # Electrobun's installer starts the app itself, which only works with a display.
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    say "Mirador is starting."
  else
    say "Start Mirador from your applications menu."
  fi
}

has_agent() {
  for program in claude opencode pi; do
    command -v "$program" >/dev/null 2>&1 && return 0
    for directory in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/.opencode/bin"; do
      [ -x "$directory/$program" ] && return 0
    done
  done
  return 1
}

main() {
  command -v curl >/dev/null 2>&1 || fail "it needs curl."
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  case $(uname -s) in
    Darwin) install_macos ;;
    Linux) install_linux ;;
    MINGW* | MSYS* | CYGWIN*) fail "on Windows, run this in PowerShell instead: $WINDOWS_INSTALL" ;;
    *) fail "Mirador runs on macOS, Linux and Windows, not $(uname -s)." ;;
  esac
  has_agent || {
    say ""
    say "Mirador runs Claude Code, opencode or pi, and none of them is installed yet. Claude Code installs with:"
    say "  curl -fsSL https://claude.ai/install.sh | bash"
  }
}

main

#!/bin/sh
# Builds the guard as one static program, in a throwaway container of Alpine, whose packages have the static libraries
# it needs: it then runs in any Linux image, and loads nothing of it. usage: build.sh <source folder> <output folder>
set -eu
apk add --quiet --no-cache g++ linux-headers fuse3-dev fuse3-static utf8proc-dev pkgconf >/dev/null
g++ -std=c++17 -O2 -static -D_FILE_OFFSET_BITS=64 "$1/guard.cpp" -o "$2/mirador-guard" $(pkg-config --static --cflags --libs fuse3 libutf8proc) -lpthread
strip "$2/mirador-guard"

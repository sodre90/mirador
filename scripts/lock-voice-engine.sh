#!/usr/bin/env bash
# Compiles the speech engine's hashed lock for the uv and Python that Mirador installs (host/voice/engine/catalog.ts).
# mlx ships wheels for macOS 14 and newer only, so the lock targets macOS 14 on Apple silicon.
set -euo pipefail
cd "$(dirname "$0")/../host/voice/engine"
MACOSX_DEPLOYMENT_TARGET=14.0 "${UV:-uv}" pip compile requirements.in \
  --python-version 3.12 --python-platform aarch64-apple-darwin --generate-hashes --no-header -o requirements.lock

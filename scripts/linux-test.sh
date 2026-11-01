#!/usr/bin/env bash
# Runs the type check, the unit tests and the browser tests on Linux, against this working tree, in a container.
# Usage: [MIRADOR_LINUX_ARCH=x64|arm64] scripts/linux-test.sh [extra Playwright arguments, e.g. e2e/terminal-keys.spec.ts]
# The browser tests that wait for a real Claude reply get it from your model server, as scripts/linux-common.sh says.
# Playwright's results (screenshots of failures) are copied to $results.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
source "$repo/scripts/linux-common.sh"
results="${TMPDIR:-/tmp}/mirador-linux-test-results-$arch"
rm -rf "$results" && mkdir -p "$results"

build_image linux-test
find_model_server
run_in_container \
  ${model_server[@]+"${model_server[@]}"} \
  --volume "$results:/results" \
  "mirador-linux-test-$arch" bash -c '
    mkdir /tmp/mirador && tar -X /src/scripts/linux-copy.exclude -C /src -cf - . | tar -xf - -C /tmp/mirador
    cd /tmp/mirador
    bun install --frozen-lockfile >/dev/null
    failed=()
    echo "== $(uname -sm): type check"; bun run typecheck || failed+=(typecheck)
    echo "== unit tests"; bun run test || failed+=(unit)
    echo "== browser tests"; bunx playwright test --reporter=line "$@" || failed+=(e2e)
    cp -r test-results/. /results/ 2>/dev/null || true
    if (( ${#failed[@]} )); then echo "FAILED: ${failed[*]}"; exit 1; fi
    echo "ALL PASSED"
  ' linux-test "$@"

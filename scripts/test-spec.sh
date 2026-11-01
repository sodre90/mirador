#!/usr/bin/env bash
# Runs the Playwright specs you name in a container, against this working tree. The tree is copied into the container,
# so the checkout can keep being edited while a run is in flight, and concurrent runs share nothing: each gets its own
# ports, test-results and results dir. Unlike scripts/linux-test.sh this skips the type check and the unit suite.
# Usage: scripts/test-spec.sh e2e/<spec>.spec.ts [more specs...]
# Specs that wait for a real Claude reply get it from your model server, as scripts/linux-common.sh says.
# Failure artifacts are copied to a fresh dir under $TMPDIR, printed at the start.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
source "$repo/scripts/linux-common.sh"
results=$(mktemp -d "${TMPDIR:-/tmp}/mirador-spec-results-$arch-XXXXXX")

build_image linux-test
find_model_server
echo "failure artifacts (if any): $results"
run_in_container \
  ${model_server[@]+"${model_server[@]}"} \
  --volume "$results:/results" \
  "mirador-linux-test-$arch" bash -c '
    mkdir /tmp/mirador && tar -X /src/scripts/linux-copy.exclude -C /src -cf - . | tar -xf - -C /tmp/mirador
    cd /tmp/mirador
    bun install --frozen-lockfile >/dev/null
    status=0
    bunx playwright test --reporter=line "$@" || status=$?
    cp -r test-results/. /results/ 2>/dev/null || true
    exit $status
  ' test-spec "$@"

#!/usr/bin/env bash
# Runs the ask round-trip against every harness in parallel with one wait duration.
wait_seconds="$1"
mkdir -p results
for agent in claude opencode pi-acp-liuser; do
  ~/.bun/bin/bun src/run.ts "$agent" "$wait_seconds" > "results/${agent}-${wait_seconds}s.log" 2>&1 &
done
wait

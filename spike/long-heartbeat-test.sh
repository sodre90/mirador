#!/usr/bin/env bash
# 21-minute ask wait with progress heartbeats, Claude Code and opencode (staggered to avoid opencode's DB lock).
mkdir -p results/heartbeat
~/.bun/bin/bun src/run.ts claude 1260 > results/heartbeat/claude-1260s.log 2>&1 &
sleep 5
~/.bun/bin/bun src/run.ts opencode 1260 > results/heartbeat/opencode-1260s.log 2>&1 &
wait

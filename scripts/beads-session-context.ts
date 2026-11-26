#!/usr/bin/env bun
/**
 * What a Claude Code session in this repository starts with from beads, as the SessionStart hook's JSON: the workflow,
 * the few memories that hold for any task in full, and every other memory by its key alone. `bd prime` by itself
 * writes all memories out in full, which had grown past 100 KB for every session and every subagent.
 *
 * Its matcher in .claude/settings.json leaves out resumed sessions, such as a profile switch or a restart in Mirador: their
 * transcript holds this context already, and Claude Code answers the resume only once its SessionStart hooks have ended.
 */
import { $ } from "bun";
import { dirname } from "node:path";

const REPOSITORY = dirname(import.meta.dir);

const HOLD_FOR_ANY_TASK = ["no-backward-compat"];

const bd = async (...args: string[]) => {
  const { stdout, exitCode } = await $`bd -C ${REPOSITORY} ${args}`.nothrow().quiet();
  return exitCode === 0 ? stdout.toString() : null;
};

function memoriesSection(stored: Record<string, unknown>) {
  const memories = Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  if (memories.length === 0) return "";
  const inFull = memories.filter(([key]) => HOLD_FOR_ANY_TASK.includes(key));
  const byKeyOnly = memories.filter(([key]) => !HOLD_FOR_ANY_TASK.includes(key)).map(([key]) => key);
  return [
    `## Persistent memories (${memories.length})`,
    "Stored via `bd remember`. Only these hold for any task, so only they are written out here:",
    ...inFull.map(([key, text]) => `### ${key}\n${text}`),
    "### The others, by key",
    "Before you work in an area, read the memories whose keys name it: `bd recall <key>` prints one in full, and `bd memories <keyword>` searches them all.",
    byKeyOnly.join(", "),
  ].join("\n\n");
}

// `bd prime --no-memories` prints this file when there is one, but only after opening bd's embedded database, which
// waits behind any other bd, as in every session Mirador starts at once.
const workflow = await Bun.file(`${REPOSITORY}/.beads/PRIME.md`)
  .text()
  .catch(() => bd("prime", "--no-memories"));
if (workflow !== null) {
  let stored: Record<string, unknown> = {};
  const rawMemories = await bd("memories", "--json");
  if (rawMemories && rawMemories.trim()) {
    try {
      const parsed = JSON.parse(rawMemories.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        stored = parsed as Record<string, unknown>;
      }
    } catch {
      // Degrades gracefully with workflow context if memories output is malformed
    }
  }
  const additionalContext = [workflow.trimEnd(), memoriesSection(stored)].filter(Boolean).join("\n\n");
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
}

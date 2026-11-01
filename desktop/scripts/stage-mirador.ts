#!/usr/bin/env bun
/** Stages the committed Mirador the host runs, with its production dependencies, in release/mirador for a release build. */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const desktop = join(import.meta.dir, "..");
const checkout = join(desktop, "..");
const stage = join(desktop, "release", "mirador");
const STAGED_FILES = ["host", "web", "shared", "plugins", "bin", "package.json", "bun.lock", "patches", "tsconfig.json"];

function run(command: string[], cwd: string) {
  const { exitCode } = Bun.spawnSync(command, { cwd, stdio: ["inherit", "inherit", "inherit"] });
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
}

/** Mirador runs the Claude Code installed on the computer, so the copy claude-agent-acp's SDK bundles only takes room. */
function removeBundledClaudeCode() {
  const scope = join(stage, "node_modules", "@anthropic-ai");
  if (!existsSync(scope)) return;
  for (const name of readdirSync(scope).filter((entry) => entry.startsWith("claude-agent-sdk-"))) rmSync(join(scope, name), { recursive: true, force: true });
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
/** Named relative to the stage, as Git for Windows' GNU tar takes a path with a drive letter for a remote machine's. */
const archive = "../mirador.tar";
run(["git", "archive", "--format=tar", "-o", join(stage, archive), "HEAD", ...STAGED_FILES], checkout);
run(["tar", "-xf", archive], stage);
rmSync(join(stage, archive));
run([process.execPath, "install", "--production", "--frozen-lockfile"], stage);
removeBundledClaudeCode();
run([process.execPath, join(desktop, "scripts", "prune-unused-modules.ts"), stage], desktop);

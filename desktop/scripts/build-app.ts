#!/usr/bin/env bun
/**
 * `bun run build`, and `bun run build:release` for the app that carries Mirador. A script rather than a package.json
 * line, as on Windows `bun run` runs those in its own shell, which has no sh scripts and no `${NAME:-default}`.
 */
import { join } from "node:path";
import { buildMachineBun, requireDefinedBun } from "./ship-build-bun.ts";

const desktop = join(import.meta.dir, "..");
const release = process.argv.includes("--release");

function run(command: string[], env: Record<string, string | undefined> = process.env) {
  const { exitCode } = Bun.spawnSync(command, { cwd: desktop, env, stdio: ["inherit", "inherit", "inherit"] });
  if (exitCode !== 0) process.exit(exitCode ?? 1);
}

if (release) {
  requireDefinedBun(buildMachineBun());
  run([process.execPath, "scripts/stage-mirador.ts"]);
}

run([process.execPath, "x", "electrobun", "build", "--env=stable"], {
  ...process.env,
  ELECTROBUN_DEVELOPER_ID: process.env.ELECTROBUN_DEVELOPER_ID || "-",
  ...(release && { MIRADOR_DESKTOP_RELEASE: "1", TAR_OPTIONS: "--format=ustar" }),
});

if (process.platform === "darwin") {
  run(["scripts/unwrap-macos-app.sh"]);
  run([process.execPath, "scripts/add-usage-descriptions.ts"]);
}

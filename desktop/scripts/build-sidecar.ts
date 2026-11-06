#!/usr/bin/env bun
/**
 * Builds the peer-to-peer sidecar a release carries, from the mirador-p2p commit desktop/p2p-sidecar.ts pins, into
 * the staged Mirador. MIRADOR_P2P_SOURCE names where to fetch that commit from instead of GitHub: a clone, or a git
 * bundle, as the Linux build's container has no GitHub key. The commit has to be on one of its branches.
 * Usage: build-sidecar.ts <staged Mirador>
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { sidecarFileName, sidecarInMirador } from "../../shared/p2p-sidecar.ts";
import { MIRADOR_P2P_COMMIT, MIRADOR_P2P_REPOSITORY } from "../p2p-sidecar.ts";

const checkout = join(import.meta.dir, "..", "build", "mirador-p2p");

function run(command: string[], cwd: string) {
  const { exitCode } = Bun.spawnSync(command, { cwd, stdio: ["inherit", "inherit", "inherit"] });
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
}

function checkOutThePinnedCommit(source: string) {
  if (!existsSync(join(checkout, ".git"))) {
    mkdirSync(checkout, { recursive: true });
    run(["git", "init", "-q"], checkout);
  }
  run(["git", "-c", "safe.directory=*", "fetch", "-q", source, "+refs/heads/*:refs/remotes/source/*"], checkout);
  run(["git", "checkout", "-qf", "--detach", MIRADOR_P2P_COMMIT], checkout);
}

export function buildSidecar(stagedMirador: string, source = process.env.MIRADOR_P2P_SOURCE || MIRADOR_P2P_REPOSITORY) {
  checkOutThePinnedCommit(source);
  run(["cargo", "build", "-q", "--release", "--locked", "-p", "mirador-p2p"], checkout);
  const built = join(checkout, "target", "release", sidecarFileName());
  const carried = join(stagedMirador, sidecarInMirador());
  mkdirSync(dirname(carried), { recursive: true });
  copyFileSync(built, carried);
  chmodSync(carried, 0o755);
  console.error(`Sidecar: mirador-p2p ${MIRADOR_P2P_COMMIT.slice(0, 7)} at ${carried}`);
}

if (import.meta.main) {
  const stagedMirador = process.argv[2];
  if (!stagedMirador) throw new Error("Usage: build-sidecar.ts <staged Mirador>");
  buildSidecar(stagedMirador);
}

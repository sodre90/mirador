import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { downloadedSidecar } from "../host/p2p/sidecar-download.ts";

const triedBuild = process.env.MIRADOR_P2P_BINARY;
/** The release this Mirador pins, as people get it, in a cache of the specs' own: never the owner's ~/.mirador. */
const pinnedRelease = downloadedSidecar(join(homedir(), ".cache", "mirador-e2e"));

/** The tunnel the peer-to-peer specs run: a mirador-p2p build MIRADOR_P2P_BINARY names, else the pinned release; null where none is published. */
export const sidecarProgram = triedBuild ?? pinnedRelease?.path ?? null;

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * Makes sure `sidecarProgram` is there before a spec runs it, fetching the pinned release once and checking its SHA-256.
 * Each worker writes under a name of its own and renames it into place, so one never runs another's half-written copy.
 */
export async function sidecarReady() {
  if (triedBuild) {
    if (!existsSync(triedBuild)) throw new Error(`MIRADOR_P2P_BINARY names ${triedBuild}, which isn't there.`);
    return;
  }
  const { path, download } = pinnedRelease!;
  if (existsSync(path) && sha256Of(readFileSync(path)) === download.sha256) return;
  const response = await fetch(download.url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Fetching the pinned mirador-p2p from ${download.url} failed: ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const got = sha256Of(bytes);
  if (got !== download.sha256) throw new Error(`The mirador-p2p from ${download.url} has SHA-256 ${got}, not the pinned ${download.sha256}.`);
  mkdirSync(dirname(path), { recursive: true });
  const ownCopy = `${path}.${process.pid}.partial`;
  writeFileSync(ownCopy, bytes);
  chmodSync(ownCopy, 0o755);
  renameSync(ownCopy, path);
}

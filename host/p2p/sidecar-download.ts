import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { RELEASES_REPOSITORY } from "../../shared/newer-version.ts";

/** Where to fetch the sidecar from, and the SHA-256 that tells it is the one this host was built for. */
export interface SidecarDownload {
  url: string;
  sha256: string;
}

/** The sidecar the host downloads the first time it needs peer to peer, from a prerelease of the public repository. */
export const SIDECAR_RELEASE = "p2p-sidecar-27ddcb2";
/** By `${process.platform}-${process.arch}`; scripts/publish-sidecar.ts writes them when it publishes a release. */
export const SIDECAR_SHA256: Partial<Record<string, string>> = {
  "darwin-arm64": "f0fb860510fe1ef2d961a8cd758609f7cce1d9e7700f408989fe12be5e6f58cd",
  "win32-x64": "fd116c2121c1c906478397ab68ce2063cc74e613a0535e3223e5c2ba8e7f2fe2",
  "linux-x64": "52f9e3ccecdcc5437dd4b375202bb8065b852319bce606ee0633bca0bd00a237",
  "linux-arm64": "4cca49e7f0499e9b231c6ab5315f11a7a669591f6eb00eefa54085a9ed958ff7",
};

const sidecarAsset = (platformAndCpu: string) => `mirador-p2p-${platformAndCpu}${platformAndCpu.startsWith("win32") ? ".exe" : ""}`;

export interface DownloadedSidecar {
  path: string;
  download: SidecarDownload;
}

/** The sidecar this machine downloads into `dataDir`, or null where none is published for it. */
export function downloadedSidecar(
  dataDir: string,
  platformAndCpu = `${process.platform}-${process.arch}`,
  sha256 = SIDECAR_SHA256[platformAndCpu],
): DownloadedSidecar | null {
  if (!sha256) return null;
  const asset = sidecarAsset(platformAndCpu);
  return {
    path: join(dataDir, "p2p", "bin", `${sha256.slice(0, 12)}-${asset}`),
    download: { url: `https://github.com/${RELEASES_REPOSITORY}/releases/download/${SIDECAR_RELEASE}/${asset}`, sha256 },
  };
}

const SIDECAR_DOWNLOAD_TIMEOUT_MS = 60_000;

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * Puts the sidecar at `path` unless the one there already has the expected SHA-256, and takes away the ones earlier
 * versions downloaded. It lands under a temporary name first, so a download cut short is never run.
 */
export async function installSidecar(path: string, { url, sha256 }: SidecarDownload, timeoutMs = SIDECAR_DOWNLOAD_TIMEOUT_MS) {
  if (existsSync(path) && sha256Of(readFileSync(path)) === sha256) return;
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Downloading the peer-to-peer sidecar from ${url} failed: ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const got = sha256Of(bytes);
  if (got !== sha256) throw new Error(`The peer-to-peer sidecar from ${url} is not the expected one: its SHA-256 is ${got}, not ${sha256}.`);
  const folder = dirname(path);
  mkdirSync(folder, { recursive: true });
  const partial = `${path}.partial`;
  writeFileSync(partial, bytes);
  chmodSync(partial, 0o755);
  renameSync(partial, path);
  readdirSync(folder)
    .filter((file) => file !== basename(path))
    .forEach((file) => rmSync(join(folder, file), { force: true }));
}

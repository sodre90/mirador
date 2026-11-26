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
export const SIDECAR_RELEASE = "p2p-sidecar-04611d7";
/** By `${process.platform}-${process.arch}`; scripts/publish-sidecar.ts writes them when it publishes a release. */
export const SIDECAR_SHA256: Partial<Record<string, string>> = {
  "darwin-arm64": "6a373b0c12cf9f0710a7833a68b1d9998e63c0fe158c8aa44bfe720148a3cb75",
  "win32-x64": "8329f7a61c3eebb867239df5388d608852e4c1293cda791006bc950331493890",
  "linux-x64": "71832d2e843d573d35de1073ca493e8207cb6b971794d3c256b543973cf169fa",
  "linux-arm64": "1ec7326459dbd41ddb5096f095aa854b292cea9e3d786439a130fdbcd5102ec9",
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

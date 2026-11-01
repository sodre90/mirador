import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { HostProblemError } from "../../../shared/host-problems.ts";

/** How a downloaded file proves it is the one asked for: Hugging Face gives LFS files' SHA-256 and other files' git blob SHA-1. */
export type Checksum = { sha256: string } | { gitBlobSha1: string };

export interface Download {
  url: string;
  destination: string;
  size: number;
  checksum: Checksum;
}

const ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_000, 5_000];

const sizeOf = async (path: string) => (await stat(path).catch(() => null))?.size ?? null;

/** Whether a download already finished: only verified files get their final name. */
export const isDownloaded = async ({ destination, size }: Download) => (await sizeOf(destination)) === size;

/** How much of a download is on disk already, finished or kept from an interrupted one. */
export async function bytesOnDisk(download: Download) {
  if (await isDownloaded(download)) return download.size;
  return Math.min((await sizeOf(partOf(download))) ?? 0, download.size);
}

const partOf = ({ destination }: Download) => `${destination}.part`;

async function checksumOf(path: string, checksum: Checksum, size: number) {
  const hash = createHash("sha256" in checksum ? "sha256" : "sha1");
  if ("gitBlobSha1" in checksum) hash.update(`blob ${size}\0`);
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const expectedChecksum = (checksum: Checksum) => ("sha256" in checksum ? checksum.sha256 : checksum.gitBlobSha1);

/** A server's failure worth asking again: it may answer the next time. */
class Transient extends HostProblemError {}

async function fetchRest(download: Download, from: number, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(download.url, { headers: from > 0 ? { Range: `bytes=${from}-` } : {}, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Transient({ code: "engine-could-not-reach", host: new URL(download.url).host, cause: error instanceof Error ? error.message : String(error) });
  }
  if (response.status >= 500 || response.status === 429) throw new Transient({ code: "engine-download-host-busy", host: new URL(download.url).host, status: response.status });
  if (!response.ok) throw new HostProblemError({ code: "engine-download-answered", host: new URL(download.url).host, status: response.status, url: download.url });
  return response;
}

async function downloadOnce(download: Download, signal: AbortSignal, onProgress: (bytesOnDisk: number) => void) {
  const part = partOf(download);
  await mkdir(dirname(part), { recursive: true });
  let from = await bytesOnDisk(download);
  if (from < download.size) {
    const response = await fetchRest(download, from, signal);
    if (response.status !== 206) from = 0;
    onProgress(from);
    const file = await open(part, from > 0 ? "a" : "w");
    try {
      for await (const chunk of response.body!) {
        await file.write(chunk);
        from += chunk.byteLength;
        onProgress(from);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Transient({ code: "engine-download-broke-off", url: download.url });
    } finally {
      await file.close();
    }
  }
  if ((await sizeOf(part)) !== download.size) {
    await rm(part, { force: true });
    onProgress(0);
    throw new Transient({ code: "engine-download-wrong-size", url: download.url, bytes: download.size });
  }
  if ((await checksumOf(part, download.checksum, download.size)) !== expectedChecksum(download.checksum)) {
    await rm(part, { force: true });
    onProgress(0);
    throw new HostProblemError({ code: "engine-download-differs", url: download.url });
  }
  await rename(part, download.destination);
}

/** Downloads where an interrupted download left off, asking again after a server's passing failure, and keeps a file only once it checks out. */
export async function downloadFile(download: Download, signal: AbortSignal, onProgress: (bytesOnDisk: number) => void, attempt = 1): Promise<void> {
  if (await isDownloaded(download)) return;
  try {
    await downloadOnce(download, signal, onProgress);
  } catch (error) {
    if (!(error instanceof Transient) || attempt === ATTEMPTS) throw error;
    await Bun.sleep(RETRY_DELAYS_MS[attempt - 1]!);
    await downloadFile(download, signal, onProgress, attempt + 1);
  }
}

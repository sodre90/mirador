import type { FoundAddress } from "../shared/model.ts";

/** Both of this machine's servers answer here, so an address can be checked before it is believed. */
export const HERE_PATH = "/mirador-here";

const PROBE_TIMEOUT_MS = 4000;
const REMEMBERED = 3;

/** The addresses other devices have reached this host at, newest first, as their browsers sent them. */
const seen: string[] = [];

const addressedLocally = (host: string) => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(host.replace(/:\d+$/, ""));

/** Every request from a device carries the address it reached us at, which is the one to offer when there is nothing else. */
export function rememberAddressUsed(host: string | null) {
  if (!host || addressedLocally(host) || seen.includes(host)) return;
  seen.unshift(host);
  seen.length = Math.min(seen.length, REMEMBERED);
}

export const addressesUsed = (): string[] => [...seen];

/** An address to try, and where it came from. */
export interface AddressCandidate {
  origin: string;
  how: FoundAddress["how"];
}

/** The canvas libraries are served from their own port, so an address that answers as the app is tried with that port swapped in. */
const canvasAlongside = (origin: string, canvasPort: number) => {
  const url = new URL(origin);
  url.port = String(canvasPort);
  return url.origin;
};

async function answersAsThisMirador(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}${HERE_PATH}`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.ok && ((await response.json()) as { mirador?: unknown }).mirador === true;
  } catch {
    return false;
  }
}

/** The candidates that answer as this Mirador, both its page and its canvas libraries, keeping the order they were offered in. */
export async function addressesThatAnswer(origins: AddressCandidate[], canvasPort: number): Promise<FoundAddress[]> {
  const checked = await Promise.all(
    origins.map(async (candidate) => {
      const canvasOrigin = canvasAlongside(candidate.origin, canvasPort);
      const [page, canvas] = await Promise.all([answersAsThisMirador(candidate.origin), answersAsThisMirador(canvasOrigin)]);
      return page && canvas ? { ...candidate, canvasOrigin } : null;
    }),
  );
  return checked.filter((candidate) => candidate !== null);
}

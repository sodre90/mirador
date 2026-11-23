export interface NewerPi {
  installed: string;
  latest: string;
}

const CHECK_TIMEOUT_MS = 10_000;

const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

const releaseVersionIn = (text: unknown) => {
  const version = typeof text === "string" ? text.trim().replace(/^v/i, "") : "";
  return RELEASE_VERSION.test(version) ? version : null;
};

/** pi's own check for a newer pi stays off the network with either set, so Mirador's does too. */
const keepsPiOffline = (environment: Record<string, string>) => Boolean(environment.PI_OFFLINE || environment.PI_SKIP_VERSION_CHECK);

export async function installedPiVersion(program: string, environment: Record<string, string>) {
  const child = Bun.spawn([program, "--version"], { env: environment, stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: CHECK_TIMEOUT_MS });
  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return exitCode === 0 ? releaseVersionIn(output) : null;
}

async function latestPiVersion(releaseUrl: string) {
  const response = await fetch(releaseUrl, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
  if (!response.ok) return null;
  const { version } = (await response.json()) as { version?: unknown };
  return releaseVersionIn(version);
}

/**
 * The pi at `program` and the newer one `releaseUrl` announces, which `pi update` installs; null when there is none or
 * either version can't be told.
 */
export async function newerPiThan(program: string, environment: Record<string, string>, releaseUrl: string): Promise<NewerPi | null> {
  if (keepsPiOffline(environment)) return null;
  try {
    const [installed, latest] = await Promise.all([installedPiVersion(program, environment), latestPiVersion(releaseUrl)]);
    return installed && latest && Bun.semver.order(latest, installed) > 0 ? { installed, latest } : null;
  } catch {
    return null;
  }
}

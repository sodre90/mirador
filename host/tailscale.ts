import { delimiter } from "node:path";
import { currentPath } from "./current-path.ts";
import { described, type DescribedProblem } from "../shared/host-problems.ts";

/** Where the Tailscale command sits when it is not on PATH, the app's own binary included. */
const TAILSCALE_DIRECTORIES = ["/Applications/Tailscale.app/Contents/MacOS", "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"];

const STATUS_TIMEOUT_MS = 5000;
const SERVE_TIMEOUT_MS = 20000;

export const tailscaleCommand = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const configured = env.MIRADOR_TAILSCALE;
  if (configured) return Bun.which(configured);
  return Bun.which("tailscale", { PATH: currentPath(env.PATH) }) ?? Bun.which("tailscale", { PATH: TAILSCALE_DIRECTORIES.join(delimiter) });
};

async function tailscale(command: string, args: string[], timeout: number) {
  const child = Bun.spawn([command, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}

/** This machine's name on the tailnet, e.g. macbook.tailnet.ts.net; null when Tailscale is not signed in. */
export async function tailnetName(command: string): Promise<string | null> {
  const { stdout, exitCode } = await tailscale(command, ["status", "--json"], STATUS_TIMEOUT_MS);
  if (exitCode !== 0) return null;
  try {
    const name = (JSON.parse(stdout) as { Self?: { DNSName?: string } }).Self?.DNSName;
    return name ? name.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}

/** Puts a port of this machine on the tailnet over HTTPS, mirroring the port, so the address is https://<name>:<port>. Says what went wrong, or null. */
export async function servePortOnTailnet(command: string, port: number): Promise<DescribedProblem | null> {
  const { stderr, stdout, exitCode } = await tailscale(command, ["serve", "--bg", `--https=${port}`, `http://127.0.0.1:${port}`], SERVE_TIMEOUT_MS);
  if (exitCode === 0) return null;
  const said = (stderr.trim() || stdout.trim()).split("\n").at(-1);
  return said ? { problem: said } : described({ code: "tailscale-serve-exited", exitCode });
}

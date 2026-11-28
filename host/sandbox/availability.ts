import { readFileSync } from "node:fs";
import { release } from "node:os";
import type { SandboxAvailability } from "../../shared/sandbox.ts";

/** macOS 26, which Apple's `container` needs, is Darwin 25. */
const FIRST_DARWIN_WITH_CONTAINER = 25;

export interface ThisComputer {
  platform: NodeJS.Platform;
  arch: string;
  darwinMajor: number;
}

export const thisComputer = (): ThisComputer => ({ platform: process.platform, arch: process.arch, darwinMajor: Number(release().split(".")[0]) || 0 });

/** Whether this computer can run a room's agents in a VM of Apple's: macOS 26 on Apple silicon, with Apple's `container` installed. */
export function appleContainerAvailability(computer: ThisComputer, program: string | null): SandboxAvailability {
  if (computer.platform !== "darwin") return { available: false, why: "unsupported-system" };
  if (computer.arch !== "arm64") return { available: false, why: "not-apple-silicon" };
  if (computer.darwinMajor < FIRST_DARWIN_WITH_CONTAINER) return { available: false, why: "macos-too-old" };
  if (program === null) return { available: false, why: "no-container-tool" };
  return { available: true, kind: "apple-container" };
}

/** Where the installers put `container`, `podman` and `docker`, for a host started without a login shell's PATH. */
const CONTAINER_INSTALL_FOLDERS = ["/usr/local/bin", "/opt/homebrew/bin"];
const LINUX_INSTALL_FOLDERS = ["/usr/bin", "/usr/local/bin"];

const installedProgram = (name: string, path: string, installFolders: string[]) => Bun.which(name, { PATH: path }) ?? Bun.which(name, { PATH: installFolders.join(":") });

/** The program the setting names: off on test hosts unless a spec gives one, else the one installed. */
function sandboxProgram(setting: string | undefined, path: string, name: string, installFolders: string[]): string | null | "off" {
  if (setting === "off") return "off";
  if (setting) return Bun.which(setting);
  return installedProgram(name, path, installFolders);
}

export const containerProgram = (setting: string | undefined, path: string) => sandboxProgram(setting, path, "container", CONTAINER_INSTALL_FOLDERS);

/** The `podman` or `docker` installed on this Linux computer, where one is. */
export const linuxEngineProgram = (name: "podman" | "docker", path: string) => installedProgram(name, path, LINUX_INSTALL_FOLDERS);

/** The `container` program sandboxes run with on a Mac, where they run at all, and why not where they don't. */
export function appleContainerRuntime(setting: string | undefined, path: string, computer = thisComputer()): { program: string | null; availability: SandboxAvailability } {
  const program = containerProgram(setting, path);
  if (program === "off") return { program: null, availability: { available: false, why: "turned-off" } };
  const availability = appleContainerAvailability(computer, program);
  return { program: availability.available ? program : null, availability };
}

/** What Podman or Docker says of itself on this computer, and whether SELinux enforces its rules here, as sandboxes need them. */
export interface EngineHere {
  /** What `<program> info --format json` printed; null where it failed. */
  info: string | null;
  selinuxEnforcing: boolean;
}

const objectIn = (json: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * Which engine a program is, by what its `info --format json` printed: Podman tells of its host, Docker of its server.
 * The `docker` of podman-docker is Podman, and says so.
 */
export function engineOfInfo(info: string): "podman" | "docker" | null {
  const said = objectIn(info);
  if (said === null) return null;
  if ("host" in said) return "podman";
  return "ServerVersion" in said ? "docker" : null;
}

/** Whether `podman info --format json` says it runs containers as this user, without root; null where it says neither. */
export function rootlessIn(info: string): boolean | null {
  try {
    const rootless = (JSON.parse(info) as { host?: { security?: { rootless?: unknown } } }).host?.security?.rootless;
    return typeof rootless === "boolean" ? rootless : null;
  } catch {
    return null;
  }
}

/** Where `podman info --format json` says Podman keeps its images and containers, and their state while they run. */
export function podmanStorageIn(info: string): string[] {
  try {
    const store = (JSON.parse(info) as { store?: { graphRoot?: unknown; runRoot?: unknown } }).store;
    return [store?.graphRoot, store?.runRoot].filter((folder): folder is string => typeof folder === "string" && folder !== "");
  } catch {
    return [];
  }
}

/** Whether Podman runs rooms' agents here, in a plain container: rootless only. */
export function podmanAvailability({ info, selinuxEnforcing }: EngineHere): SandboxAvailability {
  const rootless = info === null ? null : rootlessIn(info);
  if (rootless === null) return { available: false, why: "podman-fails" };
  if (!rootless) return { available: false, why: "podman-not-rootless" };
  return { available: true, kind: "podman", selinuxEnforcing };
}

/** Whether `docker info --format json` says its daemon runs as this user, without root; null where it says neither. */
export function dockerRootlessIn(info: string): boolean | null {
  const options = objectIn(info)?.SecurityOptions;
  return Array.isArray(options) ? options.includes("name=rootless") : null;
}

/** Where `docker info --format json` says Docker keeps its images and containers. */
export function dockerStorageIn(info: string): string[] {
  const root = objectIn(info)?.DockerRootDir;
  return typeof root === "string" && root !== "" ? [root] : [];
}

/** Whether Docker runs rooms' agents here, in a plain container: rootless only, as the root of a rootful one is this computer's. */
export function dockerAvailability({ info, selinuxEnforcing }: EngineHere): SandboxAvailability {
  const rootless = info === null ? null : dockerRootlessIn(info);
  if (rootless === null) return { available: false, why: "docker-fails" };
  if (!rootless) return { available: false, why: "docker-not-rootless" };
  return { available: true, kind: "docker", selinuxEnforcing };
}

const ENGINE_ASKED_WITHIN_MS = 20_000;

/** What a run of the engine's program printed, where it succeeded in time; asked once, as the host starts, so it waits for it. */
function engineSays(program: string, args: string[]): string | null {
  const ran = Bun.spawnSync([program, ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: ENGINE_ASKED_WITHIN_MS });
  return ran.exitCode === 0 ? ran.stdout.toString() : null;
}

/** Where the kernel says whether SELinux enforces its rules: 1 where it does, 0 where it only logs; missing where it is off. */
export const SELINUX_ENFORCE = "/sys/fs/selinux/enforce";

export function selinuxEnforcingAt(enforce: string) {
  try {
    return readFileSync(enforce, "utf8").trim() === "1";
  } catch {
    return false;
  }
}

/** What the `podman` or `docker` at `program` says of itself, and whether SELinux enforces its rules, as `selinuxEnforce` says. */
export const askEngine = (program: string, selinuxEnforce: string): EngineHere => ({ info: engineSays(program, ["info", "--format", "json"]), selinuxEnforcing: selinuxEnforcingAt(selinuxEnforce) });

/** Where a Linux engine's program is, to ask it of itself, and the file that says whether SELinux enforces its rules. */
export interface EngineProgram {
  program: string;
  selinuxEnforce: string;
}

/** A daemon that is up answers within a second; a page waits for the answer. */
export const ENGINE_ASKED_AGAIN_WITHIN_MS = 5_000;

/** What the engine says of itself, asked again while Mirador runs, as where its daemon had not started with Mirador: the host goes on meanwhile. */
export async function askEngineAgain(program: string, selinuxEnforce: string, withinMs = ENGINE_ASKED_AGAIN_WITHIN_MS): Promise<EngineHere> {
  const asked = Bun.spawn([program, "info", "--format", "json"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: withinMs });
  const [printed, exitCode] = await Promise.all([new Response(asked.stdout).text(), asked.exited]);
  return { info: exitCode === 0 ? printed : null, selinuxEnforcing: selinuxEnforcingAt(selinuxEnforce) };
}

/** Whether two answers of whether sandboxes run here are the same. */
export const sameAvailability = (one: SandboxAvailability, other: SandboxAvailability) => JSON.stringify(one) === JSON.stringify(other);

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

/** Where the installers put `container` and `podman`, for a host started without a login shell's PATH. */
const CONTAINER_INSTALL_FOLDERS = ["/usr/local/bin", "/opt/homebrew/bin"];
const PODMAN_INSTALL_FOLDERS = ["/usr/bin", "/usr/local/bin"];

/** The program the setting names: off on test hosts unless a spec gives one, else the one installed. */
function sandboxProgram(setting: string | undefined, path: string, name: string, installFolders: string[]): string | null | "off" {
  if (setting === "off") return "off";
  if (setting) return Bun.which(setting);
  return Bun.which(name, { PATH: path }) ?? Bun.which(name, { PATH: installFolders.join(":") });
}

export const containerProgram = (setting: string | undefined, path: string) => sandboxProgram(setting, path, "container", CONTAINER_INSTALL_FOLDERS);

export const podmanProgram = (setting: string | undefined, path: string) => sandboxProgram(setting, path, "podman", PODMAN_INSTALL_FOLDERS);

/** The `container` program sandboxes run with on a Mac, where they run at all, and why not where they don't. */
export function appleContainerRuntime(setting: string | undefined, path: string, computer = thisComputer()): { program: string | null; availability: SandboxAvailability } {
  const program = containerProgram(setting, path);
  if (program === "off") return { program: null, availability: { available: false, why: "turned-off" } };
  const availability = appleContainerAvailability(computer, program);
  return { program: availability.available ? program : null, availability };
}

/** What Podman says of itself on this computer, and whether SELinux enforces its rules here, as sandboxes need them. */
export interface PodmanHere {
  /** What `podman info --format json` printed; null where it failed. */
  info: string | null;
  selinuxEnforcing: boolean;
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
export function podmanAvailability({ info, selinuxEnforcing }: PodmanHere): SandboxAvailability {
  const rootless = info === null ? null : rootlessIn(info);
  if (rootless === null) return { available: false, why: "podman-fails" };
  if (!rootless) return { available: false, why: "podman-not-rootless" };
  return { available: true, kind: "podman", selinuxEnforcing };
}

const PODMAN_ASKED_WITHIN_MS = 20_000;

/** What a run of `podman` printed, where it succeeded in time; asked once, as the host starts, so it waits for it. */
function podmanSays(program: string, args: string[]): string | null {
  const ran = Bun.spawnSync([program, ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: PODMAN_ASKED_WITHIN_MS });
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

/** What the `podman` at `program` says of itself, and whether SELinux enforces its rules, as `selinuxEnforce` says. */
export const askPodman = (program: string, selinuxEnforce: string): PodmanHere => ({ info: podmanSays(program, ["info", "--format", "json"]), selinuxEnforcing: selinuxEnforcingAt(selinuxEnforce) });

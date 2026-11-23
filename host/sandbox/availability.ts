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

/** Whether this computer can run a room's agents in a VM: macOS 26 on Apple silicon, with Apple's `container` installed. */
export function sandboxAvailability(computer: ThisComputer, program: string | null): SandboxAvailability {
  if (computer.platform !== "darwin") return { available: false, why: "not-a-mac" };
  if (computer.arch !== "arm64") return { available: false, why: "not-apple-silicon" };
  if (computer.darwinMajor < FIRST_DARWIN_WITH_CONTAINER) return { available: false, why: "macos-too-old" };
  if (program === null) return { available: false, why: "no-container-tool" };
  return { available: true };
}

/** Where the installer puts `container`, for a host started without a login shell's PATH. */
const CONTAINER_INSTALL_FOLDERS = ["/usr/local/bin", "/opt/homebrew/bin"];

/** The `container` program the setting names: off on test hosts unless a spec gives one, else the one installed. */
export function containerProgram(setting: string | undefined, path: string): string | null | "off" {
  if (setting === "off") return "off";
  if (setting) return Bun.which(setting);
  return Bun.which("container", { PATH: path }) ?? Bun.which("container", { PATH: CONTAINER_INSTALL_FOLDERS.join(":") });
}

/** The `container` program sandboxes run with, where they run at all, and why not where they don't. */
export function sandboxRuntime(setting: string | undefined, path: string, computer = thisComputer()): { program: string | null; availability: SandboxAvailability } {
  const program = containerProgram(setting, path);
  if (program === "off") return { program: null, availability: { available: false, why: "turned-off" } };
  const availability = sandboxAvailability(computer, program);
  return { program: availability.available ? program : null, availability };
}

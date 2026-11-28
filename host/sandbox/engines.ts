import { basename } from "node:path";
import { engineInUse, type SandboxEngines, type SandboxKind } from "../../shared/sandbox.ts";
import { AppleContainer } from "./apple-container.ts";
import { askEngine, engineOfInfo, linuxEngineProgram, SELINUX_ENFORCE } from "./availability.ts";
import { Docker } from "./docker.ts";
import { Podman } from "./podman.ts";
import type { VmLauncher } from "./vm-launcher.ts";

/** The engines of sandboxes on Linux, in the order Mirador takes one where the owner chose none. */
export const LINUX_ENGINES = ["podman", "docker"] as const satisfies readonly SandboxKind[];
export type LinuxEngine = (typeof LINUX_ENGINES)[number];

interface FoundEngine {
  kind: LinuxEngine;
  launcher: Podman | Docker;
}

/** The engine a program is, as its `info` says, else as its name says, as where its daemon doesn't answer. */
function engineAt(program: string, named: LinuxEngine, selinuxEnforce: string): FoundEngine {
  const here = askEngine(program, selinuxEnforce);
  const kind = (here.info === null ? null : engineOfInfo(here.info)) ?? named;
  const asked = { program, selinuxEnforce };
  return { kind, launcher: kind === "docker" ? Docker.of(asked, here) : Podman.of(asked, here) };
}

/** Podman and Docker where installed, once each: the `docker` of podman-docker is Podman, found as `podman` already. */
function installedHere(path: string, selinuxEnforce: string): FoundEngine[] {
  const found = LINUX_ENGINES.flatMap((name) => {
    const program = linuxEngineProgram(name, path);
    return program ? [engineAt(program, name, selinuxEnforce)] : [];
  });
  return LINUX_ENGINES.flatMap((kind) => found.find((engine) => engine.kind === kind) ?? []);
}

/** The engines of this computer as they say now, the launcher of the one in use, and where all of them keep their images. */
export interface EnginesHere {
  launcher: VmLauncher;
  /** The engines found as Mirador started, each as it says now, and the one in use since; `chosen` as it was then. */
  engines(): SandboxEngines;
  /** Where each engine here keeps its images and containers, which other containers run, whichever runs sandboxes. */
  storage(): string[];
  /** Asks each engine found that can't run sandboxes again, as where its daemon had not started with Mirador; whether any says otherwise now. */
  askAgain(): Promise<boolean>;
}

const anyChanged = async (asked: Promise<boolean>[]) => (await Promise.all(asked)).some(Boolean);

/**
 * The engines of this Linux computer: the program MIRADOR_SANDBOX names, as the engine it says it is, and none where it
 * turns sandboxes off; else Podman and Docker where installed, the one chosen in use, or Mirador's own pick.
 */
export function linuxEnginesHere(setting: string | undefined, chosen: SandboxKind | null, path: string, selinuxEnforce = SELINUX_ENFORCE): EnginesHere {
  const setByEnvironment = Boolean(setting);
  const named = setting && setting !== "off" ? Bun.which(setting) : null;
  const found = setting === "off" ? [] : setting ? (named ? [engineAt(named, basename(named) === "docker" ? "docker" : "podman", selinuxEnforce)] : []) : installedHere(path, selinuxEnforce);
  const inUse = engineInUse(
    found.map(({ kind, launcher }) => ({ kind, runs: launcher.availability().available })),
    setByEnvironment ? null : chosen,
  );
  const launcher = found.find(({ kind }) => kind === inUse)?.launcher ?? new Podman(null, { available: false, why: setting === "off" ? "turned-off" : "no-linux-engine" });
  return {
    launcher,
    engines: () => ({ found: found.map(({ kind, launcher }) => ({ kind, availability: launcher.availability() })), chosen, inUse, setByEnvironment }),
    storage: () => found.flatMap(({ launcher }) => launcher.storage),
    askAgain: () => anyChanged(found.map(({ launcher }) => launcher.askAgain())),
  };
}

/** On a Mac, Apple's `container`, the only engine there; elsewhere none. */
export function appleEnginesHere(setting: string | undefined, path: string): EnginesHere {
  const launcher = AppleContainer.here(setting, path);
  const here = process.platform === "darwin" && setting !== "off";
  return {
    launcher,
    engines: () => ({ found: here ? [{ kind: "apple-container", availability: launcher.availability() }] : [], chosen: null, inUse: here ? "apple-container" : null, setByEnvironment: Boolean(setting) }),
    storage: () => [],
    askAgain: () => launcher.askAgain(),
  };
}

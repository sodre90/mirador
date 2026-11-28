import { basename } from "node:path";
import type { SandboxEngines, SandboxKind } from "../../shared/sandbox.ts";
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
  return { kind, launcher: kind === "docker" ? Docker.of(program, here) : Podman.of(program, here) };
}

/** Podman and Docker where installed, once each: the `docker` of podman-docker is Podman, found as `podman` already. */
function installedHere(path: string, selinuxEnforce: string): FoundEngine[] {
  const found = LINUX_ENGINES.flatMap((name) => {
    const program = linuxEngineProgram(name, path);
    return program ? [engineAt(program, name, selinuxEnforce)] : [];
  });
  return LINUX_ENGINES.flatMap((kind) => found.find((engine) => engine.kind === kind) ?? []);
}

/**
 * The engine Mirador uses: the one chosen, where it is here, whether it runs sandboxes or not, so what keeps it from them
 * shows; else the first here that runs them; else the first here.
 */
export function engineInUse(found: { kind: LinuxEngine; runs: boolean }[], chosen: SandboxKind | null): LinuxEngine | null {
  return (found.find(({ kind }) => kind === chosen) ?? found.find(({ runs }) => runs) ?? found[0])?.kind ?? null;
}

/** The engines of this computer, the launcher of the one in use, and where all of them keep their images. */
export interface EnginesHere {
  launcher: VmLauncher;
  engines: SandboxEngines;
  /** Where each engine here keeps its images and containers, which other containers run, whichever runs sandboxes. */
  storage: string[];
}

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
    engines: { found: found.map(({ kind, launcher }) => ({ kind, availability: launcher.availability() })), chosen, inUse, setByEnvironment },
    storage: found.flatMap(({ launcher }) => launcher.storage),
  };
}

/** On a Mac, Apple's `container`, the only engine there; elsewhere none. */
export function appleEnginesHere(setting: string | undefined, path: string): EnginesHere {
  const launcher = AppleContainer.here(setting, path);
  const availability = launcher.availability();
  const found = process.platform === "darwin" && !(setting === "off") ? [{ kind: "apple-container" as const, availability }] : [];
  return { launcher, engines: { found, chosen: null, inUse: found.length > 0 ? "apple-container" : null, setByEnvironment: Boolean(setting) }, storage: [] };
}

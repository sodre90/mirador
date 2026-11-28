import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askEngineAgain, dockerAvailability, dockerRootlessIn, dockerStorageIn, engineOfInfo } from "../host/sandbox/availability.ts";
import { linuxEnginesHere } from "../host/sandbox/engines.ts";
import { engineFromNextStart, engineInUse, type SandboxEngines } from "../shared/sandbox.ts";
import { fakeProgram } from "./fake-program.ts";

const scratch = mkdtempSync(join(tmpdir(), "sandbox-engines-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const PODMAN_INFO = { host: { security: { rootless: true } }, store: { graphRoot: "/home/someone/.local/share/containers/storage", runRoot: "/run/user/1000/containers" } };
const dockerInfo = (rootless: boolean) => ({ ServerVersion: "29.1.0", SecurityOptions: ["name=seccomp,profile=builtin", ...(rootless ? ["name=rootless"] : []), "name=cgroupns"], DockerRootDir: "/home/someone/.local/share/docker" });

/** A program that prints this JSON as its info, or fails as a client whose daemon doesn't answer. */
const says = (info: object | null) => (info === null ? `console.error("Cannot connect to the Docker daemon"); process.exit(1);` : `console.log(${JSON.stringify(JSON.stringify(info))});`);

/** A folder for PATH holding a fake `podman` and `docker`, as each is given; a missing one prints nothing and fails. */
function programs(engines: { podman?: object | null; docker?: object | null }) {
  const folder = join(scratch, crypto.randomUUID());
  mkdirSync(folder);
  fakeProgram(folder, "podman", says(engines.podman ?? null));
  fakeProgram(folder, "docker", says(engines.docker ?? null));
  return folder;
}

const foundIn = ({ engines }: ReturnType<typeof linuxEnginesHere>) => engines().found.map(({ kind, availability }) => [kind, availability.available ? "runs" : availability.why]);

test("which engine a program is, and whether Docker runs its containers without root, is read from its info", () => {
  expect(engineOfInfo(JSON.stringify(PODMAN_INFO))).toBe("podman");
  expect(engineOfInfo(JSON.stringify(dockerInfo(true)))).toBe("docker");
  expect(engineOfInfo(JSON.stringify({ host: {}, ServerVersion: "5.6.0" }))).toBe("podman");
  expect(engineOfInfo("[]")).toBeNull();
  expect(engineOfInfo("garbage")).toBeNull();
  expect(dockerRootlessIn(JSON.stringify(dockerInfo(true)))).toBe(true);
  expect(dockerRootlessIn(JSON.stringify(dockerInfo(false)))).toBe(false);
  expect(dockerRootlessIn(JSON.stringify({ ServerVersion: "29.1.0" }))).toBeNull();
  expect(dockerStorageIn(JSON.stringify(dockerInfo(true)))).toEqual(["/home/someone/.local/share/docker"]);
  expect(dockerStorageIn("{}")).toEqual([]);
  expect(dockerAvailability({ info: JSON.stringify(dockerInfo(true)), selinuxEnforcing: true })).toEqual({ available: true, kind: "docker", selinuxEnforcing: true });
  expect(dockerAvailability({ info: JSON.stringify(dockerInfo(false)), selinuxEnforcing: false })).toEqual({ available: false, why: "docker-not-rootless" });
  expect(dockerAvailability({ info: null, selinuxEnforcing: false })).toEqual({ available: false, why: "docker-fails" });
});

test("the engine in use is the one chosen where it is here, even where it can't run sandboxes; else the first that can; else the first here", () => {
  const both = [
    { kind: "podman" as const, runs: true },
    { kind: "docker" as const, runs: true },
  ];
  expect(engineInUse(both, null)).toBe("podman");
  expect(engineInUse(both, "docker")).toBe("docker");
  expect(engineInUse([{ kind: "podman", runs: true }], "docker")).toBe("podman");
  expect(engineInUse([{ kind: "podman", runs: false }, { kind: "docker", runs: true }], null)).toBe("docker");
  expect(engineInUse([{ kind: "podman", runs: true }, { kind: "docker", runs: false }], "docker")).toBe("docker");
  expect(engineInUse([{ kind: "podman", runs: false }, { kind: "docker", runs: false }], null)).toBe("podman");
  expect(engineInUse([], "docker")).toBeNull();
});

test("the engine Settings says Mirador runs from its next start is the one MIRADOR_SANDBOX sets, else the one chosen where it is still here, else the one in use", () => {
  const runs = { available: true, kind: "podman", selinuxEnforcing: false } as const;
  const both: SandboxEngines = {
    found: [
      { kind: "podman", availability: runs },
      { kind: "docker", availability: { ...runs, kind: "docker" } },
    ],
    chosen: null,
    inUse: "podman",
    setByEnvironment: false,
  };
  expect(engineFromNextStart(both)).toBe("podman");
  expect(engineFromNextStart({ ...both, chosen: "docker" })).toBe("docker");
  expect(engineFromNextStart({ ...both, found: both.found.slice(0, 1), chosen: "docker" })).toBe("podman");
  expect(engineFromNextStart({ ...both, chosen: "podman", inUse: "docker", setByEnvironment: true })).toBe("docker");
  expect(engineFromNextStart({ found: [], chosen: "docker", inUse: null, setByEnvironment: true })).toBeNull();
  expect(engineFromNextStart({ ...both, inUse: "docker" })).toBe("podman");
});

/** A `docker` whose daemon answers only once `up` is there, as one that starts after Mirador; it writes a letter each time it is asked. */
function dockerStartingLater() {
  const folder = join(scratch, crypto.randomUUID());
  mkdirSync(folder);
  const [up, asked] = [join(folder, "up"), join(folder, "asked")];
  fakeProgram(folder, "podman", says(null));
  fakeProgram(
    folder,
    "docker",
    `const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(asked)}, "i");
if (!fs.existsSync(${JSON.stringify(up)})) process.exit(1);
${says(dockerInfo(true))}`,
  );
  return { path: folder, startsUp: () => writeFileSync(up, ""), timesAsked: () => (existsSync(asked) ? readFileSync(asked, "utf8").length : 0) };
}

describe.skipIf(process.platform === "win32")("the engines of a Linux computer", () => {
  test("ask an engine that couldn't run sandboxes again, one ask at a time, and take what it says once its daemon is up; one that runs is not asked", async () => {
    const docker = dockerStartingLater();
    const here = linuxEnginesHere(undefined, "docker", docker.path);
    expect([here.engines().inUse, here.launcher.availability()]).toEqual(["docker", { available: false, why: "docker-fails" }]);
    expect(here.storage()).toEqual([]);
    const askedAtStart = docker.timesAsked();

    expect(await here.launcher.askAgain()).toBe(false);
    expect(docker.timesAsked()).toBe(askedAtStart + 1);

    docker.startsUp();
    expect(await Promise.all([here.launcher.askAgain(), here.launcher.askAgain()])).toEqual([true, true]);
    expect(docker.timesAsked()).toBe(askedAtStart + 2);
    expect(here.launcher.availability()).toEqual({ available: true, kind: "docker", selinuxEnforcing: false });
    expect(foundIn(here)).toEqual([
      ["podman", "podman-fails"],
      ["docker", "runs"],
    ]);
    expect(here.storage()).toEqual(["/home/someone/.local/share/docker"]);

    expect(await here.launcher.askAgain()).toBe(false);
    expect(docker.timesAsked()).toBe(askedAtStart + 2);
  });

  test("ask every engine found that can't run sandboxes when Settings shows them, and say whether any says otherwise now", async () => {
    const docker = dockerStartingLater();
    const here = linuxEnginesHere(undefined, null, docker.path);
    expect(here.engines().inUse).toBe("podman");
    expect(await here.askAgain()).toBe(false);
    docker.startsUp();
    expect(await here.askAgain()).toBe(true);
    expect(foundIn(here)).toEqual([
      ["podman", "podman-fails"],
      ["docker", "runs"],
    ]);
    expect(engineFromNextStart({ ...here.engines(), chosen: null })).toBe("docker");
  });

  test("give up on an engine that doesn't answer when asked again, so a page waits for it only so long", async () => {
    const folder = join(scratch, crypto.randomUUID());
    mkdirSync(folder);
    const hanging = fakeProgram(folder, "docker", "setTimeout(() => {}, 60_000);");
    const startedAt = Date.now();
    expect(await askEngineAgain(hanging, join(folder, "no-selinux"), 300)).toEqual({ info: null, selinuxEnforcing: false });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  test("are Podman and Docker where both are installed, Podman in use unless Docker is chosen, and each keeps its images where it says", () => {
    const path = programs({ podman: PODMAN_INFO, docker: dockerInfo(true) });

    const unchosen = linuxEnginesHere(undefined, null, path);
    expect(foundIn(unchosen)).toEqual([
      ["podman", "runs"],
      ["docker", "runs"],
    ]);
    expect([unchosen.engines().inUse, unchosen.launcher.filesOwner, unchosen.engines().setByEnvironment]).toEqual(["podman", "1000:1000", false]);
    expect(unchosen.storage()).toEqual(["/home/someone/.local/share/containers/storage", "/run/user/1000/containers", "/home/someone/.local/share/docker"]);

    const docker = linuxEnginesHere(undefined, "docker", path);
    expect([docker.engines().inUse, docker.engines().chosen, docker.launcher.filesOwner]).toEqual(["docker", "docker", "0:0"]);
    expect(docker.launcher.availability()).toEqual({ available: true, kind: "docker", selinuxEnforcing: false });
  });

  test("keep a chosen Docker that runs as root in use, so Settings and the room tell why it runs no sandbox, rather than another engine taking over", () => {
    const path = programs({ podman: PODMAN_INFO, docker: dockerInfo(false) });

    expect(foundIn(linuxEnginesHere(undefined, null, path))).toEqual([
      ["podman", "runs"],
      ["docker", "docker-not-rootless"],
    ]);
    expect(linuxEnginesHere(undefined, null, path).engines().inUse).toBe("podman");
    const chosen = linuxEnginesHere(undefined, "docker", path);
    expect(chosen.engines().inUse).toBe("docker");
    expect(chosen.launcher.availability()).toEqual({ available: false, why: "docker-not-rootless" });
  });

  test("count podman-docker's `docker` as the Podman it is, once", () => {
    const path = programs({ podman: PODMAN_INFO, docker: PODMAN_INFO });
    expect(foundIn(linuxEnginesHere(undefined, "docker", path))).toEqual([["podman", "runs"]]);
    expect(linuxEnginesHere(undefined, "docker", path).engines().inUse).toBe("podman");
  });

  test("are a Docker whose daemon doesn't answer, as Docker by its name, so Settings tells it can't run sandboxes", () => {
    const path = programs({ podman: null, docker: null });
    expect(foundIn(linuxEnginesHere(undefined, null, path))).toEqual([
      ["podman", "podman-fails"],
      ["docker", "docker-fails"],
    ]);
  });

  test("are the one MIRADOR_SANDBOX names, as the engine it says it is, whatever the owner chose; or none where it turns sandboxes off", () => {
    const path = programs({ podman: PODMAN_INFO, docker: dockerInfo(true) });

    const named = linuxEnginesHere(join(path, "docker"), "podman", path);
    expect(foundIn(named)).toEqual([["docker", "runs"]]);
    expect([named.engines().inUse, named.engines().setByEnvironment, named.engines().chosen]).toEqual(["docker", true, "podman"]);

    const off = linuxEnginesHere("off", "docker", path);
    expect([off.engines().found, off.engines().inUse, off.launcher.availability()]).toEqual([[], null, { available: false, why: "turned-off" }]);
    const missing = linuxEnginesHere(join(path, "no-such-engine"), null, path);
    expect([missing.engines().found, missing.launcher.availability()]).toEqual([[], { available: false, why: "no-linux-engine" }]);
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { roomSandbox, type SandboxAvailability, type SandboxNotReadyWhy, type SandboxSetup } from "../shared/sandbox.ts";
import { KEY_PLACEHOLDER } from "../host/sandbox/agent-environment.ts";
import { IMAGE_NAME } from "../host/sandbox/image.ts";
import { ANTHROPIC_API } from "../host/sandbox/model-proxy.ts";
import { computersOwnOnLinux, containersLabelled, imageNamesIn, othersContainersIn, Podman, writableSourcesIn } from "../host/sandbox/podman.ts";
import { Sandboxes, type AgentInSandbox, type SandboxHost } from "../host/sandbox/sandboxes.ts";
import { FakePodmanCli, NODE_IMAGE } from "./fake-podman-cli.ts";
import { guardedIn, mountsOfRun } from "./guard-told.ts";
import { RUNS_SANDBOXES } from "./sandbox-computer.ts";

const scratch = mkdtempSync(join(tmpdir(), "podman-sandbox-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const KEY = "sk-ant-the-profiles-own-key-5678";
const PLAIN: SandboxAvailability = { available: true, kind: "podman", selinuxEnforcing: false };
const IDLE_STOP_MS = 30;
const runsShellScripts = process.platform !== "win32";

function repository() {
  const folder = join(scratch, `workspace-${crypto.randomUUID()}`);
  mkdirSync(folder);
  Bun.spawnSync(["git", "init", "-q", folder]);
  return realpathSync(folder);
}

function hostFor(workspace: string) {
  const setups: SandboxSetup[] = [];
  const host: SandboxHost = {
    dataDir: join(scratch, `data-${crypto.randomUUID()}`),
    workspaceOf: () => workspace,
    canvasOf: () => ({ belongs: () => true, tokenOf: () => "token", handle: () => new Response("canvas") }),
    atWork: () => ({ agents: ["builder"], conversationIds: [] }),
    setupChanged: (setup) => setups.push(setup),
    heldChanged: () => {},
    foldersOf: () => [],
    networkOf: () => "closed" as const,
    otherSandboxes: () => ({ workspaces: [], writableFolders: [], writableFoldersOn: [], foldersLeft: [] }),
    foldersStarted: () => {},
    places: { home: "/nonexistent-home", dataDir: join(scratch, "mirador-data"), checkout: "/nonexistent-checkout", computersOwn: [] },
  };
  return { host, setups };
}

const agentIn = (workspace: string, changes: Partial<AgentInSandbox> = {}): AgentInSandbox => ({
  owner: roomSandbox("room-1"),
  allowsSharedKernel: true,
  profileId: "builder",
  kind: { harness: "claude", keyVariable: "ANTHROPIC_API_KEY" },
  version: "2.1.330",
  workingDirectory: workspace,
  given: { ANTHROPIC_API_KEY: KEY, DEPLOY_TARGET: "staging", XDG_RUNTIME_DIR: "/run/user/given" },
  route: { upstream: ANTHROPIC_API, api: "anthropic-messages", key: KEY, keyHeader: "x-api-key", headers: [] },
  agent: ["/usr/local/bin/bun", "/checkout/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"],
  ...changes,
});

const notReady = (why: Partial<SandboxNotReadyWhy>) => ({ problem: { code: "sandbox-not-ready", why } });

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
const valuesAfter = (args: string[], flag: string) => args.flatMap((arg, index) => (args[index - 1] === flag ? [arg] : []));
const mountedAt = (run: string[], target: string) => valuesAfter(run, "-v").find((mount) => mount.endsWith(`:${target}`))!.split(":")[0]!;
const modeOf = (path: string) => statSync(path).mode & 0o777;

describe("a room's sandbox on rootless Podman", () => {
  test.skipIf(!RUNS_SANDBOXES)("starts as a root that is nobody on this computer and may only guard the workspace, and its agents as the agent user, who is this computer's user there, with no capability nor any to gain, no network, limits, and a capped log; the key is nowhere in it", async () => {
    const workspace = repository();
    const { host, setups } = hostFor(workspace);
    const cli = new FakePodmanCli();
    const sandboxes = new Sandboxes(new Podman(cli, PLAIN), host, IDLE_STOP_MS);

    const launched = await sandboxes.launch(agentIn(workspace));

    const [run] = cli.callsOf("run");
    expect(cli.calls.find((args) => args.includes("run"))![0]).toBe("run");
    expect(run).toEqual(expect.arrayContaining(["--detach", "--rm", "--init"]));
    expect(valueAfter(run!, "--userns")).toBe("keep-id:uid=1000,gid=1000");
    expect(valueAfter(run!, "--user")).toBe("0:0");
    expect(valueAfter(run!, "--cap-drop")).toBe("all");
    expect(valueAfter(run!, "--cap-add")).toBe("SYS_ADMIN,DAC_OVERRIDE,FOWNER,SETUID,SETGID,SETPCAP");
    expect(valuesAfter(run!, "--device")).toEqual(["/dev/fuse"]);
    expect(valuesAfter(run!, "--security-opt")).toEqual(["no-new-privileges", "label=disable"]);
    expect(valueAfter(run!, "--network")).toBe("none");
    expect(run).toContain("--http-proxy=false");
    expect([valueAfter(run!, "--memory"), valueAfter(run!, "--memory-swap"), valueAfter(run!, "--cpus"), valueAfter(run!, "--pids-limit")]).toEqual(["3G", "3G", "4", "4096"]);
    expect([valueAfter(run!, "--log-driver"), valueAfter(run!, "--log-opt")]).toEqual(["k8s-file", "max-size=1mb"]);
    expect(valuesAfter(run!, "--label")).toContain("mirador.owner=room:room-1");
    const mounts = mountsOfRun(run!);
    expect(mounts.filter(({ source }) => source === workspace || source.startsWith(`${workspace}/`))).toEqual([{ source: workspace, target: "/mirador/raw/0", readOnly: false }]);
    expect(guardedIn(mounts)).toEqual([{ folder: workspace, parts: { files: [], folders: [], onTheWay: [], gitFolders: [".git"] } }]);
    expect(run!.slice(-9)).toEqual(["mirador-guard", "/mirador/guard/folders", "1000:1000", "--", "sh", "/mirador/sandbox/room-vm.sh", "7701=/run/mirador/canvas.sock", "7702=/run/mirador/model.sock", "7703=/run/mirador/network.sock"]);
    const sockets = ["canvas", "model", "network"].map((name) => mountedAt(run!, `/run/mirador/${name}.sock`));
    expect(sockets.map(modeOf)).toEqual([0o600, 0o600, 0o600]);
    expect(modeOf(dirname(sockets[0]!))).toBe(0o700);
    expect(new Set(sockets.map(dirname)).size).toBe(1);

    const [program, ...exec] = launched.command;
    expect(program).toBe(cli.program);
    expect(exec.slice(0, 6)).toEqual(["exec", "-i", "--user", "0:0", "-w", workspace]);
    expect(exec).toEqual(expect.arrayContaining(["/usr/bin/setpriv", "--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--bounding-set=-all", "--no-new-privs"]));
    expect(exec.slice(-2)).toEqual(agentIn(workspace).agent);
    expect(exec).toContain("HOME=/home/node");
    expect(exec).toContain("XDG_RUNTIME_DIR=/run/user/given");
    expect(exec).toContain("DEPLOY_TARGET");
    expect(exec.join(" ")).not.toContain("staging");
    expect(launched.environment).toMatchObject({ ANTHROPIC_API_KEY: KEY_PLACEHOLDER, DEPLOY_TARGET: "staging", HOME: process.env.HOME });
    expect(JSON.stringify([cli.calls, launched.command, launched.environment])).not.toContain(KEY);

    expect(setups.map(({ stage }) => stage)).toEqual(["building-image", ...Array.from({ length: 8 }, () => "building-image" as const), "ready"]);
    expect(setups.flatMap(({ step }) => (step ? [`${step.at}/${step.of}`] : []))).toEqual(["1/8", "2/8", "3/8", "4/8", "5/8", "6/8", "7/8", "8/8"]);
    expect(cli.callsOf("build")[0]).toContain("--layers=false");
    expect(cli.callsOf("build")[0]).not.toContain("--platform");

    launched.gone!();
    await Bun.sleep(IDLE_STOP_MS * 4);
    expect(cli.containers.size).toBe(0);
    expect(cli.callsOf("rm").at(-1)).toEqual(["rm", "--force", "--ignore", "--time", "5", run![run!.indexOf("--name") + 1]!]);
    expect(existsSync(dirname(sockets[0]!))).toBe(false);
    await sandboxes.stopAll();
  });

  test("never lets a value the room gives its agent steer Podman on this computer: Podman's own variables reach the container on the command line, and Podman sees only this computer's", async () => {
    const workspace = repository();
    const cli = new FakePodmanCli();
    const sandboxes = new Sandboxes(new Podman(cli, PLAIN), hostFor(workspace).host, IDLE_STOP_MS);
    const steering = {
      CONTAINER_HOST: "ssh://elsewhere.example/run/podman/podman.sock",
      CONTAINERS_CONF: "/tmp/given/containers.conf",
      _CONTAINERS_USERNS_CONFIGURED: "done",
      STORAGE_DRIVER: "vfs",
      REGISTRIES_CONFIG_PATH: "/tmp/given/registries.conf",
      PODMAN_USERNS: "host",
    };
    const unsetHere = Object.keys(steering).filter((name) => process.env[name] === undefined);

    const launched = await sandboxes.launch(agentIn(workspace, { given: { ...agentIn(workspace).given, ...steering } }));

    const exec = launched.command.slice(1);
    Object.entries(steering).forEach(([name, value]) => expect(exec).toContain(`${name}=${value}`));
    unsetHere.forEach((name) => expect(launched.environment[name]).toBeUndefined());
    expect(launched.environment.DEPLOY_TARGET).toBe("staging");
    launched.gone!();
    await sandboxes.stopAll();
  });

  test("is never a plain container sharing this computer's kernel for a room that did not allow it", async () => {
    const workspace = repository();
    const cli = new FakePodmanCli();
    const sandboxes = new Sandboxes(new Podman(cli, PLAIN), hostFor(workspace).host, IDLE_STOP_MS);

    await expect(sandboxes.launch(agentIn(workspace, { allowsSharedKernel: false }))).rejects.toMatchObject(notReady({ kind: "shared-kernel-not-allowed" }));

    expect(cli.calls).toEqual([]);
    await sandboxes.stopAll();
  });

  test("builds the image once, removes the image it builds on where the build pulled it and the earlier versions, and leaves every other image", async () => {
    const workspace = repository();
    const cli = new FakePodmanCli();
    cli.images.add(`localhost/${IMAGE_NAME}:claude-2.1.329-bun-1.4.3-0123456789`);
    const sandboxes = new Sandboxes(new Podman(cli, PLAIN), hostFor(workspace).host, IDLE_STOP_MS);

    (await sandboxes.launch(agentIn(workspace))).gone!();
    await sandboxes.stop(roomSandbox("room-1"));
    (await sandboxes.launch(agentIn(workspace))).gone!();

    expect(cli.callsOf("build")).toHaveLength(1);
    expect([...cli.images].filter((name) => !name.includes(`${IMAGE_NAME}:claude-2.1.330-`))).toEqual(["docker.io/library/postgres:16"]);
    expect(cli.callsOf("image").filter(([, sub]) => sub === "rm")).toEqual([
      ["image", "rm", NODE_IMAGE],
      ["image", "rm", `localhost/${IMAGE_NAME}:claude-2.1.329-bun-1.4.3-0123456789`],
    ]);
    await sandboxes.stopAll();
  });

  test("keeps the image it builds on where it was there before", async () => {
    const workspace = repository();
    const cli = new FakePodmanCli();
    cli.images.add(NODE_IMAGE);
    const sandboxes = new Sandboxes(new Podman(cli, PLAIN), hostFor(workspace).host, IDLE_STOP_MS);

    (await sandboxes.launch(agentIn(workspace))).gone!();

    expect(cli.images.has(NODE_IMAGE)).toBe(true);
    await sandboxes.stopAll();
  });

  test("whose first process ends at start fails the agent's start at once, with the last it said", async () => {
    const workspace = repository();
    const cli = new FakePodmanCli();
    cli.endsAtStart = "starting relays\nError: listen EADDRINUSE 127.0.0.1:7701";
    const sandboxes = new Sandboxes(new Podman(cli, PLAIN), hostFor(workspace).host, IDLE_STOP_MS);
    const startedAt = Date.now();

    await expect(sandboxes.launch(agentIn(workspace))).rejects.toMatchObject(notReady({ kind: "could-not-start", cause: "Error: listen EADDRINUSE 127.0.0.1:7701" }));

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(cli.callsOf("exec")).toEqual([]);
    await sandboxes.stopAll();
  });

  test("makes sure a stopped sandbox is gone, and says so where Podman still has it", async () => {
    const cli = new FakePodmanCli();
    const podman = new Podman(cli, PLAIN);
    cli.containers.set("mirador-stuck", {});
    cli.staying.add("mirador-stuck");
    await expect(podman.stop("mirador-stuck")).rejects.toThrow("did not stop");
    cli.staying.clear();
    await podman.stop("mirador-stuck");
    expect(cli.containers.size).toBe(0);
  });

  test("removes at start only the sandboxes this host left behind", async () => {
    const cli = new FakePodmanCli();
    cli.containers.set("mirador-ours", { "mirador.host": "abc", "mirador.owner": "room:r" });
    cli.containers.set("mirador-theirs", { "mirador.host": "def" });
    cli.containers.set("plex", {});

    await new Podman(cli, PLAIN).removeLeftovers("abc");

    expect([...cli.containers.keys()].toSorted()).toEqual(["mirador-theirs", "plex"]);
    expect(cli.callsOf("ps")[0]).toEqual(["ps", "--all", "--filter", "label=mirador.host=abc", "--format", "json"]);
  });

  test("runs a command as the agent user, reading its input, as held files are put back", async () => {
    const cli = new FakePodmanCli();
    cli.containers.set("mirador-vm", {});
    const ran = await new Podman(cli, PLAIN).runAsAgent("mirador-vm", "1000:1000", [process.execPath, "-e", "process.stdin.pipe(process.stdout)"], "held", 5_000);
    expect(ran).toEqual({ exitCode: 0, stdout: "held" });
    expect(cli.callsOf("exec")[0]!.slice(0, 7)).toEqual(["exec", "-i", "--user", "0:0", "mirador-vm", "/usr/bin/setpriv", "--reuid=1000"]);
  });

  test("runs nothing where Podman can't run sandboxes, and tells why", async () => {
    const cli = new FakePodmanCli();
    const podman = new Podman(cli, { available: false, why: "podman-not-rootless" });
    await expect(podman.prepare({ harness: "claude", version: "2.1.330" }, () => {})).rejects.toMatchObject(notReady({ kind: "unavailable", why: "podman-not-rootless" }));
    await podman.removeLeftovers("abc");
    expect(cli.calls).toEqual([]);
    expect(Podman.here("off", "/usr/bin").availability()).toEqual({ available: false, why: "turned-off" });
    expect(Podman.here(join(scratch, "no-such-podman"), "/usr/bin").availability()).toEqual({ available: false, why: "no-podman" });
  });

  test.skipIf(!runsShellScripts)("asks Podman only for its info, never for another runtime, and runs a plain container wherever Podman is rootless; Podman's storage is this computer's own", () => {
    const fakePodman = join(scratch, "podman");
    const asked = join(scratch, "podman-asked");
    const says = (rootless: boolean) =>
      writeFileSync(
        fakePodman,
        `#!/bin/sh\necho "$*" >> '${asked}'\necho '{"host":{"security":{"rootless":${rootless}}},"store":{"graphRoot":"/home/someone/.local/share/containers/storage","runRoot":"/run/user/1000/containers"}}'\n`,
      );
    says(true);
    chmodSync(fakePodman, 0o755);
    const podman = Podman.here(fakePodman, "/usr/bin");
    expect(podman.availability()).toMatchObject({ available: true, kind: "podman" });
    expect(podman.storage).toEqual(["/home/someone/.local/share/containers/storage", "/run/user/1000/containers"]);
    expect(computersOwnOnLinux("/home/someone", podman)).toEqual(["/home/someone/.config", "/home/someone/.local", "/home/someone/.local/share/containers/storage", "/run/user/1000/containers"]);
    const enforce = join(scratch, "selinux-enforce");
    writeFileSync(enforce, "1\n");
    expect(Podman.here(fakePodman, "/usr/bin", enforce).availability()).toEqual({ available: true, kind: "podman", selinuxEnforcing: true });
    says(false);
    expect(Podman.here(fakePodman, "/usr/bin").availability()).toEqual({ available: false, why: "podman-not-rootless" });
    expect(readFileSync(asked, "utf8").trim().split("\n")).toEqual(["info --format json", "info --format json", "info --format json"]);
  });
});

test("Podman's lists are read for what the sandboxes need of them, and nothing else", () => {
  const listed = JSON.stringify([
    { Names: ["mirador-ours"], Labels: { "mirador.host": "abc" } },
    { Names: ["mirador-theirs"], Labels: { "mirador.host": "def" } },
    { Names: ["unlabelled"], Labels: null },
  ]);
  expect(containersLabelled(listed, "mirador.host", "abc")).toEqual(["mirador-ours"]);
  expect(containersLabelled("garbage", "mirador.host", "abc")).toEqual([]);
  expect(imageNamesIn(JSON.stringify([{ Names: ["localhost/a:1", "localhost/a:latest"] }, { Names: null }]))).toEqual(["localhost/a:1", "localhost/a:latest"]);
  expect(imageNamesIn("{}")).toEqual([]);
  expect(othersContainersIn(listed, "abc")).toEqual(["mirador-theirs"]);
  expect(othersContainersIn("garbage", "abc")).toEqual([]);
  const bind = (Source: string, Destination: string, RW: boolean) => ({ Type: "bind", Source, Destination, Driver: "", Mode: "", Options: ["nosuid", "nodev", "rbind"], RW, Propagation: "rprivate" });
  const inspected = JSON.stringify([
    { Name: "mirador-theirs", State: { Status: "running" }, Config: { Labels: { "mirador.host": "def" } }, Mounts: [bind("/home/me/docs", "/ro", false), bind("/home/me/project", "/workspace", true)] },
    { Name: "mounts-nothing", Mounts: null },
  ]);
  expect(writableSourcesIn(inspected)).toEqual(["/home/me/project"]);
  expect(writableSourcesIn("[]")).toEqual([]);
  expect(writableSourcesIn("")).toBeNull();
});

test.skipIf(!runsShellScripts)("a room's VM lets the agents' user reach Mirador's sockets, then runs the relays as nobody, with no capability nor any to gain", () => {
  const bin = join(scratch, `bin-${crypto.randomUUID()}`);
  mkdirSync(bin);
  for (const program of ["chmod", "setpriv"]) writeFileSync(join(bin, program), `#!/bin/sh\necho "${program} $*"\n`, { mode: 0o755 });
  const ran = Bun.spawnSync(["sh", join(import.meta.dir, "../host/sandbox/in-vm/room-vm.sh"), "7701=/run/mirador/canvas.sock"], { env: { PATH: `${bin}:/usr/bin:/bin` } });
  expect(ran.stdout.toString().trim().split("\n")).toEqual([
    "chmod 666 /run/mirador/*.sock",
    "setpriv --reuid=65534 --regid=65534 --clear-groups --inh-caps=-all --bounding-set=-all --no-new-privs -- bun /mirador/sandbox/relays.mjs 7701=/run/mirador/canvas.sock",
  ]);
  expect(ran.exitCode).toBe(0);
});

describe("two Miradors on one computer, on rootless Podman", () => {
  test("a container doesn't start where another Mirador's writes, and does once that one has stopped", async () => {
    const cli = new FakePodmanCli();
    const workspace = repository();
    const first = new Sandboxes(new Podman(cli, PLAIN), hostFor(workspace).host, IDLE_STOP_MS);
    const second = new Sandboxes(new Podman(cli, PLAIN), hostFor(workspace).host, IDLE_STOP_MS);
    await first.launch(agentIn(workspace));
    expect(cli.callsOf("inspect")).toEqual([]);

    await expect(second.launch(agentIn(workspace))).rejects.toMatchObject(notReady({ kind: "blocked", blocker: { kind: "workspace-overlaps-other-mirador", folder: workspace } }));
    expect(cli.callsOf("run")).toHaveLength(1);

    await first.stopAll();
    await second.launch(agentIn(workspace));
    expect(cli.callsOf("run")).toHaveLength(2);
    await second.stopAll();
  });

  test("a container doesn't start where Podman can't list the others or look at them, and does once it can, with another's that mounts nothing", async () => {
    const cli = new FakePodmanCli();
    const workspace = repository();
    const sandboxes = new Sandboxes(new Podman(cli, PLAIN), hostFor(workspace).host, IDLE_STOP_MS);
    cli.failing = ([command]) => (command === "ps" ? "Error: database is locked" : null);
    await expect(sandboxes.launch(agentIn(workspace))).rejects.toMatchObject(notReady({ kind: "could-not-start" }));
    expect(cli.callsOf("run")).toEqual([]);

    cli.failing = () => null;
    cli.containers.set("mirador-of-another-host", { "mirador.host": "another-host" });
    cli.failing = ([command]) => (command === "inspect" ? "Error: database is locked" : null);
    await expect(sandboxes.launch(agentIn(workspace))).rejects.toMatchObject(notReady({ kind: "could-not-start" }));
    expect(cli.callsOf("run")).toEqual([]);

    cli.failing = () => null;
    await sandboxes.launch(agentIn(workspace));
    expect(cli.callsOf("run")).toHaveLength(1);
    await sandboxes.stopAll();
  });
});

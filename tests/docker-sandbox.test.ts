import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roomSandbox, SANDBOXED_HARNESSES, type SandboxAvailability, type SandboxNotReadyWhy, type SandboxSetup } from "../shared/sandbox.ts";
import { KEY_PLACEHOLDER } from "../host/sandbox/agent-environment.ts";
import { Docker, ownBaseIn, othersContainersIn, saysNoSuchContainer } from "../host/sandbox/docker.ts";
import { BASE_IMAGE_NAME, BASE_RECIPE } from "../host/sandbox/image.ts";
import { ANTHROPIC_API } from "../host/sandbox/model-proxy.ts";
import { sandboxConfigFolder, Sandboxes, type AgentInSandbox, type SandboxHost } from "../host/sandbox/sandboxes.ts";
import { BUN_IN_VM, GUARD_IN_VM } from "../host/sandbox/tools-folder.ts";
import { imageOfRun, isBaseCheck } from "./fake-container-cli.ts";
import { FakeDockerCli } from "./fake-docker-cli.ts";
import { DEBIAN_IMAGE } from "./fake-podman-cli.ts";
import { guardedIn, mountsOfRun } from "./guard-told.ts";
import { RUNS_SANDBOXES } from "./sandbox-computer.ts";

const scratch = mkdtempSync(join(tmpdir(), "docker-sandbox-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const KEY = "sk-ant-the-profiles-own-key-5678";
const ROOTLESS: SandboxAvailability = { available: true, kind: "docker", selinuxEnforcing: false };
const IDLE_STOP_MS = 30;
const ROOM = roomSandbox("room-1");

function repository() {
  const folder = join(scratch, `workspace-${crypto.randomUUID()}`);
  mkdirSync(folder);
  Bun.spawnSync(["git", "init", "-q", folder]);
  return realpathSync.native(folder);
}

function hostFor(workspace: string, baseImage: string | null = null) {
  const setups: SandboxSetup[] = [];
  const host: SandboxHost = {
    dataDir: join(scratch, `data-${crypto.randomUUID()}`),
    workspaceOf: () => workspace,
    canvasOf: () => ({ belongs: () => true, tokenOf: () => "token", handle: () => new Response("canvas") }),
    atWork: () => ({ agents: ["builder"], conversationIds: [] }),
    setupChanged: (_, setup) => setups.push(setup),
    baseImageOf: () => baseImage,
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
  owner: ROOM,
  allowsSharedKernel: true,
  profileId: "builder",
  kind: { harness: "claude", keyVariable: "ANTHROPIC_API_KEY" },
  version: "2.1.330",
  workingDirectory: workspace,
  given: { ANTHROPIC_API_KEY: KEY, DEPLOY_TARGET: "staging" },
  route: { upstream: ANTHROPIC_API, api: "anthropic-messages", key: KEY, keyHeader: "x-api-key", headers: [] },
  agent: ["/usr/local/bin/bun", "/checkout/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"],
  ...changes,
});

const notReady = (why: Partial<SandboxNotReadyWhy>) => ({ problem: { code: "sandbox-not-ready", why } });

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
const valuesAfter = (args: string[], flag: string) => args.flatMap((arg, index) => (args[index - 1] === flag ? [arg] : []));
const nameOf = (run: string[]) => valueAfter(run, "--name")!;
const unprotected = (folder: string) => ({ folder, parts: { files: [], folders: [], onTheWay: [], gitFolders: [] } });

describe("a room's sandbox on rootless Docker", () => {
  test.skipIf(!RUNS_SANDBOXES)("starts as the container's root, who is this computer's user, and guards the workspace and the agents' own folders as that user, showing their files to the agents as theirs; the agents have no capability nor any to gain, no network, none of Docker's proxies, limits and a capped log; the key is nowhere in it", async () => {
    const workspace = repository();
    const { host, setups } = hostFor(workspace);
    const cli = new FakeDockerCli();
    const sandboxes = new Sandboxes(new Docker(cli, ROOTLESS), host, IDLE_STOP_MS);

    const launched = await sandboxes.launch(agentIn(workspace));

    const [run] = cli.callsOf("run");
    expect(run).toEqual(expect.arrayContaining(["--detach", "--rm", "--init"]));
    expect(run).not.toContain("--userns");
    expect(valueAfter(run!, "--user")).toBe("0:0");
    expect(valueAfter(run!, "--cap-drop")).toBe("all");
    expect(valuesAfter(run!, "--cap-add")).toEqual(["SYS_ADMIN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID", "SETPCAP"]);
    expect(valuesAfter(run!, "--device")).toEqual(["/dev/fuse"]);
    expect(valuesAfter(run!, "--security-opt")).toEqual(["no-new-privileges", "label=disable"]);
    expect(valueAfter(run!, "--network")).toBe("none");
    expect(valuesAfter(run!, "--env")).toEqual(["HTTP_PROXY=", "http_proxy=", "HTTPS_PROXY=", "https_proxy=", "FTP_PROXY=", "ftp_proxy=", "NO_PROXY=", "no_proxy=", "ALL_PROXY=", "all_proxy="]);
    expect([valueAfter(run!, "--memory"), valueAfter(run!, "--memory-swap"), valueAfter(run!, "--cpus"), valueAfter(run!, "--pids-limit")]).toEqual(["3G", "3G", "4", "4096"]);
    expect([valueAfter(run!, "--log-driver"), valueAfter(run!, "--log-opt")]).toEqual(["json-file", "max-size=1mb"]);
    expect(valuesAfter(run!, "--label")).toContain("mirador.owner=room:room-1");

    const mounts = mountsOfRun(run!);
    const configFolders = SANDBOXED_HARNESSES.map((harness) => sandboxConfigFolder(host.dataDir, ROOM, harness));
    expect(mounts.filter(({ source }) => source === workspace || configFolders.includes(source)).map(({ target, readOnly }) => [target, readOnly])).toEqual([
      ["/mirador/raw/0", false],
      ["/mirador/raw/1", false],
      ["/mirador/raw/2", false],
    ]);
    expect(guardedIn(mounts)).toEqual([{ folder: workspace, parts: { files: [], folders: [], onTheWay: [], gitFolders: [".git"] } }, ...configFolders.map(unprotected)]);
    expect(run!.slice(run!.indexOf("--entrypoint"))).toEqual([
      "--entrypoint",
      GUARD_IN_VM,
      expect.stringMatching(new RegExp(`^${BASE_IMAGE_NAME}:[0-9a-f]{10}$`)),
      "/mirador/guard/folders",
      "1000:1000",
      "0:0",
      "/run/mirador",
      "--",
      BUN_IN_VM,
      "/mirador/sandbox/relays.mjs",
      "7701=/run/mirador/canvas.sock",
      "7702=/run/mirador/model.sock",
      "7703=/run/mirador/network.sock",
    ]);

    const [program, ...exec] = launched.command;
    expect(program).toBe(cli.program);
    expect(exec.slice(0, 6)).toEqual(["exec", "-i", "--user", "0:0", "-w", workspace]);
    expect(exec.slice(-6)).toEqual([GUARD_IN_VM, "as", "1000:1000", "--", ...agentIn(workspace).agent]);
    expect(exec).toContain("DEPLOY_TARGET");
    expect(exec.join(" ")).not.toContain("staging");
    expect(launched.environment).toMatchObject({ ANTHROPIC_API_KEY: KEY_PLACEHOLDER, DEPLOY_TARGET: "staging" });
    expect(JSON.stringify([cli.calls, launched.command, launched.environment])).not.toContain(KEY);

    expect(cli.callsOf("build")[0]!.slice(0, 5)).toEqual(["build", "-f", BASE_RECIPE, "-t", run![run!.indexOf("--entrypoint") + 2]!]);
    expect(setups.flatMap(({ step }) => (step ? [`${step.at}/${step.of}`] : []))).toEqual(["1/8", "2/8", "3/8", "4/8", "5/8", "6/8", "7/8", "8/8"]);

    launched.gone!();
    await Bun.sleep(IDLE_STOP_MS * 4);
    expect(cli.containers.size).toBe(0);
    expect(cli.callsOf("rm").at(-1)).toEqual(["rm", "--force", nameOf(run!)]);
    expect(cli.callsOf("container").at(-1)).toEqual(["container", "inspect", nameOf(run!)]);
    await sandboxes.stopAll();
  });

  test("never lets a value the room gives its agent steer Docker on this computer: Docker's own variables reach the container on the command line, and Docker sees only this computer's", async () => {
    const workspace = repository();
    const cli = new FakeDockerCli();
    const sandboxes = new Sandboxes(new Docker(cli, ROOTLESS), hostFor(workspace).host, IDLE_STOP_MS);
    const steering = { DOCKER_HOST: "ssh://elsewhere.example", DOCKER_CONTEXT: "elsewhere", DOCKER_CONFIG: "/tmp/given/docker", BUILDKIT_PROGRESS: "plain", XDG_CONFIG_HOME: "/tmp/given/config" };
    const unsetHere = Object.keys(steering).filter((name) => process.env[name] === undefined);

    const launched = await sandboxes.launch(agentIn(workspace, { given: { ...agentIn(workspace).given, ...steering } }));

    const exec = launched.command.slice(1);
    Object.entries(steering).forEach(([name, value]) => expect(exec).toContain(`${name}=${value}`));
    unsetHere.forEach((name) => expect(launched.environment[name]).toBeUndefined());
    launched.gone!();
    await sandboxes.stopAll();
  });

  test("builds the base image once, removes the image it builds on where the build pulled it and the bases of other recipes, and leaves every other image", async () => {
    const workspace = repository();
    const cli = new FakeDockerCli();
    cli.images.add(`${BASE_IMAGE_NAME}:0123456789`);
    const sandboxes = new Sandboxes(new Docker(cli, ROOTLESS), hostFor(workspace).host, IDLE_STOP_MS);

    (await sandboxes.launch(agentIn(workspace))).gone!();
    await sandboxes.stop(ROOM);
    (await sandboxes.launch(agentIn(workspace))).gone!();

    expect(cli.callsOf("build")).toHaveLength(1);
    expect([...cli.images].filter((name) => !name.startsWith(`${BASE_IMAGE_NAME}:`))).toEqual(["docker.io/library/postgres:16", "docker.io/library/node:22-bookworm-slim", "docker.io/library/alpine:3.22"]);
    expect(cli.callsOf("image").filter(([, sub]) => sub === "rm")).toEqual([
      ["image", "rm", DEBIAN_IMAGE],
      ["image", "rm", `${BASE_IMAGE_NAME}:0123456789`],
    ]);
    await sandboxes.stopAll();
  });

  test.skipIf(!RUNS_SANDBOXES)("runs on the owner's own base image by its ID, pulled and checked as nobody with no network, and builds none", async () => {
    const workspace = repository();
    const { host } = hostFor(workspace, "ghcr.io/team/dev:1");
    const cli = new FakeDockerCli();
    const id = `sha256:${"c".repeat(64)}`;
    cli.registry.set("ghcr.io/team/dev:1", id);
    const sandboxes = new Sandboxes(new Docker(cli, ROOTLESS), host, IDLE_STOP_MS);

    (await sandboxes.launch(agentIn(workspace))).gone!();

    expect(cli.callsOf("pull")).toEqual([["pull", "--quiet", "ghcr.io/team/dev:1"]]);
    expect(cli.callsOf("build")).toEqual([]);
    const [run] = cli.callsOf("run");
    expect(run![run!.indexOf("--entrypoint") + 2]).toBe(id);
    const [check] = cli.ranOnce.filter(isBaseCheck);
    expect([imageOfRun(check!), valueAfter(check!, "--user"), valueAfter(check!, "--network")]).toEqual([id, "65534:65534", "none"]);
    await sandboxes.stopAll();
  });

  test("makes sure a stopped sandbox is gone, and says so where Docker still has it or doesn't answer", async () => {
    const cli = new FakeDockerCli();
    const docker = new Docker(cli, ROOTLESS);
    cli.containers.set("mirador-stuck", {});
    cli.staying.add("mirador-stuck");
    await expect(docker.stop("mirador-stuck")).rejects.toThrow("did not stop");
    cli.staying.clear();
    cli.failing = ([command]) => (command === "container" ? "Cannot connect to the Docker daemon at unix:///run/user/1000/docker.sock" : null);
    await expect(docker.stop("mirador-stuck")).rejects.toThrow("Cannot connect to the Docker daemon");
    cli.failing = () => null;
    await docker.stop("mirador-stuck");
    expect(cli.containers.size).toBe(0);
  });

  test("removes at start only the sandboxes this host left behind, and tells the folders other Miradors' sandboxes write", async () => {
    const cli = new FakeDockerCli();
    cli.containers.set("mirador-ours", { "mirador.host": "abc", "mirador.owner": "room:r" });
    cli.containers.set("plex", {});
    await cli.run(["run", "--detach", "--name", "mirador-theirs", "--label", "mirador.host=def", "-v", "/home/me/project:/mirador/raw/0", "-v", "/home/me/docs:/mirador/raw/1:ro", "some-image"]);
    const docker = new Docker(cli, ROOTLESS);

    expect(await docker.writtenByOtherMiradors("abc")).toEqual(["/home/me/project"]);
    await docker.removeLeftovers("abc");

    expect([...cli.containers.keys()].toSorted()).toEqual(["mirador-theirs", "plex"]);
    expect(cli.callsOf("ps")).toEqual([
      ["ps", "--all", "--filter", "label=mirador.host", "--format", '{{.Names}}\t{{.Label "mirador.host"}}'],
      ["ps", "--all", "--filter", "label=mirador.host=abc", "--format", "{{.Names}}"],
    ]);
  });

  test("runs a command as the agent user, reading its input, as held files are put back", async () => {
    const cli = new FakeDockerCli();
    cli.containers.set("mirador-vm", {});
    const ran = await new Docker(cli, ROOTLESS).runAsAgent("mirador-vm", "1000:1000", [process.execPath, "-e", "process.stdin.pipe(process.stdout)"], "held", 5_000);
    expect(ran).toEqual({ exitCode: 0, stdout: "held" });
    expect(cli.callsOf("exec")[0]!.slice(0, 9)).toEqual(["exec", "-i", "--user", "0:0", "mirador-vm", GUARD_IN_VM, "as", "1000:1000", "--"]);
  });

  test("runs nothing where Docker can't run sandboxes, and tells why", async () => {
    const cli = new FakeDockerCli();
    const docker = new Docker(cli, { available: false, why: "docker-not-rootless" });
    await expect(docker.prepare()).rejects.toMatchObject(notReady({ kind: "unavailable", why: "docker-not-rootless" }));
    await docker.removeLeftovers("abc");
    expect(cli.calls).toEqual([]);
  });
});

test("Docker's lists and inspections are read for what the sandboxes need of them, and nothing else", () => {
  const id = `sha256:${"a".repeat(64)}`;
  expect(ownBaseIn(JSON.stringify([{ Id: id, RepoTags: ["ghcr.io/team/dev:1"] }]))).toEqual({ image: id, content: id });
  expect(ownBaseIn(JSON.stringify([{ Id: "a".repeat(64) }]))).toBeNull();
  expect(ownBaseIn("[]")).toBeNull();
  expect(ownBaseIn("garbage")).toBeNull();
  expect(othersContainersIn("mirador-ours\tabc\nmirador-theirs\tdef\nunlabelled\t<no value>\n", "abc")).toEqual(["mirador-theirs"]);
  expect(othersContainersIn("", "abc")).toEqual([]);
  expect(saysNoSuchContainer("Error response from daemon: No such container: mirador-x")).toBe(true);
  expect(saysNoSuchContainer("Cannot connect to the Docker daemon at unix:///run/user/1000/docker.sock")).toBe(false);
});

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environmentInVm, KEY_PLACEHOLDER, vmEnvironment } from "../host/sandbox/agent-environment.ts";
import { CONTAINER_READS, execArguments, ownBaseIn, pullArguments, pullProgressIn, vmIdsLabelled, writtenByOthersIn } from "../host/sandbox/apple-container.ts";
import { agentCheck, agentVerdictIn, baseCheck, verdictIn } from "../host/sandbox/base-check.ts";
import { appleContainerAvailability, appleContainerRuntime, podmanAvailability, podmanStorageIn, selinuxEnforcingAt } from "../host/sandbox/availability.ts";
import { execProcessEnvironment } from "../host/sandbox/exec-environment.ts";
import { versionSaidIn } from "../host/sandbox/agent-version.ts";
import { BASE_RECIPE, baseImageOf, BaseNotPulled, buildStepIn, defaultBaseTag, imageReferencesIn, pulledOrHere } from "../host/sandbox/image.ts";
import { GUARD_IN_VM } from "../host/sandbox/tools-folder.ts";
import { ownBaseIn as podmansOwnBaseIn, PODMAN_READS } from "../host/sandbox/podman.ts";
import { guardPlanOf, sandboxRefusalOf, type MiradorPlaces, type ProtectedParts } from "../host/sandbox/guarded-workspace.ts";
import { fullImageName, imageSandboxRunsOn, isImageName, keepingNetworkOf, modelKeyVariableOf, narrowsSandbox, NO_SANDBOX, reachesMoreThan, SANDBOX_NETWORKS, sandboxSettingIn, sameSandbox, sharesKernel, signInElsewhere, type SandboxNetwork, type SandboxSetting } from "../shared/sandbox.ts";
import { RUNS_SANDBOXES } from "./sandbox-computer.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-parts-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ELSEWHERE: MiradorPlaces = { home: "/nonexistent-home", dataDir: "/nonexistent-data", checkout: "/nonexistent-checkout", computersOwn: [] };

function repositoryIn(name: string) {
  const workspace = join(scratch, `${name}-${crypto.randomUUID()}`);
  mkdirSync(workspace, { recursive: true });
  Bun.spawnSync(["git", "init", "-q", workspace]);
  return workspace;
}

async function partsOf(workspace: string, held: string[] = []): Promise<ProtectedParts> {
  const found = await guardPlanOf(workspace, ELSEWHERE, held);
  if ("refused" in found) throw new Error(`refused: ${found.refused.kind}`);
  return found.parts;
}

const NOTHING_OF_ITS_OWN: ProtectedParts = { files: [], folders: [], onTheWay: [], gitFolders: [".git"] };

const MAC_26 = { platform: "darwin" as const, arch: "arm64", darwinMajor: 25 };


test("sandboxes run on macOS 26 on Apple silicon with Apple's container, and each other computer is told why not", () => {
  expect(appleContainerAvailability(MAC_26, "/usr/local/bin/container")).toEqual({ available: true, kind: "apple-container" });
  expect(appleContainerAvailability({ ...MAC_26, platform: "win32" }, "/usr/bin/container")).toEqual({ available: false, why: "unsupported-system" });
  expect(appleContainerAvailability({ ...MAC_26, arch: "x64" }, "/usr/local/bin/container")).toEqual({ available: false, why: "not-apple-silicon" });
  expect(appleContainerAvailability({ ...MAC_26, darwinMajor: 24 }, "/usr/local/bin/container")).toEqual({ available: false, why: "macos-too-old" });
  expect(appleContainerAvailability(MAC_26, null)).toEqual({ available: false, why: "no-container-tool" });
  expect(appleContainerRuntime("off", "/usr/bin", MAC_26)).toEqual({ program: null, availability: { available: false, why: "turned-off" } });
  expect(appleContainerRuntime(join(scratch, "no-such-container"), "/usr/bin", MAC_26).availability).toEqual({ available: false, why: "no-container-tool" });
});

test("on Linux, rootless Podman runs sandboxes in plain containers, which share this computer's kernel, and rootful or failing Podman runs none", () => {
  const info = (rootless: unknown) => JSON.stringify({ host: { os: "linux", security: { rootless } } });
  expect(podmanAvailability({ info: info(true), selinuxEnforcing: false })).toEqual({ available: true, kind: "podman", selinuxEnforcing: false });
  expect(podmanAvailability({ info: info(false), selinuxEnforcing: false })).toEqual({ available: false, why: "podman-not-rootless" });
  expect(podmanAvailability({ info: null, selinuxEnforcing: false })).toEqual({ available: false, why: "podman-fails" });
  expect(podmanAvailability({ info: "Error: not json", selinuxEnforcing: false })).toEqual({ available: false, why: "podman-fails" });
  expect(podmanAvailability({ info: info("yes"), selinuxEnforcing: false })).toEqual({ available: false, why: "podman-fails" });
  expect(sharesKernel("podman")).toBe(true);
  expect(sharesKernel("apple-container")).toBe(false);
});

test("a Podman sandbox says it runs outside SELinux's confinement where the kernel says SELinux enforces its rules, and only there", () => {
  const info = JSON.stringify({ host: { security: { rootless: true } } });
  const enforce = join(scratch, `enforce-${crypto.randomUUID()}`);
  expect(selinuxEnforcingAt(enforce)).toBe(false);
  writeFileSync(enforce, "0");
  expect(selinuxEnforcingAt(enforce)).toBe(false);
  writeFileSync(enforce, "1\n");
  expect(selinuxEnforcingAt(enforce)).toBe(true);
  expect(podmanAvailability({ info, selinuxEnforcing: true })).toEqual({ available: true, kind: "podman", selinuxEnforcing: true });
});

test("Podman's storage is read from its info, and none from info that names none", () => {
  expect(podmanStorageIn(JSON.stringify({ store: { graphRoot: "/home/me/.local/share/containers/storage", runRoot: "/run/user/1000/containers" } }))).toEqual([
    "/home/me/.local/share/containers/storage",
    "/run/user/1000/containers",
  ]);
  expect(podmanStorageIn(JSON.stringify({ host: { security: { rootless: true } } }))).toEqual([]);
  expect(podmanStorageIn("Error: not json")).toEqual([]);
});

test("a room's sandbox setting reads as off unless it is on, allows a shared kernel only while on, and narrows when it is turned on, stops working freely or no longer allows a shared kernel", () => {
  const sandbox = (on: boolean, workFreely: boolean, allowsSharedKernel = false): SandboxSetting => ({ ...NO_SANDBOX, on, workFreely, allowsSharedKernel });
  expect(sandboxSettingIn({ on: "yes", workFreely: 0 })).toEqual(sandbox(false, true));
  expect(sandboxSettingIn({ on: true, workFreely: false })).toEqual(sandbox(true, false));
  expect(sandboxSettingIn({ on: true, workFreely: true, allowsSharedKernel: true })).toEqual(sandbox(true, true, true));
  expect(sandboxSettingIn({ on: false, workFreely: true, allowsSharedKernel: true })).toEqual(sandbox(false, true));
  expect(narrowsSandbox(sandbox(false, true), sandbox(true, true))).toBe(true);
  expect(narrowsSandbox(sandbox(true, true), sandbox(true, false))).toBe(true);
  expect(narrowsSandbox(sandbox(true, false), sandbox(true, true))).toBe(false);
  expect(narrowsSandbox(sandbox(true, true), sandbox(false, true))).toBe(false);
  expect(narrowsSandbox(sandbox(true, true, true), sandbox(true, true))).toBe(true);
  expect(narrowsSandbox(sandbox(true, true), sandbox(true, true, true))).toBe(false);
  expect(sameSandbox(sandbox(true, true), sandbox(true, true, true))).toBe(false);
});

test("a sandbox's base image is kept only where it names an image, whether the sandbox is on or not, and changing it is another sandbox that narrows nothing", () => {
  const digest = `sha256:${"0123456789abcdef".repeat(4)}`;
  const names = ["debian", "debian:bookworm-slim", "team/dev", "ghcr.io/team/dev:1.2", "localhost:5000/dev", "registry.example.com:443/a/b/c_d.e-f:v1_2.3", `team/dev@${digest}`, `ghcr.io/team/dev:1@${digest}`];
  names.forEach((name) => expect([name, sandboxSettingIn({ on: true, baseImage: name }).baseImage]).toEqual([name, name]));
  expect(sandboxSettingIn({ on: false, baseImage: "team/dev" }).baseImage).toBe("team/dev");
  const notNames = ["", " debian", "debian ", "Debian", "-debian", "--entrypoint=/bin/sh", "team//dev", "team/dev:", "team/dev:-x", "team/dev@sha256:abc", `team/dev@sha512:${"0".repeat(64)}`, "a b", "team/dev;rm -rf /", "https://ghcr.io/team/dev", `${"a".repeat(250)}/dev:1`, 7, null, ["debian"]];
  notNames.forEach((name) => expect([name, sandboxSettingIn({ on: true, baseImage: name }).baseImage]).toEqual([name, null]));
  expect(notNames.some(isImageName)).toBe(false);
  const on: SandboxSetting = { ...NO_SANDBOX, on: true };
  expect(sameSandbox(on, { ...on, baseImage: "team/dev" })).toBe(false);
  expect(narrowsSandbox(on, { ...on, baseImage: "team/dev" })).toBe(false);
});

test("an image's name is written out as Docker reads it, alike for every runtime", () => {
  expect(fullImageName("debian")).toBe("docker.io/library/debian:latest");
  expect(fullImageName("debian:bookworm-slim")).toBe("docker.io/library/debian:bookworm-slim");
  expect(fullImageName("team/dev")).toBe("docker.io/team/dev:latest");
  expect(fullImageName("docker.io/debian")).toBe("docker.io/library/debian:latest");
  expect(fullImageName("ghcr.io/team/dev")).toBe("ghcr.io/team/dev:latest");
  expect(fullImageName("localhost/dev:1")).toBe("localhost/dev:1");
  expect(fullImageName("localhost:5000/dev")).toBe("localhost:5000/dev:latest");
  expect(fullImageName(`team/dev@sha256:${"0".repeat(64)}`)).toBe(`docker.io/team/dev@sha256:${"0".repeat(64)}`);
});

test("a check of a base image runs it as nobody with no network, and is a finding only where it ran to its end", () => {
  const run = baseCheck("ghcr.io/team/dev:1", "/data/sandbox-tools");
  expect(run).toMatchObject({ image: "ghcr.io/team/dev:1", entrypoint: "/bin/sh", user: "65534:65534", network: false, mounts: [{ source: "/data/sandbox-tools", target: "/opt/mirador", readOnly: true }] });
  expect(run.args.join("\n")).toContain("[ -x /bin/bash ] || echo lacks bash");
  expect(verdictIn("mirador-base-check\nPATH=/usr/local/bin:/usr/bin\n")).toEqual({ path: "/usr/local/bin:/usr/bin" });
  expect(verdictIn("mirador-base-check\nPATH=\n")).toEqual({ path: null });
  expect(verdictIn("mirador-base-check\nlacks git\nlacks glibc\nPATH=/usr/bin")).toEqual({ lacks: ["git", "glibc"] });
  expect(verdictIn("lacks git\nmirador-base-check\nlacks sudo\nPATH=/usr/bin")).toEqual({ path: "/usr/bin" });
  expect(verdictIn("mirador-base-check\nlacks bash\n")).toBeNull();
  expect(verdictIn("Error: failed to find target executable /bin/sh")).toBeNull();
  expect(verdictIn("")).toBeNull();
});

test("an owner's base image is pulled afresh unless it names its digest and is here, and else the one here is run where the pull fails", async () => {
  const here = { image: "team/dev", content: "sha256:1" };
  const pulls: string[] = [];
  const pull = (exitCode: number, output = "") => async () => {
    pulls.push("pulled");
    return { exitCode, output };
  };
  expect(await pulledOrHere("team/dev:latest", pull(0), async () => here)).toBe(here);
  expect(await pulledOrHere("team/dev:latest", pull(1, "Error: offline"), async () => here)).toBe(here);
  expect(pulls).toHaveLength(2);
  expect(await pulledOrHere(`team/dev@sha256:${"0".repeat(64)}`, pull(0), async () => here)).toBe(here);
  expect(pulls).toHaveLength(2);
  await expect(pulledOrHere("team/dev:latest", pull(1, "progress\nError: 404 Not Found\n"), async () => null)).rejects.toEqual(new BaseNotPulled("Error: 404 Not Found"));
  await expect(pulledOrHere("team/dev:latest", pull(7), async () => null)).rejects.toEqual(new BaseNotPulled("exit 7"));
});

test.skipIf(process.platform === "win32")("a check of an agent kind's own program says it runs, or what it said last as it failed, and is a finding only where it got that far", () => {
  expect(agentCheck("ghcr.io/team/dev:1", "/data/sandbox-tools", "/opt/mirador/claude-2.1.330/bin/claude")).toMatchObject({
    image: "ghcr.io/team/dev:1",
    entrypoint: "/bin/sh",
    user: "65534:65534",
    network: false,
    mounts: [{ source: "/data/sandbox-tools", target: "/opt/mirador", readOnly: true }],
  });
  const ranHere = (program: string) => Bun.spawnSync(["/bin/sh", "-c", agentCheck("image", "/tools", program).args[1]!]).stdout.toString();
  const failsSaying = (said: string) => {
    const program = join(scratch, said ? "fails-saying-why" : "fails-silently");
    writeFileSync(program, `#!/bin/sh\n${said ? `echo '${said}'\n` : ""}exit 3\n`, { mode: 0o755 });
    return program;
  };
  expect(agentVerdictIn(ranHere("/usr/bin/true"))).toEqual({ runs: true });
  expect(agentVerdictIn(ranHere(failsSaying("")))).toEqual({ fails: "exit 3" });
  expect(agentVerdictIn(ranHere(failsSaying("Error: missing libstdc++")))).toEqual({ fails: "Error: missing libstdc++" });
  expect(agentVerdictIn(ranHere("/nonexistent/claude"))).toEqual({ fails: expect.stringContaining("/nonexistent/claude") });
  expect(agentVerdictIn("mirador-agent-check\n")).toBeNull();
  expect(agentVerdictIn("Error: failed to find target executable /bin/sh")).toBeNull();
});

test("a pull in Apple's container says how far its fetching got, then its unpacking, as it says it", () => {
  expect(pullProgressIn("[1/2] Fetching image [0s]")).toEqual({ stage: "pulling-image" });
  expect(pullProgressIn("[1/2] Fetching image 45% (3 of 7 blobs, 18,4 MB/41,3 MB, 9,1 MB/s) [12s]")).toEqual({ stage: "pulling-image", percent: 45 });
  expect(pullProgressIn("[2/2] Unpacking image for platform linux/arm64/v8 [13s]")).toEqual({ stage: "pulling-image", unpacking: true });
  expect(pullProgressIn("[2/2] Unpacking image for platform linux/arm64/v8 100% (5 706 entries, 136,9 MB) [14s]")).toEqual({ stage: "pulling-image", percent: 100, unpacking: true });
  expect(pullProgressIn("Error: HTTP request to https://registry-1.docker.io/v2/team/dev/manifests/1 failed with response: 401 Unauthorized")).toBeNull();
  expect(pullArguments("docker.io/team/dev:1")).toEqual(["image", "pull", "--progress", "plain", "--platform", "linux/arm64", "docker.io/team/dev:1"]);
});

test("the owner's base image runs by its name in Apple's container, as pulled for this Mac, and by its ID in Podman", () => {
  expect(pullArguments("docker.io/team/dev:latest")).toEqual(["image", "pull", "--progress", "plain", "--platform", "linux/arm64", "docker.io/team/dev:latest"]);
  const digest = `sha256:${"a".repeat(64)}`;
  expect(ownBaseIn(JSON.stringify([{ name: "docker.io/team/dev:latest", index: { digest } }]), "docker.io/team/dev:latest")).toEqual({ image: "docker.io/team/dev:latest", content: digest });
  expect(ownBaseIn("[]", "docker.io/team/dev:latest")).toBeNull();
  expect(ownBaseIn("not json", "docker.io/team/dev:latest")).toBeNull();
  const id = "b".repeat(64);
  expect(podmansOwnBaseIn(JSON.stringify([{ Id: id, Digest: digest }]))).toEqual({ image: id, content: id });
  expect(podmansOwnBaseIn(JSON.stringify([{ Id: "--privileged" }]))).toBeNull();
  expect(podmansOwnBaseIn("[]")).toBeNull();
});

test("a sandbox's network reads as closed unless it is on and reaches one known, and stays as it is however else the sandbox is set, until it is turned off", () => {
  const on = (network: SandboxNetwork): SandboxSetting => ({ ...NO_SANDBOX, on: true, network });
  SANDBOX_NETWORKS.forEach((network) => expect(sandboxSettingIn({ on: true, network }).network).toBe(network));
  ["", "all", "Internet", "constructor", 1, null, undefined, ["internet"], { internet: true }].forEach((network) => expect(sandboxSettingIn({ on: true, network }).network).toBe("closed"));
  expect(sandboxSettingIn({ on: false, network: "everything" }).network).toBe("closed");
  expect(keepingNetworkOf(on("internet"), { ...on("everything"), workFreely: false })).toEqual({ ...on("internet"), workFreely: false });
  expect(keepingNetworkOf(on("everything"), NO_SANDBOX).network).toBe("closed");
  expect(keepingNetworkOf({ ...NO_SANDBOX, network: "everything" }, on("internet")).network).toBe("closed");
  expect(sameSandbox(on("closed"), on("internet"))).toBe(false);
  expect(narrowsSandbox(on("everything"), on("closed"))).toBe(false);
  expect(SANDBOX_NETWORKS.map((network) => SANDBOX_NETWORKS.filter((other) => reachesMoreThan(network, other)))).toEqual([[], ["closed"], ["closed", "internet"]]);
});

test("an agent that signs in with a key or setup token works in a sandbox; one on a plain subscription, Bedrock, Vertex or Foundry does not", () => {
  expect(signInElsewhere({ ANTHROPIC_API_KEY: "k" })).toBeNull();
  expect(signInElsewhere({ ANTHROPIC_AUTH_TOKEN: "t" })).toBeNull();
  expect(signInElsewhere({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-token" })).toBeNull();
  expect(signInElsewhere({})).toBe("subscription");
  expect(signInElsewhere({ CLAUDE_CODE_OAUTH_TOKEN: "   " })).toBe("subscription");
  expect(signInElsewhere({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_BEDROCK: "1" })).toBe("bedrock");
  expect(signInElsewhere({ CLAUDE_CODE_OAUTH_TOKEN: "t", CLAUDE_CODE_USE_BEDROCK: "1" })).toBe("bedrock");
  expect(signInElsewhere({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_VERTEX: "true" })).toBe("vertex");
  expect(signInElsewhere({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_FOUNDRY: "on" })).toBe("foundry");
  expect(modelKeyVariableOf({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "a", CLAUDE_CODE_OAUTH_TOKEN: "o" })).toBe("ANTHROPIC_API_KEY");
  expect(modelKeyVariableOf({ ANTHROPIC_AUTH_TOKEN: "a", CLAUDE_CODE_OAUTH_TOKEN: "o" })).toBe("ANTHROPIC_AUTH_TOKEN");
  expect(modelKeyVariableOf({ CLAUDE_CODE_OAUTH_TOKEN: "o" })).toBe("CLAUDE_CODE_OAUTH_TOKEN");
  expect(modelKeyVariableOf({})).toBeNull();
});

test("the base image is told apart by its recipe, which builds on Debian, and its build says which step it is on; an agent's version is read from what its program says", async () => {
  expect(versionSaidIn("2.1.330 (Claude Code)")).toBe("2.1.330");
  expect(versionSaidIn("2.2.0-beta.1 (Claude Code)")).toBe("2.2.0-beta.1");
  expect(versionSaidIn("1.6.0")).toBe("1.6.0");
  expect(versionSaidIn("command not found")).toBeNull();
  expect(versionSaidIn(null)).toBeNull();
  expect(await defaultBaseTag()).toMatch(/^mirador-sandbox-base:[0-9a-f]{10}$/);
  expect(buildStepIn("#7 [stage-1 3/6] RUN npm install -g @anthropic-ai/claude-code@2.1.330")).toEqual({ at: 3, of: 6 });
  expect(buildStepIn("#5 [2/4] RUN apt-get update")).toEqual({ at: 2, of: 4 });
  expect(buildStepIn("#7 DONE 12.3s")).toBeNull();
  expect(buildStepIn("STEP 5/8: RUN npm install -g bun@1.4.4 @anthropic-ai/claude-code@2.1.330")).toEqual({ at: 5, of: 8 });
  expect(buildStepIn("Step 3/8 : RUN apt-get update")).toEqual({ at: 3, of: 8 });
  expect(buildStepIn(" ---> Running in 0123456789ab")).toBeNull();
  expect(buildStepIn("[1/2] STEP 2/5: RUN apt-get update")).toEqual({ at: 2, of: 5 });
  expect(buildStepIn("--> 3f2a1b")).toBeNull();
  expect(baseImageOf(await Bun.file(BASE_RECIPE).text())).toBe("docker.io/library/debian:bookworm-slim");
  const listed = `[{"descriptor":{"digest":"sha256:abc"},"fullSize":"79,9 MB","reference":"docker.io/library/node:22"},{"descriptor":{"annotations":{"io.containerd.image.name":"docker.io/library/mirador-sandbox-base:0123456789"}},"reference":"mirador-sandbox-base:0123456789"}]`;
  expect(imageReferencesIn(listed)).toEqual(new Set(["docker.io/library/node:22", "mirador-sandbox-base:0123456789"]));
  expect(imageReferencesIn("not json")).toEqual(new Set());
});

test("the VMs left behind are found by this host's label alone", () => {
  const listed = JSON.stringify([
    { configuration: { id: "ours", labels: { "mirador.host": "abc" } } },
    { configuration: { id: "theirs", labels: { "mirador.host": "def" } } },
    { configuration: { id: "unlabelled" } },
  ]);
  expect(vmIdsLabelled(listed, "mirador.host", "abc")).toEqual(["ours"]);
  expect(vmIdsLabelled("garbage", "mirador.host", "abc")).toEqual([]);
});

test("what other Miradors' VMs write is read from container's list: their mounts read and write, not this host's nor others' read-only ones", () => {
  const mount = (source: string, options: string[]) => ({ destination: "/in-vm", type: { virtiofs: {} }, source, options });
  const listed = JSON.stringify([
    { status: "running", configuration: { id: "ours", labels: { "mirador.host": "abc" }, mounts: [mount("/Users/me/ours/", [])] } },
    { status: "stopped", configuration: { id: "theirs", labels: { "mirador.host": "def", "mirador.owner": "room:x" }, mounts: [mount("/Users/me/project/", []), mount("/Users/me/docs/", ["ro"]), mount("/private/tmp/of-1/network.sock", [])] } },
    { status: "running", configuration: { id: "not-a-miradors", labels: {}, mounts: [mount("/Users/me/elsewhere/", [])] } },
    { configuration: { id: "unlabelled", mounts: "garbage" } },
  ]);
  expect(writtenByOthersIn(listed, "abc")).toEqual(["/Users/me/project", "/private/tmp/of-1/network.sock"]);
  expect(writtenByOthersIn("garbage", "abc")).toEqual([]);
});

test("the agent's environment in the VM keeps the key, this Mac's own places and what has programs load code out, and passes its values by name", () => {
  const given = { ANTHROPIC_AUTH_TOKEN: "token-of-the-profile", ANTHROPIC_API_KEY: "another-key", CLAUDE_CODE_OAUTH_TOKEN: "subscription-token", ANTHROPIC_BASE_URL: "https://gateway.example", CLAUDE_CONFIG_DIR: "/Users/me/.claude", SSH_AUTH_SOCK: "/tmp/ssh", MIRADOR_SCRIPT_TOKEN: "s", HOME: "/Users/me", LD_PRELOAD: "/work/lib.so", LD_LIBRARY_PATH: "/work", GCONV_PATH: "/work", DEPLOY: "staging" };
  const inVm = environmentInVm(given, { kind: { harness: "claude", keyVariable: "ANTHROPIC_AUTH_TOKEN" }, version: "2.1.330", base: { image: "b", path: null } }, { configFolder: "/data/sandbox/r/claude", modelBaseUrl: "http://127.0.0.1:7702/p/p1" }, ["token-of-the-profile"]);
  expect(inVm).toMatchObject({ ANTHROPIC_AUTH_TOKEN: KEY_PLACEHOLDER, ANTHROPIC_BASE_URL: "http://127.0.0.1:7702/p/p1", CLAUDE_CONFIG_DIR: "/data/sandbox/r/claude", HOME: "/tmp/mirador-home", DEPLOY: "staging" });
  expect(inVm.ANTHROPIC_API_KEY).toBeUndefined();
  expect(inVm.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  expect(inVm.SSH_AUTH_SOCK).toBeUndefined();
  expect(inVm.MIRADOR_SCRIPT_TOKEN).toBeUndefined();
  expect(Object.keys(inVm).filter((name) => name.startsWith("LD_") || name === "GCONV_PATH")).toEqual([]);
  const args = execArguments({ vm: "vm-1", user: "1000:1000", workingDirectory: "/work", environment: inVm, command: ["bun", "agent.js"] });
  expect(args.slice(0, 6)).toEqual(["exec", "-i", "--user", "0:0", "-w", "/work"]);
  expect(args.slice(args.indexOf("vm-1"))).toEqual(["vm-1", GUARD_IN_VM, "as", "1000:1000", "--", "bun", "agent.js"]);
  expect(args).toContain("DEPLOY");
  expect(args).toContain("HOME=/tmp/mirador-home");
  expect(args.join(" ")).not.toContain("staging");
  const { PATH, HOME, TMPDIR, USER, LOGNAME, SHELL, ...notReadByContainer } = inVm;
  expect(execProcessEnvironment(inVm, { HOME: "/Users/me", PATH: "/opt/mac/bin", SECRET_OF_THE_MAC: "s" }, CONTAINER_READS)).toEqual({ ...notReadByContainer, HOME: "/Users/me", PATH: "/opt/mac/bin" });
  expect([PATH, HOME, TMPDIR, USER, LOGNAME, SHELL].every((value) => args.join(" ").includes(`=${value}`))).toBe(true);

  const oauthSecret = "sk-ant-oat01-kept-on-mac-1234";
  const oauthInVm = environmentInVm(
    { CLAUDE_CODE_OAUTH_TOKEN: oauthSecret, ANTHROPIC_API_KEY: "another-key", ANTHROPIC_AUTH_TOKEN: "another-token", ECHOED: `prefix ${oauthSecret}`, DEPLOY: "staging" },
    { kind: { harness: "claude", keyVariable: "CLAUDE_CODE_OAUTH_TOKEN" }, version: "2.1.330", base: { image: "b", path: null } },
    { configFolder: "/data/sandbox/r/claude", modelBaseUrl: "http://127.0.0.1:7702/p/p2" },
    [oauthSecret],
  );
  expect(oauthInVm).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: KEY_PLACEHOLDER, ANTHROPIC_BASE_URL: "http://127.0.0.1:7702/p/p2", DEPLOY: "staging" });
  expect(oauthInVm.ANTHROPIC_API_KEY).toBeUndefined();
  expect(oauthInVm.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  expect(oauthInVm.ECHOED).toBeUndefined();
});

test("podman's exec process reads only this computer's own of the variables Podman reads, never the agent's, even where this computer has none", () => {
  const agents = { CONTAINER_HOST: "ssh://elsewhere", CONTAINERS_CONF: "/given/containers.conf", _CONTAINERS_ROOTLESS_UID: "0", STORAGE_OPTS: "given", XDG_RUNTIME_DIR: "/run/user/given", DEPLOY: "staging" };
  const here = { PATH: "/usr/bin", XDG_RUNTIME_DIR: "/run/user/1000", CONTAINERS_STORAGE_CONF: "/home/me/storage.conf", SECRET_HERE: "s" };
  expect(execProcessEnvironment(agents, here, PODMAN_READS)).toEqual({ DEPLOY: "staging", PATH: "/usr/bin", XDG_RUNTIME_DIR: "/run/user/1000", CONTAINERS_STORAGE_CONF: "/home/me/storage.conf" });
});

test.skipIf(!RUNS_SANDBOXES)("of a workspace the guard protects its repository's and its submodules' git folders, and a hooks folder its config names there, there or not, and nothing is made in it", async () => {
  const workspace = repositoryIn("workspace");
  Bun.spawnSync(["git", "-C", workspace, "config", "core.hooksPath", ".husky/_"]);
  Bun.spawnSync(["git", "init", "-q", "--bare", join(workspace, ".git/modules/lib")]);
  Bun.spawnSync(["git", "init", "-q", "--bare", join(workspace, ".git/modules/lib/modules/deep/er")]);

  expect(await partsOf(workspace)).toEqual({ ...NOTHING_OF_ITS_OWN, folders: [".husky/_"], gitFolders: [".git", ".git/modules/lib", ".git/modules/lib/modules/deep/er"] });
  expect(readdirSync(workspace)).toEqual([".git"]);
  expect(existsSync(join(workspace, ".git/worktrees"))).toBe(false);

  mkdirSync(join(workspace, ".husky/_"), { recursive: true });
  expect((await partsOf(workspace)).folders).toEqual([".husky/_"]);
});

test.skipIf(!RUNS_SANDBOXES)("of a workspace the guard protects the held files and folders, a link in place of one as itself", async () => {
  const workspace = repositoryIn("held");
  mkdirSync(join(workspace, "pkg/app/.vscode"), { recursive: true });
  mkdirSync(join(workspace, ".claude"));
  for (const path of ["CLAUDE.md", "pkg/AGENTS.md"]) writeFileSync(join(workspace, path), "The owner's.\n");
  symlinkSync(secretsOfThisComputer(), join(workspace, ".codex"));

  expect(await partsOf(workspace, ["CLAUDE.md", "pkg/AGENTS.md", "pkg/app/.vscode", ".claude", ".codex"])).toEqual({ ...NOTHING_OF_ITS_OWN, files: ["CLAUDE.md", "pkg/AGENTS.md", ".codex"], folders: ["pkg/app/.vscode", ".claude"] });
});

test("a workspace that isn't a repository of its own, a git worktree, or a git folder taking another's config is refused", async () => {
  const plain = join(scratch, `plain-${crypto.randomUUID()}`);
  mkdirSync(plain);
  expect(await guardPlanOf(plain, ELSEWHERE)).toEqual({ refused: { kind: "workspace-not-a-repository" } });
  const worktree = join(scratch, `worktree-${crypto.randomUUID()}`);
  mkdirSync(worktree);
  writeFileSync(join(worktree, ".git"), "gitdir: /elsewhere/.git/worktrees/w\n");
  expect(await guardPlanOf(worktree, ELSEWHERE)).toEqual({ refused: { kind: "workspace-is-worktree" } });
  const pointing = repositoryIn("pointing");
  writeFileSync(join(pointing, ".git/commondir"), "/elsewhere/.git\n");
  expect(await guardPlanOf(pointing, ELSEWHERE)).toEqual({ refused: { kind: "workspace-has-commondir" } });
});

test("a repository whose worktrees' folders point git elsewhere, or whose hooks or worktrees folder is a link, is refused, and one with worktrees of its own is not", async () => {
  const workspace = repositoryIn("worktrees");
  Bun.spawnSync(["git", "-C", workspace, "commit", "-q", "--allow-empty", "-m", "first"], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  Bun.spawnSync(["git", "-C", workspace, "worktree", "add", "-q", join(scratch, `linked-${crypto.randomUUID()}`)]);
  const [linked] = readdirSync(join(workspace, ".git/worktrees"));
  expect(await sandboxRefusalOf(workspace, ELSEWHERE)).toBeNull();

  const commondir = join(workspace, ".git/worktrees", linked!, "commondir");
  writeFileSync(commondir, "/elsewhere/.git\n");
  expect(await sandboxRefusalOf(workspace, ELSEWHERE)).toEqual({ kind: "worktree-points-elsewhere", worktree: `worktrees/${linked}` });
  writeFileSync(commondir, "../..\n");
  mkdirSync(join(workspace, ".git/worktrees", linked!, "config.worktree"));
  expect(await sandboxRefusalOf(workspace, ELSEWHERE)).toEqual({ kind: "worktree-points-elsewhere", worktree: `worktrees/${linked}` });

  const linkedHooks = repositoryIn("linked-hooks");
  rmSync(join(linkedHooks, ".git/hooks"), { recursive: true, force: true });
  symlinkSync(join(linkedHooks, "hooks"), join(linkedHooks, ".git/hooks"));
  expect(await sandboxRefusalOf(linkedHooks, ELSEWHERE)).toEqual({ kind: "part-is-link", part: ".git/hooks" });
});

test("a submodule's git folder with its config or hooks a link to this computer's files is refused", async () => {
  const secrets = secretsOfThisComputer();
  for (const [part, target] of [
    ["config", join(secrets, "id_ed25519")],
    ["hooks", secrets],
  ] as const) {
    const workspace = repositoryIn(`planted-${part}`);
    const planted = join(workspace, ".git/modules/x");
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, "HEAD"), "ref: refs/heads/main\n");
    symlinkSync(target, join(planted, part));

    expect(await guardPlanOf(workspace, ELSEWHERE)).toEqual({ refused: { kind: "part-is-link", part: `.git/modules/x/${part}` } });
  }
});

const includes = (repository: string, path: string, key = "include.path") => Bun.spawnSync(["git", "-C", repository, "config", "--add", key, path]);

test.skipIf(!RUNS_SANDBOXES)("of a workspace the guard protects the files its config includes, at its root, through a chain of includes and on a condition, and keeps each folder on git's way to them in place", async () => {
  const workspace = repositoryIn("include");
  for (const folder of ["config", "tools", "past"]) mkdirSync(join(workspace, folder));
  writeFileSync(join(workspace, ".gitconfig"), "[include]\n\tpath = past/../config/team.gitconfig\n");
  writeFileSync(join(workspace, "config/team.gitconfig"), '[includeIf "onbranch:never"]\n\tpath = ../tools/git.cfg\n');
  writeFileSync(join(workspace, "tools/git.cfg"), "[user]\n\tname = Team\n");
  includes(workspace, "../.gitconfig");

  expect(await sandboxRefusalOf(workspace, ELSEWHERE)).toBeNull();
  const parts = await partsOf(workspace);

  expect(new Set(parts.files)).toEqual(new Set([".gitconfig", "config/team.gitconfig", "tools/git.cfg"]));
  expect(new Set(parts.onTheWay)).toEqual(new Set([".git", "past", "config", "tools"]));
  expect({ folders: parts.folders, gitFolders: parts.gitFolders }).toEqual({ folders: [], gitFolders: [".git"] });
});

function secretsOfThisComputer() {
  const secrets = join(scratch, `secrets-${crypto.randomUUID()}`);
  mkdirSync(secrets);
  writeFileSync(join(secrets, "id_ed25519"), "PRIVATE KEY\n");
  return secrets;
}

test.skipIf(!RUNS_SANDBOXES)("a file of the workspace the config includes that isn't there, or whose folder isn't, is refused, as the VM could make it", async () => {
  const missing = repositoryIn("include-missing");
  includes(missing, "../.gitconfig.local");
  expect(await sandboxRefusalOf(missing, ELSEWHERE)).toEqual({ kind: "config-includes-missing-file", file: ".gitconfig.local" });

  const missingFolder = repositoryIn("include-missing-folder");
  includes(missingFolder, join(missingFolder, "shared/team.cfg"), "includeIf.onbranch:main.path");
  expect(await sandboxRefusalOf(missingFolder, ELSEWHERE)).toEqual({ kind: "config-includes-missing-file", file: "shared/team.cfg" });
});

test.skipIf(!RUNS_SANDBOXES)("a file of the workspace a config git reads includes, reached through a link anywhere on the way, is refused, as the VM could change where git finds it", async () => {
  const secrets = secretsOfThisComputer();

  const linkedFolder = repositoryIn("include-linked-folder");
  mkdirSync(join(linkedFolder, "real"));
  writeFileSync(join(linkedFolder, "real/team.cfg"), "");
  symlinkSync(join(linkedFolder, "real"), join(linkedFolder, "linked"));
  includes(linkedFolder, "../linked/team.cfg");
  expect(await sandboxRefusalOf(linkedFolder, ELSEWHERE)).toEqual({ kind: "config-read-through-link", file: "linked/team.cfg", link: "linked" });

  const linkedFile = repositoryIn("include-linked-file");
  symlinkSync(join(secrets, "id_ed25519"), join(linkedFile, ".gitconfig"));
  includes(linkedFile, "../.gitconfig");
  expect(await guardPlanOf(linkedFile, ELSEWHERE)).toEqual({ refused: { kind: "config-read-through-link", file: ".gitconfig", link: ".gitconfig" } });

  const steppingBack = repositoryIn("include-stepping-back");
  mkdirSync(join(steppingBack, "deep/er"), { recursive: true });
  writeFileSync(join(steppingBack, "deep/.gitconfig"), "");
  symlinkSync(join(steppingBack, "deep/er"), join(steppingBack, "sub"));
  includes(steppingBack, "../sub/../.gitconfig");
  expect(await sandboxRefusalOf(steppingBack, ELSEWHERE)).toEqual({ kind: "config-read-through-link", file: ".gitconfig", link: "sub" });

  const reachedFromOutside = repositoryIn("include-reached-from-outside");
  writeFileSync(join(reachedFromOutside, "team.cfg"), "");
  const toWorkspace = join(scratch, `to-workspace-${crypto.randomUUID()}`);
  symlinkSync(reachedFromOutside, toWorkspace);
  const outside = join(scratch, `outside-${crypto.randomUUID()}.gitconfig`);
  writeFileSync(outside, `[include]\n\tpath = ${join(toWorkspace, "team.cfg")}\n`);
  includes(reachedFromOutside, outside);
  expect(await sandboxRefusalOf(reachedFromOutside, ELSEWHERE)).toEqual({ kind: "config-read-through-link", file: join(toWorkspace, "team.cfg"), link: toWorkspace });
});

test.skipIf(!RUNS_SANDBOXES)("an included file of the workspace that is no regular file is refused, and files included from outside it are not", async () => {
  const secrets = secretsOfThisComputer();

  const folderIncluded = repositoryIn("include-folder");
  mkdirSync(join(folderIncluded, ".gitconfig"));
  includes(folderIncluded, "../.gitconfig");
  expect(await sandboxRefusalOf(folderIncluded, ELSEWHERE)).toEqual({ kind: "config-includes-not-a-file", file: ".gitconfig" });

  const elsewhere = repositoryIn("include-elsewhere");
  includes(elsewhere, join(scratch, "shared.gitconfig"));
  includes(elsewhere, join(secrets, "id_ed25519"));
  expect(await sandboxRefusalOf(elsewhere, ELSEWHERE)).toBeNull();
});

test.skipIf(!RUNS_SANDBOXES)("this computer's own config, read through a link to a file of the workspace, is refused", async () => {
  const dotfiles = repositoryIn("dotfiles");
  writeFileSync(join(dotfiles, "gitconfig"), "[user]\n\tname = Owner\n");
  const globalConfig = join(scratch, `global-${crypto.randomUUID()}.gitconfig`);
  symlinkSync(join(dotfiles, "gitconfig"), globalConfig);
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  try {
    expect(await sandboxRefusalOf(dotfiles, ELSEWHERE)).toEqual({ kind: "config-read-through-link", file: globalConfig, link: globalConfig });
  } finally {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
  }
});

test.skipIf(!RUNS_SANDBOXES)("the home folder, a folder holding or within Mirador's data or its own checkout, and one that is or holds a folder this computer runs programs from, are never a sandbox's workspace", async () => {
  const workspace = repositoryIn("mirador-places");
  expect(await sandboxRefusalOf(workspace, { ...ELSEWHERE, home: workspace })).toEqual({ kind: "workspace-is-home" });
  expect(await sandboxRefusalOf(workspace, { ...ELSEWHERE, dataDir: join(workspace, "data") })).toEqual({ kind: "workspace-holds-mirador-data" });
  expect(await sandboxRefusalOf(join(workspace, ".git"), { ...ELSEWHERE, dataDir: workspace })).toEqual({ kind: "workspace-holds-mirador-data" });
  expect(await sandboxRefusalOf(workspace, { ...ELSEWHERE, checkout: workspace })).toEqual({ kind: "workspace-is-mirador" });
  expect(await sandboxRefusalOf(workspace, { ...ELSEWHERE, home: scratch })).toBeNull();
  const config = join(workspace, ".config");
  mkdirSync(config);
  expect(await sandboxRefusalOf(workspace, { ...ELSEWHERE, computersOwn: [config] })).toEqual({ kind: "workspace-holds-computers-own", folder: config });
  expect(await sandboxRefusalOf(workspace, { ...ELSEWHERE, computersOwn: [workspace] })).toEqual({ kind: "workspace-holds-computers-own", folder: workspace });
  expect(await sandboxRefusalOf(workspace, { ...ELSEWHERE, computersOwn: [join(scratch, "elsewhere", ".local")] })).toBeNull();
});

test.skipIf(!RUNS_SANDBOXES)("a relative hooks folder this Mac's own config names is protected, taken from the workspace", async () => {
  const workspace = repositoryIn("global-hooks");
  const globalConfig = join(scratch, `global-${crypto.randomUUID()}.gitconfig`);
  writeFileSync(globalConfig, "[core]\n\thooksPath = .githooks\n");
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  try {
    expect((await partsOf(workspace)).folders).toEqual([".githooks"]);
  } finally {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
  }
});

test.skipIf(!RUNS_SANDBOXES)("a configured hooksPath through a symlink or at a non-folder is refused without creating folders outside", async () => {
  const outside = join(scratch, `outside-hooks-${crypto.randomUUID()}`);
  mkdirSync(outside);
  const linkedOut = repositoryIn("hooks-linked-out");
  symlinkSync(outside, join(linkedOut, "scripts"));
  Bun.spawnSync(["git", "-C", linkedOut, "config", "core.hooksPath", "scripts/git-hooks"]);
  expect(await guardPlanOf(linkedOut, ELSEWHERE)).toEqual({ refused: { kind: "part-is-link", part: "scripts" } });
  expect(existsSync(join(outside, "git-hooks"))).toBe(false);

  const linkedIn = repositoryIn("hooks-linked-in");
  mkdirSync(join(linkedIn, "tools/git-hooks"), { recursive: true });
  symlinkSync("tools", join(linkedIn, "scripts"));
  Bun.spawnSync(["git", "-C", linkedIn, "config", "core.hooksPath", "scripts/git-hooks"]);
  expect(await guardPlanOf(linkedIn, ELSEWHERE)).toEqual({ refused: { kind: "part-is-link", part: "scripts" } });

  const fileHooks = repositoryIn("hooks-file");
  writeFileSync(join(fileHooks, "hooks"), "not a folder");
  Bun.spawnSync(["git", "-C", fileHooks, "config", "core.hooksPath", "hooks"]);
  expect(await guardPlanOf(fileHooks, ELSEWHERE)).toEqual({ refused: { kind: "part-is-link", part: "hooks" } });

  const underFile = repositoryIn("hooks-under-file");
  writeFileSync(join(underFile, "tools"), "not a folder");
  Bun.spawnSync(["git", "-C", underFile, "config", "core.hooksPath", "tools/hooks"]);
  expect(await guardPlanOf(underFile, ELSEWHERE)).toEqual({ refused: { kind: "part-is-link", part: "tools" } });
});

test("a sandbox runs on its own base image, else on the one Settings give, else on Mirador's", () => {
  const named = (baseImage: string | null): SandboxSetting => ({ ...NO_SANDBOX, on: true, baseImage });
  expect(imageSandboxRunsOn(named("ghcr.io/me/own:1"), "ghcr.io/me/default:2")).toBe("ghcr.io/me/own:1");
  expect(imageSandboxRunsOn(named(null), "ghcr.io/me/default:2")).toBe("ghcr.io/me/default:2");
  expect(imageSandboxRunsOn(undefined, "ghcr.io/me/default:2")).toBe("ghcr.io/me/default:2");
  expect(imageSandboxRunsOn(named(null), null)).toBeNull();
});

test("every JVM in the VM goes through the web proxy, after any options the room or workspace gives, which a secret keeps out", () => {
  const throughTheProxy = "-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7703 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7703";
  const inVm = (given: Record<string, string>) =>
    environmentInVm(given, { kind: { harness: "claude", keyVariable: "ANTHROPIC_API_KEY" }, version: "2.1.330", base: { image: "b", path: null } }, { configFolder: "/data/c", modelBaseUrl: "http://127.0.0.1:7702/p/p1" }, ["sk-secret"]).JAVA_TOOL_OPTIONS;
  expect(inVm({})).toBe(throughTheProxy);
  expect(inVm({ JAVA_TOOL_OPTIONS: "-Xmx2g -Dhttps.proxyHost=elsewhere" })).toBe(`-Xmx2g -Dhttps.proxyHost=elsewhere ${throughTheProxy}`);
  expect(inVm({ JAVA_TOOL_OPTIONS: "-Dtoken=sk-secret" })).toBe(throughTheProxy);
  expect(vmEnvironment({ image: "b", path: null }, null).JAVA_TOOL_OPTIONS).toBe(throughTheProxy);
});

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environmentInVm, KEY_PLACEHOLDER } from "../host/sandbox/agent-environment.ts";
import { CONTAINER_READS, execArguments, vmIdsLabelled } from "../host/sandbox/apple-container.ts";
import { appleContainerAvailability, appleContainerRuntime, podmanAvailability, podmanStorageIn, selinuxEnforcingAt } from "../host/sandbox/availability.ts";
import { execProcessEnvironment } from "../host/sandbox/exec-environment.ts";
import { baseImageOf, buildStepIn, claudeCodeVersionIn, imageReferencesIn, imageTag, RECIPE } from "../host/sandbox/image.ts";
import { PODMAN_READS } from "../host/sandbox/podman.ts";
import { gitFoldersOf, sandboxRefusalOf, workspaceMounts, type MiradorPlaces } from "../host/sandbox/workspace-mounts.ts";
import { narrowsSandbox, roomSandboxIn, sameSandbox, sharesKernel, signInElsewhere } from "../shared/sandbox.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-parts-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ELSEWHERE: MiradorPlaces = { home: "/nonexistent-home", dataDir: "/nonexistent-data", checkout: "/nonexistent-checkout", computersOwn: [] };

function repositoryIn(name: string) {
  const workspace = join(scratch, `${name}-${crypto.randomUUID()}`);
  mkdirSync(workspace, { recursive: true });
  Bun.spawnSync(["git", "init", "-q", workspace]);
  return workspace;
}

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
  const sandbox = (on: boolean, workFreely: boolean, allowsSharedKernel = false) => ({ on, workFreely, allowsSharedKernel });
  expect(roomSandboxIn({ on: "yes", workFreely: 0 })).toEqual(sandbox(false, true));
  expect(roomSandboxIn({ on: true, workFreely: false })).toEqual(sandbox(true, false));
  expect(roomSandboxIn({ on: true, workFreely: true, allowsSharedKernel: true })).toEqual(sandbox(true, true, true));
  expect(roomSandboxIn({ on: false, workFreely: true, allowsSharedKernel: true })).toEqual(sandbox(false, true));
  expect(narrowsSandbox(sandbox(false, true), sandbox(true, true))).toBe(true);
  expect(narrowsSandbox(sandbox(true, true), sandbox(true, false))).toBe(true);
  expect(narrowsSandbox(sandbox(true, false), sandbox(true, true))).toBe(false);
  expect(narrowsSandbox(sandbox(true, true), sandbox(false, true))).toBe(false);
  expect(narrowsSandbox(sandbox(true, true, true), sandbox(true, true))).toBe(true);
  expect(narrowsSandbox(sandbox(true, true), sandbox(true, true, true))).toBe(false);
  expect(sameSandbox(sandbox(true, true), sandbox(true, true, true))).toBe(false);
});

test("an agent that signs in with a key works in a sandbox; one on a subscription, Bedrock, Vertex or Foundry does not yet", () => {
  expect(signInElsewhere({ ANTHROPIC_API_KEY: "k" })).toBeNull();
  expect(signInElsewhere({ ANTHROPIC_AUTH_TOKEN: "t" })).toBeNull();
  expect(signInElsewhere({})).toBe("subscription");
  expect(signInElsewhere({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_BEDROCK: "1" })).toBe("bedrock");
  expect(signInElsewhere({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_VERTEX: "true" })).toBe("vertex");
  expect(signInElsewhere({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_FOUNDRY: "on" })).toBe("foundry");
});

test("the image is told apart by Claude Code's version, Bun's and the recipe's, and its build says which step it is on", async () => {
  expect(claudeCodeVersionIn("2.1.330 (Claude Code)")).toBe("2.1.330");
  expect(claudeCodeVersionIn("2.2.0-beta.1 (Claude Code)")).toBe("2.2.0-beta.1");
  expect(claudeCodeVersionIn("command not found")).toBeNull();
  expect(claudeCodeVersionIn(null)).toBeNull();
  expect(await imageTag("2.1.330", "1.4.4")).toMatch(/^mirador-room-agent:claude-2\.1\.330-bun-1\.4\.4-[0-9a-f]{10}$/);
  expect(buildStepIn("#7 [stage-1 3/6] RUN npm install -g @anthropic-ai/claude-code@2.1.330")).toEqual({ at: 3, of: 6 });
  expect(buildStepIn("#5 [2/4] RUN apt-get update")).toEqual({ at: 2, of: 4 });
  expect(buildStepIn("#7 DONE 12.3s")).toBeNull();
  expect(buildStepIn("STEP 5/8: RUN npm install -g bun@1.4.4 @anthropic-ai/claude-code@2.1.330")).toEqual({ at: 5, of: 8 });
  expect(buildStepIn("--> 3f2a1b")).toBeNull();
  expect(baseImageOf(await Bun.file(RECIPE).text())).toBe("docker.io/library/node:22-bookworm-slim");
  const listed = `[{"descriptor":{"digest":"sha256:abc"},"fullSize":"79,9 MB","reference":"docker.io/library/node:22"},{"descriptor":{"annotations":{"io.containerd.image.name":"docker.io/library/mirador-room-agent:claude-2"}},"reference":"mirador-room-agent:claude-2"}]`;
  expect(imageReferencesIn(listed)).toEqual(new Set(["docker.io/library/node:22", "mirador-room-agent:claude-2"]));
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

test("the agent's environment in the VM keeps the key and this Mac's own places out, and passes its values by name", () => {
  const given = { ANTHROPIC_AUTH_TOKEN: "token-of-the-profile", ANTHROPIC_API_KEY: "another-key", CLAUDE_CODE_OAUTH_TOKEN: "subscription-token", ANTHROPIC_BASE_URL: "https://gateway.example", CLAUDE_CONFIG_DIR: "/Users/me/.claude", SSH_AUTH_SOCK: "/tmp/ssh", MIRADOR_SCRIPT_TOKEN: "s", HOME: "/Users/me", DEPLOY: "staging" };
  const inVm = environmentInVm(given, { configDir: "/data/sandbox/r/claude", modelBaseUrl: "http://127.0.0.1:7702/p/p1", keyVariable: "ANTHROPIC_AUTH_TOKEN" });
  expect(inVm).toMatchObject({ ANTHROPIC_AUTH_TOKEN: KEY_PLACEHOLDER, ANTHROPIC_BASE_URL: "http://127.0.0.1:7702/p/p1", CLAUDE_CONFIG_DIR: "/data/sandbox/r/claude", HOME: "/home/node", DEPLOY: "staging" });
  expect(inVm.ANTHROPIC_API_KEY).toBeUndefined();
  expect(inVm.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  expect(inVm.SSH_AUTH_SOCK).toBeUndefined();
  expect(inVm.MIRADOR_SCRIPT_TOKEN).toBeUndefined();
  const args = execArguments({ vm: "vm-1", user: "1000:1000", workingDirectory: "/work", environment: inVm, command: ["bun", "agent.js"] });
  expect(args.slice(0, 6)).toEqual(["exec", "-i", "--user", "0:0", "-w", "/work"]);
  expect(args.slice(args.indexOf("vm-1"))).toEqual(["vm-1", "setpriv", "--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", "bun", "agent.js"]);
  expect(args).toContain("DEPLOY");
  expect(args).toContain("HOME=/home/node");
  expect(args.join(" ")).not.toContain("staging");
  const { PATH, HOME, TMPDIR, USER, LOGNAME, SHELL, ...notReadByContainer } = inVm;
  expect(execProcessEnvironment(inVm, { HOME: "/Users/me", PATH: "/opt/mac/bin", SECRET_OF_THE_MAC: "s" }, CONTAINER_READS)).toEqual({ ...notReadByContainer, HOME: "/Users/me", PATH: "/opt/mac/bin" });
  expect([PATH, HOME, TMPDIR, USER, LOGNAME, SHELL].every((value) => args.join(" ").includes(`=${value}`))).toBe(true);
});

test("podman's exec process reads only this computer's own of the variables Podman reads, never the agent's, even where this computer has none", () => {
  const agents = { CONTAINER_HOST: "ssh://elsewhere", CONTAINERS_CONF: "/given/containers.conf", _CONTAINERS_ROOTLESS_UID: "0", STORAGE_OPTS: "given", XDG_RUNTIME_DIR: "/run/user/given", DEPLOY: "staging" };
  const here = { PATH: "/usr/bin", XDG_RUNTIME_DIR: "/run/user/1000", CONTAINERS_STORAGE_CONF: "/home/me/storage.conf", SECRET_HERE: "s" };
  expect(execProcessEnvironment(agents, here, PODMAN_READS)).toEqual({ DEPLOY: "staging", PATH: "/usr/bin", XDG_RUNTIME_DIR: "/run/user/1000", CONTAINERS_STORAGE_CONF: "/home/me/storage.conf" });
});

test("a workspace's repository and its submodules keep copies of their config, and their hooks and worktrees read-only, in folders that can't be moved aside, and a hooks folder its config names in the workspace too", async () => {
  const workspace = repositoryIn("workspace");
  Bun.spawnSync(["git", "-C", workspace, "config", "core.hooksPath", ".husky"]);
  const submodule = join(workspace, ".git/modules/lib");
  mkdirSync(submodule, { recursive: true });
  Bun.spawnSync(["git", "init", "-q", "--bare", submodule]);
  const copies = join(scratch, `copies-${crypto.randomUUID()}`);

  const planned = await workspaceMounts(workspace, copies, ELSEWHERE);

  if ("refused" in planned) throw new Error(`refused: ${planned.refused.kind}`);
  const configCopy = (gitFolder: string) => planned.mounts.find(({ target }) => target === join(gitFolder, "config"))!.source;
  expect(planned.mounts).toEqual([
    { source: workspace, target: workspace, readOnly: false },
    { source: join(workspace, ".git"), target: join(workspace, ".git"), readOnly: false },
    { source: configCopy(join(workspace, ".git")), target: join(workspace, ".git/config"), readOnly: true },
    { source: join(workspace, ".git/hooks"), target: join(workspace, ".git/hooks"), readOnly: true },
    { source: join(workspace, ".git/modules"), target: join(workspace, ".git/modules"), readOnly: false },
    { source: submodule, target: submodule, readOnly: false },
    { source: configCopy(submodule), target: join(submodule, "config"), readOnly: true },
    { source: join(submodule, "hooks"), target: join(submodule, "hooks"), readOnly: true },
    { source: join(workspace, ".git/worktrees"), target: join(workspace, ".git/worktrees"), readOnly: true },
    { source: join(workspace, ".husky"), target: join(workspace, ".husky"), readOnly: true },
  ]);
  expect(await gitFoldersOf(workspace)).toEqual([".git", ".git/modules/lib"]);
  for (const gitFolder of [join(workspace, ".git"), submodule]) {
    expect(configCopy(gitFolder).startsWith(`${copies}/`)).toBe(true);
    expect(readFileSync(configCopy(gitFolder), "utf8")).toBe(readFileSync(join(gitFolder, "config"), "utf8"));
  }
  expect(statSync(join(workspace, ".husky")).isDirectory()).toBe(true);
  expect(statSync(join(workspace, ".git/worktrees")).isDirectory()).toBe(true);

  await workspaceMounts(workspace, copies, ELSEWHERE);
  expect(readdirSync(copies)).toHaveLength(2);
});

test("a repository that reads per-worktree config gets an empty one, read-only in the VM, where it has none yet", async () => {
  const workspace = repositoryIn("worktree-config");
  Bun.spawnSync(["git", "-C", workspace, "config", "extensions.worktreeConfig", "true"]);
  const plain = repositoryIn("no-worktree-config");

  const planned = await workspaceMounts(workspace, join(scratch, `copies-${crypto.randomUUID()}`), ELSEWHERE);
  await workspaceMounts(plain, join(scratch, `copies-${crypto.randomUUID()}`), ELSEWHERE);

  if ("refused" in planned) throw new Error(`refused: ${planned.refused.kind}`);
  expect(readFileSync(join(workspace, ".git/config.worktree"), "utf8")).toBe("");
  expect(planned.mounts.find(({ target }) => target === join(workspace, ".git/config.worktree"))?.readOnly).toBe(true);
  expect(existsSync(join(plain, ".git/config.worktree"))).toBe(false);
});

test("held files and folders are read-only in the VM, outermost only, with each folder holding them mounted so it can't be moved aside", async () => {
  const workspace = repositoryIn("held");
  mkdirSync(join(workspace, "pkg/app/.vscode"), { recursive: true });
  mkdirSync(join(workspace, ".claude/commands"), { recursive: true });

  const planned = await workspaceMounts(workspace, join(scratch, `copies-${crypto.randomUUID()}`), ELSEWHERE, ["CLAUDE.md", "pkg/app/.vscode", ".claude", ".claude/commands"]);

  if ("refused" in planned) throw new Error(`refused: ${planned.refused.kind}`);
  const outsideGit = planned.mounts.filter(({ target }) => !target.startsWith(join(workspace, ".git")));
  expect(outsideGit).toEqual([
    { source: workspace, target: workspace, readOnly: false },
    { source: join(workspace, ".claude"), target: join(workspace, ".claude"), readOnly: true },
    { source: join(workspace, "CLAUDE.md"), target: join(workspace, "CLAUDE.md"), readOnly: true },
    { source: join(workspace, "pkg"), target: join(workspace, "pkg"), readOnly: false },
    { source: join(workspace, "pkg/app"), target: join(workspace, "pkg/app"), readOnly: false },
    { source: join(workspace, "pkg/app/.vscode"), target: join(workspace, "pkg/app/.vscode"), readOnly: true },
  ]);
});

test("a workspace that isn't a repository of its own, a git worktree, or a git folder taking another's config is refused", async () => {
  const plain = join(scratch, `plain-${crypto.randomUUID()}`);
  mkdirSync(plain);
  expect(await workspaceMounts(plain, join(scratch, "unused"), ELSEWHERE)).toEqual({ refused: { kind: "workspace-not-a-repository" } });
  const worktree = join(scratch, `worktree-${crypto.randomUUID()}`);
  mkdirSync(worktree);
  writeFileSync(join(worktree, ".git"), "gitdir: /elsewhere/.git/worktrees/w\n");
  expect(await workspaceMounts(worktree, join(scratch, "unused"), ELSEWHERE)).toEqual({ refused: { kind: "workspace-is-worktree" } });
  const pointing = repositoryIn("pointing");
  writeFileSync(join(pointing, ".git/commondir"), "/elsewhere/.git\n");
  expect(await workspaceMounts(pointing, join(scratch, "unused"), ELSEWHERE)).toEqual({ refused: { kind: "workspace-has-commondir" } });
  expect(existsSync(join(scratch, "unused"))).toBe(false);
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

test("a submodule's git folder an agent made with its config or hooks a link to this computer's files is refused, and nothing outside is copied or mounted", async () => {
  const secrets = join(scratch, `secrets-${crypto.randomUUID()}`);
  mkdirSync(secrets);
  writeFileSync(join(secrets, "id_ed25519"), "PRIVATE KEY\n");
  for (const [part, target] of [
    ["config", join(secrets, "id_ed25519")],
    ["hooks", secrets],
  ] as const) {
    const workspace = repositoryIn(`planted-${part}`);
    const planted = join(workspace, ".git/modules/x");
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, "HEAD"), "ref: refs/heads/main\n");
    symlinkSync(target, join(planted, part));
    const copies = join(scratch, `copies-${crypto.randomUUID()}`);

    expect(await workspaceMounts(workspace, copies, ELSEWHERE)).toEqual({ refused: { kind: "part-is-link", part: `.git/modules/x/${part}` } });
    expect(existsSync(copies)).toBe(false);
  }
});

test("a held folder an agent turned into a link to this computer's files is never mounted", async () => {
  const secrets = join(scratch, `secrets-${crypto.randomUUID()}`);
  mkdirSync(secrets);
  const workspace = repositoryIn("held-link");
  symlinkSync(secrets, join(workspace, ".claude"));

  expect(await workspaceMounts(workspace, join(scratch, `copies-${crypto.randomUUID()}`), ELSEWHERE, [".claude"])).toEqual({ refused: { kind: "part-is-link", part: ".claude" } });
});

test("a repository whose config includes a file of the workspace, by any condition or through another file, is refused with that file", async () => {
  const direct = repositoryIn("include");
  Bun.spawnSync(["git", "-C", direct, "config", "include.path", "../team.gitconfig"]);
  expect(await sandboxRefusalOf(direct, ELSEWHERE)).toEqual({ kind: "config-includes-workspace-file", file: "team.gitconfig" });

  const conditional = repositoryIn("include-if");
  Bun.spawnSync(["git", "-C", conditional, "config", "includeIf.onbranch:main.path", join(conditional, "config/git")]);
  expect(await sandboxRefusalOf(conditional, ELSEWHERE)).toEqual({ kind: "config-includes-workspace-file", file: "config/git" });

  const nested = repositoryIn("include-nested");
  const outside = join(scratch, `outside-${crypto.randomUUID()}.gitconfig`);
  writeFileSync(outside, `[include]\n\tpath = ${join(nested, "tools/git.cfg")}\n`);
  Bun.spawnSync(["git", "-C", nested, "config", "include.path", outside]);
  expect(await sandboxRefusalOf(nested, ELSEWHERE)).toEqual({ kind: "config-includes-workspace-file", file: "tools/git.cfg" });

  const elsewhere = repositoryIn("include-elsewhere");
  Bun.spawnSync(["git", "-C", elsewhere, "config", "include.path", join(scratch, "shared.gitconfig")]);
  expect(await sandboxRefusalOf(elsewhere, ELSEWHERE)).toBeNull();
});

test("the home folder, a folder holding or within Mirador's data or its own checkout, and one that is or holds a folder this computer runs programs from, are never a sandbox's workspace", async () => {
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

test("a relative hooks folder this Mac's own config names is read-only in the VM, taken from the workspace", async () => {
  const workspace = repositoryIn("global-hooks");
  const globalConfig = join(scratch, `global-${crypto.randomUUID()}.gitconfig`);
  writeFileSync(globalConfig, "[core]\n\thooksPath = .githooks\n");
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  try {
    const planned = await workspaceMounts(workspace, join(scratch, `copies-${crypto.randomUUID()}`), ELSEWHERE);
    if ("refused" in planned) throw new Error(`refused: ${planned.refused.kind}`);
    expect(planned.mounts).toContainEqual({ source: join(workspace, ".githooks"), target: join(workspace, ".githooks"), readOnly: true });
  } finally {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
  }
});

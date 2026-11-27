import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { roomSandbox, type SandboxFolder } from "../shared/sandbox.ts";
import { AppleContainer } from "../host/sandbox/apple-container.ts";
import { ANTHROPIC_API } from "../host/sandbox/model-proxy.ts";
import { Podman } from "../host/sandbox/podman.ts";
import { Sandboxes, type SandboxHost } from "../host/sandbox/sandboxes.ts";

/**
 * A sandbox's guard in a real VM, started as Mirador starts one: with Apple's `container` on a Mac, in a rootless Podman
 * container on Linux. Opted into, as it builds the agents' image on this computer first:
 * `MIRADOR_SANDBOX_VM_E2E=1 bun test tests/guard-in-vm.test.ts --timeout 60000`.
 */
const optedIn = process.env.MIRADOR_SANDBOX_VM_E2E === "1";
const CLAUDE_VERSION = "2.1.330";
const WITH_THE_IMAGES_BUILD_MS = 30 * 60_000;
const RACE_S = 10;
const SHOWN_WITHIN_MS = 5_000;

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const git = (folder: string, ...args: string[]) => {
  const ran = Bun.spawnSync(["git", "-c", "protocol.file.allow=always", "-c", "user.name=owner", "-c", "user.email=owner@example.com", "-C", folder, ...args]);
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${ran.stderr}`);
};
function repository(folder: string, files: Record<string, string>) {
  mkdirSync(folder, { recursive: true });
  git(folder, "init", "-q");
  Object.entries(files).forEach(([path, text]) => write(join(folder, path), text));
  git(folder, "add", "--all");
  git(folder, "commit", "-q", "-m", "first");
}

/** The workspace of a sandbox: a repository with a submodule, two others inside it, one of them bare, and files agents load; and a repository added to it read and write. */
function makeFolders() {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "guard-in-vm-")));
  const [workspace, library] = [join(scratch, "workspace"), join(scratch, "library")];
  repository(join(scratch, "submodule"), { s: "s\n" });
  repository(library, { "lib.txt": "lib\n" });
  repository(workspace, { ".gitignore": "/docs/\n/fixtures/\n/node_modules/\n", "CLAUDE.md": "the owner's\n", "pkg/CLAUDE.md": "the owner's for pkg\n", ".claude/settings.json": "{}\n", ".team/gitconfig": "[mirador]\n\tteam = shared\n", "src/a.txt": "a\n" });
  repository(join(workspace, "vendor/lib"), { x: "x\n", "githooks/pre-commit": "#!/bin/sh\n" });
  git(join(workspace, "vendor/lib"), "config", "core.hooksPath", "githooks");
  git(workspace, "clone", "-q", "--bare", join(scratch, "submodule"), "fixtures/remote.git");
  for (const head of ["docs/HEAD", "node_modules/pkg/HEAD"]) write(join(workspace, head), "a headline\n");
  git(workspace, "submodule", "add", "-q", join(scratch, "submodule"), "mods/refs");
  git(workspace, "config", "include.path", "../.team/gitconfig");
  git(workspace, "commit", "-q", "-m", "submodule");
  return { scratch, workspace, library };
}

async function ran([program, ...args]: string[], environment: Record<string, string>, input = "") {
  const run = Bun.spawn([program!, ...args], { env: environment, stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]);
  return { stdout, stderr, exitCode: await run.exited };
}

/** A sandbox of this computer, which runs commands just as it would an agent. */
function sandboxHere() {
  const { scratch, workspace, library } = makeFolders();
  const path = process.env.PATH ?? "";
  const folders: SandboxFolder[] = [{ path: library, writable: true, addedAt: 0 }];
  const host: SandboxHost = {
    dataDir: join(scratch, "data"),
    workspaceOf: () => workspace,
    canvasOf: () => ({ belongs: () => true, tokenOf: () => "token", handle: () => new Response("canvas") }),
    atWork: () => ({ agents: [], conversationIds: [] }),
    setupChanged: () => {},
    heldChanged: () => {},
    foldersOf: () => folders,
    networkOf: () => "closed",
    otherSandboxes: () => ({ workspaces: [], writableFolders: [], writableFoldersOn: [], foldersLeft: [] }),
    foldersStarted: () => {},
    places: { home: scratch, dataDir: join(scratch, "mirador-data"), checkout: "/nonexistent-checkout", computersOwn: [] },
  };
  const sandboxes = new Sandboxes(process.platform === "linux" ? Podman.here(undefined, path) : AppleContainer.here(undefined, path), host, 10 * 60_000);
  const launch = (agent: string[]) =>
    sandboxes.launch({
      owner: roomSandbox("room-1"),
      allowsSharedKernel: true,
      profileId: "builder",
      kind: { harness: "claude", keyVariable: "ANTHROPIC_API_KEY" },
      version: CLAUDE_VERSION,
      workingDirectory: workspace,
      given: {},
      route: { upstream: ANTHROPIC_API, api: "anthropic-messages", key: "sk-ant-none-1234567890", keyHeader: "x-api-key", headers: [] },
      agent,
    });
  const asAgent = async (command: string[], input = "") => {
    const launched = await launch(command);
    return ran(launched.command, launched.environment, input).finally(() => launched.gone!());
  };
  return {
    workspace,
    library,
    at: (inWorkspace: string) => join(workspace, inWorkspace),
    aside: join(scratch, "aside"),
    toldGuards: join(host.dataDir, "sandbox", "room-1", "guard"),
    launch,
    asAgent,
    inWorkspace: (bash: string) => asAgent(["bash", "-c", `cd '${workspace}' && ${bash}`]),
    stop: () => sandboxes.stopAll(),
    cleanUp: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

const script = (name: string) => readFileSync(join(import.meta.dir, "guard", name), "utf8");

/** How the processes of the VM run, as anyone there may read it. */
const PROCESSES = `
const read = (path) => { try { return fs.readFileSync(path, "utf8"); } catch { return ""; } };
const told = (path) => Object.fromEntries(read(path).split("\\n").map((line) => line.split(/:\\s+/)).filter(([name]) => /^(Uid|Cap...|NoNewPrivs)$/.test(name)));
const pids = fs.readdirSync("/proc").filter((name) => /^\\d+$/.test(name));
console.log(JSON.stringify(pids.map((pid) => ({ pid: Number(pid), name: read("/proc/" + pid + "/comm").trim(), command: read("/proc/" + pid + "/cmdline").replaceAll("\\0", " ").trim(), threads: fs.readdirSync("/proc/" + pid + "/task").map((thread) => told("/proc/" + pid + "/task/" + thread + "/status")) }))));
`;
interface ProcessInVm {
  pid: number;
  name: string;
  command: string;
  threads: Record<string, string>[];
}
const NO_CAPABILITY = { CapInh: "0000000000000000", CapPrm: "0000000000000000", CapEff: "0000000000000000", CapBnd: "0000000000000000", CapAmb: "0000000000000000", NoNewPrivs: "1" };

describe.skipIf(!optedIn)("a sandbox's guard, in a real VM", () => {
  let sandbox: ReturnType<typeof sandboxHere>;
  beforeAll(() => {
    sandbox = sandboxHere();
  });
  afterAll(async () => {
    await sandbox.stop();
    sandbox.cleanUp();
  });

  test(
    "lets agents work there as usual, refuses what would change a protected file or plant what the owner's git runs, and can't be got around",
    async () => {
      const { workspace, at, asAgent, toldGuards } = sandbox;
      const { stdout, stderr, exitCode } = await asAgent(["bash", "-s", "--", workspace], script("trial.sh"));
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(stdout).toMatch(/^\d{3} attempts, 0 went otherwise than they should\n$/);
      expect(readFileSync(at("CLAUDE.md"), "utf8")).toBe("the owner's\n");
      expect(readdirSync(toldGuards)).toHaveLength(1);
    },
    WITH_THE_IMAGES_BUILD_MS,
  );

  test("runs, as the relays and the agents do, with no capability and none to gain, and alone holds the device it serves the files through", async () => {
    const launched = await sandbox.launch(["node", "-e", PROCESSES]);
    const processes = JSON.parse((await ran(launched.command, launched.environment)).stdout) as ProcessInVm[];
    const called = (name: string) => processes.filter((each) => each.name === name);
    const threadsOf = (name: string) => called(name).flatMap(({ threads }) => threads);
    const [guard, ...otherGuards] = called("mirador-guard");
    expect(otherGuards).toEqual([]);
    expect(guard!.threads.length).toBeGreaterThan(1);
    expect(new Set(guard!.threads.map(({ Uid }) => Uid))).toEqual(new Set(["0\t0\t0\t1000"]));
    expect(new Set(threadsOf("bun").map(({ Uid }) => Uid))).toEqual(new Set(["65534\t65534\t65534\t65534"]));
    expect(new Set(threadsOf("node").map(({ Uid }) => Uid))).toEqual(new Set(["1000\t1000\t1000\t1000"]));
    for (const { Uid, ...privileges } of [...guard!.threads, ...threadsOf("bun"), ...threadsOf("node")]) expect(privileges, Uid).toEqual(NO_CAPABILITY);
    const others = processes.filter(({ name, pid }) => pid !== 1 && !["mirador-guard", "bun", "node"].includes(name));
    expect(others).toEqual([]);

    const asRelays = launched.command.map((arg) => arg.replace(/^--(reuid|regid)=1000$/, "--$1=65534"));
    const openIn = async (command: string[], pid: string) => (await ran([...command.slice(0, command.indexOf("node")), "ls", "-l", `/proc/${pid}/fd`], launched.environment)).stdout;
    const [relays] = called("bun");
    const openInRelays = await openIn(asRelays, String(relays!.pid));
    expect(openInRelays).toContain("socket:");
    expect(openInRelays + (await openIn(launched.command, "self"))).not.toContain("/dev/fuse");
    launched.gone!();
  });

  test("shows what the owner changes within seconds, and gives them what agents make", async () => {
    const { at, inWorkspace } = sandbox;
    const isShown = async (bash: string, stdout: string) => {
      for (const giveUpAt = Date.now() + SHOWN_WITHIN_MS; Date.now() < giveUpAt && (await inWorkspace(bash)).stdout !== stdout; ) await Bun.sleep(100);
      expect((await inWorkspace(bash)).stdout).toBe(stdout);
    };
    writeFileSync(at("src/shown.txt"), "one\n");
    await isShown("cat src/shown.txt CLAUDE.md", "one\nthe owner's\n");
    writeFileSync(at("src/shown.txt"), "two, longer\n");
    write(at("CLAUDE.md.tmp"), "the owner's, anew\n");
    renameSync(at("CLAUDE.md.tmp"), at("CLAUDE.md"));
    renameSync(at("src/shown.txt"), at("src/moved.txt"));
    write(at("src/made/by-the-owner.txt"), "here\n");
    await isShown("cat src/moved.txt CLAUDE.md src/made/by-the-owner.txt; ls src/shown.txt", "two, longer\nthe owner's, anew\nhere\n");
    await inWorkspace("echo mine > src/made/by-the-agent.txt && chmod 750 src/made/by-the-agent.txt");
    const { uid, mode } = statSync(at("src/made/by-the-agent.txt"));
    expect([uid, mode & 0o777]).toEqual([process.getuid!(), 0o750]);
    expect(readFileSync(at("src/made/by-the-agent.txt"), "utf8")).toBe("mine\n");
  });

  test("guards a folder added read and write as the workspace, with nothing moved or linked between the two", async () => {
    const { library, at, asAgent } = sandbox;
    const told = await asAgent(["bash", "-c", `cd '${library}' && echo more >> lib.txt && git status --porcelain; mv lib.txt '${at("src/from-library.txt")}' && ls; ln '${at("src/a.txt")}' linked; echo x >> .git/config; mkdir nested nested/.git; echo x > .git/hooks/pre-commit`]);
    expect(told.stdout).toBe(" M lib.txt\n");
    expect(told.stderr.trim().split("\n").map((line) => line.replace(/^.*: /, ""))).toEqual(["Invalid cross-device link", "Read-only file system", "Read-only file system", "Read-only file system"]);
    expect(readFileSync(at("src/from-library.txt"), "utf8")).toBe("lib\nmore\n");
    expect(readdirSync(library).toSorted()).toEqual([".git", "nested"]);
  });

  test("protects what the owner replaces meanwhile, however often, whatever stands there at the moment", async () => {
    const { workspace, at, aside, asAgent } = sandbox;
    const racing = asAgent(["bash", "-s", "--", workspace, String(RACE_S)], script("race.sh"));
    const endsAt = Date.now() + RACE_S * 1000;
    for (let turn = 0; Date.now() < endsAt; turn++) {
      git(workspace, "config", "mirador.turn", String(turn));
      git(at("vendor/lib"), "config", "mirador.turn", String(turn));
      for (const path of ["CLAUDE.md", "pkg/CLAUDE.md"]) {
        write(at(`${path}.owners-own`), `the owner's, turn ${turn}\n`);
        renameSync(at(`${path}.owners-own`), at(path));
      }
      for (const folder of [".git/hooks", ".claude"]) {
        renameSync(at(folder), aside);
        await Bun.sleep(5);
        renameSync(aside, at(folder));
      }
      rmSync(at("CLAUDE.md"));
      await Bun.sleep(5);
      write(at("CLAUDE.md"), `the owner's, turn ${turn}\n`);
    }
    const { stdout, exitCode } = await racing;
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\d{2,} attempts\n$/);
    for (const file of [".git/config", "vendor/lib/.git/config", "CLAUDE.md", "pkg/CLAUDE.md", ".claude/settings.json"]) expect(readFileSync(at(file), "utf8"), file).not.toContain("planted");
    expect([".claude/planted", ".git/hooks/post-checkout", "pkg/.git"].filter((path) => existsSync(at(path)))).toEqual([]);
    expect(readdirSync(at("src")).filter((name) => name.startsWith("planted"))).toEqual(["planted"]);
  });

  test("leaves the owner's own work as it was: git there runs nothing an agent made, and nothing of the guard stays once the VM stopped", async () => {
    git(sandbox.workspace, "status", "--short");
    git(sandbox.workspace, "fsck");
    await sandbox.stop();
    expect(readdirSync(sandbox.toldGuards)).toEqual([]);
  });
});

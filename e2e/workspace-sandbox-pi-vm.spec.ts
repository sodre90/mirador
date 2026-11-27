import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, clickWorkspaceButton, createProfile, lastAgentMessage, sendMessage, signIn, waitForTurnToEnd, workspaceCard } from "./helpers.ts";
import { modelServerStatus, ownersModelServer } from "./model-server.ts";
import { BUN_IN_VM } from "./sandbox-vm-tools.ts";
import { TestHost } from "./test-host.ts";

/**
 * A sandboxed workspace's pi agent on Apple's real `container`, opted into with MIRADOR_SANDBOX_VM_E2E=1 on macOS 26 on
 * Apple silicon: it sets the sandbox up on this Mac, its base image and tools, and a real pi turn runs in the VM on the
 * owner's model server, set up in a pi agent folder made for the test, its key in the host's environment alone; then a
 * Claude Code turn runs in the same VM beside it.
 */
const containerProgram = ["/usr/local/bin/container", "/opt/homebrew/bin/container"].find((path) => existsSync(path));
const sandboxesRunHere = process.platform === "darwin" && process.arch === "arm64" && Number(release().split(".")[0]) >= 25;
const optedIn = process.env.MIRADOR_SANDBOX_VM_E2E === "1";
/** The pi installed in the sandbox's tools folder, as npm has it; the host asks the profile's pi for it. */
const PI_VERSION = "1.6.0";
const MODEL = "radiance-qwen3.8-flash-next";

const host = new TestHost({ environment: () => ({ MIRADOR_SANDBOX: containerProgram ?? "off" }) });
const modelKey = () => ownersModelServer().ANTHROPIC_AUTH_TOKEN ?? "";
const piAgent = () => join(host.root, "pi-agent");
const piSayingItsVersion = () => join(host.root, "fake-pi", "pi");
const container = (...args: string[]) => execFileSync(containerProgram!, args, { encoding: "utf8", timeout: 60_000 });
const hostLabel = () => createHash("sha256").update(host.dataDir).digest("hex").slice(0, 10);
const ourVms = () =>
  (JSON.parse(container("list", "--all", "--format", "json")) as { configuration: { id: string; labels?: Record<string, string> } }[]).flatMap(({ configuration }) =>
    configuration.labels?.["mirador.host"] === hostLabel() ? [configuration.id] : [],
  );
const asAgent = (vm: string, ...command: string[]) => container("exec", "--user", "1000:1000", "-w", realpathSync(host.projectDir), vm, ...command);

test.describe.configure({ mode: "serial" });
test.skip(!optedIn || !containerProgram || !sandboxesRunHere, "Set MIRADOR_SANDBOX_VM_E2E=1 on macOS 26 on Apple silicon with Apple's container installed.");

/** The test's own pi agent folder: the model server as a models.json provider, its key named by the variable the host has it in. */
function writePiAgentFolder() {
  mkdirSync(piAgent(), { recursive: true });
  const provider = { api: "openai-completions", baseUrl: `${ownersModelServer().ANTHROPIC_BASE_URL}/v1`, apiKey: "$ANTHROPIC_AUTH_TOKEN", models: [{ id: MODEL, name: "E2E model", input: ["text"] }] };
  writeFileSync(join(piAgent(), "models.json"), JSON.stringify({ providers: { "e2e-server": provider } }));
  writeFileSync(join(piAgent(), "settings.json"), JSON.stringify({ defaultProvider: "e2e-server", defaultModel: MODEL }));
  mkdirSync(join(host.root, "fake-pi"), { recursive: true });
  writeFileSync(piSayingItsVersion(), `#!/bin/sh\necho ${PI_VERSION}\n`);
  chmodSync(piSayingItsVersion(), 0o755);
}

test.beforeAll(async () => {
  mkdirSync(host.projectDir, { recursive: true });
  writeFileSync(join(host.projectDir, "README.md"), "A workspace for pi's sandbox.\n");
  execFileSync("git", ["init", "-q", host.projectDir]);
  writePiAgentFolder();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  if (optedIn && containerProgram && sandboxesRunHere) expect(ourVms()).toEqual([]);
  await host.cleanUp();
});

function filesUnder(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Every environment and command line of the VM's processes the agent user can read, in base64, and the user ids pi runs as. */
const PROCESSES_SCRIPT = `
const fs = require("fs");
const read = (path) => { try { return fs.readFileSync(path, "latin1"); } catch { return ""; } };
const pids = fs.readdirSync("/proc").filter((name) => /^\\d+$/.test(name) && name !== String(process.pid));
const uidOf = (pid) => (read("/proc/" + pid + "/status").match(/^Uid:\\s+(\\d+)/m) || [])[1];
const agents = pids.filter((pid) => /pi-acp|pi\\.sh|\\bpi\\b/.test(read("/proc/" + pid + "/cmdline").replaceAll("\\0", " ")));
const seen = pids.flatMap((pid) => [read("/proc/" + pid + "/environ"), read("/proc/" + pid + "/cmdline")]).join("\\n");
console.log(JSON.stringify({ agentUids: agents.map(uidOf), seen: Buffer.from(seen).toString("base64") }));
`;

/** The kinds of agent whose processes run in the VM, by their ACP adapters. */
const AGENT_KINDS_SCRIPT = `
const fs = require("fs");
const read = (path) => { try { return fs.readFileSync(path, "latin1"); } catch { return ""; } };
const commands = fs.readdirSync("/proc").filter((name) => /^\\d+$/.test(name)).map((pid) => read("/proc/" + pid + "/cmdline"));
console.log(JSON.stringify(["claude-agent-acp/", "pi-acp/"].filter((adapter) => commands.some((command) => command.includes(adapter)))));
`;

const ANSWERS_SCRIPT = `
const answer = (url) => fetch(url).then(async (response) => response.status + " " + (await response.text()).trim().slice(0, 40), (error) => String(error.cause?.code ?? error.message));
const urls = JSON.parse(process.argv[1]);
Promise.all(urls.map(answer)).then((answers) => console.log(JSON.stringify(answers)));
`;

test("a sandboxed workspace's pi agent answers from its VM, on a model of its models.json reached through Mirador, with no key in the VM", async ({ page }) => {
  test.setTimeout(40 * 60_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "Piper", `PI_CODING_AGENT_DIR=${piAgent()}\nPI_ACP_PI_COMMAND=${piSayingItsVersion()}\nPI_OFFLINE=1`, "", "pi");
  await profiles.getByRole("button", { name: "Close" }).click();
  const card = workspaceCard(page, host.projectDir);
  await card.getByLabel("Agent", { exact: true }).selectOption({ label: "Piper · pi" });

  await clickWorkspaceButton(card, "Sandbox…");
  const dialog = page.getByRole("dialog", { name: "Sandbox for project" });
  await expect(dialog.getByText("Checking whether this workspace can have a sandbox…")).toBeHidden();
  await expect(dialog.locator(".workspace-sandbox-starts-on")).toHaveCount(0);
  await dialog.getByRole("switch", { name: "Run this workspace's agents in a sandbox" }).check();
  await expect(dialog.locator(".room-sandbox-setup")).toHaveText("Set up on this Mac.", { timeout: 30 * 60_000 });
  await dialog.getByRole("button", { name: "Done" }).click();

  await expect.poll(modelServerStatus, { message: "the model server answers", timeout: 180_000, intervals: [5_000] }).toBe(200);
  const previousUrl = page.url();
  await card.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await sendMessage(page, "Use your bash tool to run `ls -a`, then `printf 'written-by-pi\\n' > pi-note.txt`. Reply with the file names ls printed.");
  await waitForTurnToEnd(page, 10 * 60_000);
  await expect(lastAgentMessage(page), "pi listed the workspace from its VM").toContainText("README.md");
  await expect.poll(() => existsSync(join(host.projectDir, "pi-note.txt")) && readFileSync(join(host.projectDir, "pi-note.txt"), "utf8")).toBe("written-by-pi\n");

  const [vm] = ourVms();
  expect(vm).toBeDefined();
  const sandboxFiles = filesUnder(join(host.dataDir, "sandbox"));
  const piModelsInVm = sandboxFiles.find((path) => /\/pi\/[^/]+\/models\.json$/.test(path));

  await test.step("pi in the VM kept its session in the sandbox's own pi folder, its models.json there reaching the model through the relay with a key that is none", () => {
    expect(sandboxFiles.some((path) => /\/pi\/[^/]+\/sessions\/.+\.jsonl$/.test(path))).toBe(true);
    const { providers } = JSON.parse(readFileSync(piModelsInVm!, "utf8")) as { providers: Record<string, { baseUrl: string; apiKey: string }> };
    expect(Object.keys(providers)).toEqual(["e2e-server"]);
    expect(providers["e2e-server"]).toMatchObject({ baseUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:7702\/p\/[A-Za-z0-9-]+$/), apiKey: "kept-by-mirador" });
  });

  await test.step("the model's key is in none of the VM's processes nor the sandbox's folders, pi runs as the agent user, and the test's pi folder isn't in the VM", () => {
    const { agentUids, seen } = JSON.parse(asAgent(vm!, BUN_IN_VM, "-e", PROCESSES_SCRIPT)) as { agentUids: string[]; seen: string };
    expect(agentUids.length).toBeGreaterThan(0);
    expect(new Set(agentUids)).toEqual(new Set(["1000"]));
    expect(modelKey().length).toBeGreaterThan(8);
    expect(Buffer.from(seen, "base64").toString("latin1").includes(modelKey())).toBe(false);
    expect(sandboxFiles.some((path) => readFileSync(path, "latin1").includes(modelKey()))).toBe(false);
    expect(asAgent(vm!, "cat", "/proc/mounts")).not.toContain(piAgent());
    expect(() => asAgent(vm!, "ls", piAgent())).toThrow();
  });

  await test.step("from the VM, the model proxy goes on to the model's own API with the key added there, and refuses another API's path", () => {
    const { providers } = JSON.parse(readFileSync(piModelsInVm!, "utf8")) as { providers: Record<string, { baseUrl: string }> };
    const relay = providers["e2e-server"]!.baseUrl;
    const [models, otherApi] = JSON.parse(asAgent(vm!, BUN_IN_VM, "-e", ANSWERS_SCRIPT, JSON.stringify([`${relay}/models`, `${relay}/v1/messages`]))) as string[];
    expect(models).toMatch(/^200 /);
    expect(otherApi).toBe("404 not a path of the model API");
  });

  await test.step("a Claude Code profile's agent works in the same VM while pi's runs there, its Claude Code installed beside pi", async () => {
    const builder = await createProfile(page, "Builder", "");
    await builder.getByRole("button", { name: "Close" }).click();
    await card.getByLabel("Agent", { exact: true }).selectOption({ label: "Builder · Claude Code" });
    const piConversation = page.url();
    await card.getByRole("button", { name: "+ New conversation" }).click();
    await expect(page).not.toHaveURL(piConversation);
    await sendMessage(page, "Use your Bash tool to run `printf 'written-by-claude\\n' > claude-note.txt`. Reply with what it printed.");
    await waitForTurnToEnd(page, 10 * 60_000);
    await expect.poll(() => existsSync(join(host.projectDir, "claude-note.txt")) && readFileSync(join(host.projectDir, "claude-note.txt"), "utf8")).toBe("written-by-claude\n");
    expect(ourVms()).toEqual([vm]);
    expect(JSON.parse(asAgent(vm!, BUN_IN_VM, "-e", AGENT_KINDS_SCRIPT))).toEqual(["claude-agent-acp/", "pi-acp/"]);
    expect(asAgent(vm!, "ls", "/opt/mirador").trim().split("\n").filter((tool) => /^(claude|pi)-/.test(tool)).map((tool) => tool.split("-")[0])).toEqual(["claude", "pi"]);
  });
});

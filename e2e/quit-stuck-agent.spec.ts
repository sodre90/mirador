import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn } from "./helpers.ts";
import { processTreeOf } from "./process-tree.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const agentPidFile = join(host.root, "agent-pid");
const stubbornAgentPids: number[] = [];

const isRunning = (pid: number) => processTreeOf(pid).has(pid);

/** An opencode that is an agent of its own, taking prompts, never finishing them, and surviving SIGTERM. */
function fakeStubbornOpencode() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts"), FAKE_ACP_IGNORES_SIGTERM: "1", FAKE_ACP_PID_FILE: agentPidFile });
}

test.describe.configure({ mode: "serial" });
test.skip(
  process.platform === "win32",
  "Node ends a Windows process outright (TerminateProcess), so a spec cannot quit the host there as a signal does; the desktop app quits it with Ctrl-C",
);

test.beforeAll(async () => {
  fakeStubbornOpencode();
  writeFileSync(join(host.root, "prompts"), "");
  await host.start();
});
test.afterAll(async () => {
  stubbornAgentPids.filter(isRunning).forEach((pid) => process.kill(pid, "SIGKILL"));
  await host.stop();
  await host.cleanUp();
});

async function conversationWithRunningAgent(page: Page) {
  rmSync(agentPidFile, { force: true });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await sendMessage(page, "WEDGE hold the turn");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("running", { timeout: 30_000 });
  await expect.poll(() => existsSync(agentPidFile), { timeout: 30_000 }).toBe(true);
  const agentPid = Number(readFileSync(agentPidFile, "utf8"));
  stubbornAgentPids.push(agentPid);
  return agentPid;
}

test("quitting the host kills an agent that ignores SIGTERM before the host itself exits", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "stubborn", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "stubborn · opencode" });
  const agentPid = await conversationWithRunningAgent(page);
  expect(isRunning(agentPid)).toBe(true);

  process.kill(host.pid!, "SIGTERM");
  await expect.poll(() => isRunning(host.pid!), { timeout: 20_000 }).toBe(false);

  expect(isRunning(agentPid)).toBe(false);
});

test("a second quit signal while the host waits for a stuck agent exits at once", async ({ page }) => {
  await host.start();
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "stubborn · opencode" });
  const agentPid = await conversationWithRunningAgent(page);
  const hostPid = host.pid!;

  process.kill(hostPid, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(isRunning(hostPid)).toBe(true);
  process.kill(hostPid, "SIGTERM");

  await expect.poll(() => isRunning(hostPid), { timeout: 2_000 }).toBe(false);
  expect(isRunning(agentPid)).toBe(true);
});

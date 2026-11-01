import { spawn, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, signIn, startConversation } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted opencode";
const jobs: ChildProcess[] = [];

test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  jobs.forEach((job) => job.kill());
  await host.stop();
  await host.cleanUp();
  model.stop();
});

/** The jobs run on the Node that runs the spec, as Windows has no sh or sleep. */
const TICKING = "let i = 0; setInterval(() => console.log('tick ' + ++i), 300)";
const SLEEPING = "setTimeout(() => {}, 300000)";
const OUTPUT_UNKNOWN_ON_WINDOWS = "On Windows this tab cannot find the file its output goes to, so it only shows when the process ends.";
const onWindows = process.platform === "win32";
/** Windows gets a process's command line through WMI, which a loaded runner can make wait; the tab says it is following before asking. */
const commandLinePatience = onWindows ? 60_000 : 20_000;

/** Like a job started with `nohup … > log 2>&1 &`: it writes a line every 300 ms to its log. */
function startLoggingJob(log: string) {
  const output = openSync(log, "w");
  const job = spawn(process.execPath, ["-e", TICKING], { stdio: ["ignore", output, output] });
  jobs.push(job);
  return job;
}

function startSilentJob() {
  const job = spawn(process.execPath, ["-e", SLEEPING], { stdio: "ignore" });
  jobs.push(job);
  return job;
}

function watchSessionId(page: Page) {
  let sessionId: string | null = null;
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload));
      sessionId = message.type === "conversation.upserted" ? (message.conversation.acpSessionId ?? sessionId) : sessionId;
    }),
  );
  return () => sessionId;
}

/** What `mirador when-done --pid <pid> --no-resume` sends the host. */
async function waitForJob(sessionId: string, job: ChildProcess) {
  const response = await fetch(`${host.origin}/sessions/${sessionId}/job-waits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${host.scriptToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ job: { kind: "process", pid: job.pid }, message: "look at the results", resume: false }),
  });
  expect(response.status).toBe(201);
}

test("clicking a waited-for job follows it in a terminal tab: what it runs, then its output, until it ends", async ({ page }) => {
  const sessionId = watchSessionId(page);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page);
  await expect.poll(sessionId).not.toBeNull();

  const waits = page.getByRole("region", { name: "Jobs waited for" });
  const terminalScreen = page.locator(".terminal-pane .terminal-splits.shown .xterm-rows");
  const followTab = (job: ChildProcess) => page.locator(".terminal-tab", { hasText: `process ${job.pid}` });

  await test.step("the job's command line, running time and log file show, then its lines as it writes them", async () => {
    const job = startLoggingJob(join(host.root, "job.log"));
    await waitForJob(sessionId()!, job);
    await waits.getByRole("button", { name: `process ${job.pid}` }).click();
    await expect(followTab(job)).toBeVisible();
    if (onWindows) await expect(terminalScreen).toContainText(/Following process \d/);
    await expect(terminalScreen).toContainText("Command: ", { timeout: commandLinePatience });
    await expect(terminalScreen).toContainText(TICKING, { timeout: commandLinePatience });
    await expect(terminalScreen).toContainText(/Running for: \d\d:\d\d/);
    if (onWindows) await expect(terminalScreen).toContainText(OUTPUT_UNKNOWN_ON_WINDOWS);
    else {
      await expect(terminalScreen).toContainText(/Output: \S*job\.log/);
      await expect(terminalScreen).toContainText("tick 2");
      await expect(terminalScreen).toContainText("tick 8");
    }

    await test.step("clicking the job again shows its tab rather than opening another", async () => {
      await page.locator(".terminal-tab").filter({ hasNotText: `process ${job.pid}` }).first().click();
      await expect(followTab(job)).not.toHaveClass(/active/);
      await waits.getByRole("button", { name: `process ${job.pid}` }).click();
      await expect(followTab(job)).toHaveClass(/active/);
      await expect(followTab(job)).toHaveCount(1);
    });

    await test.step("when the job ends, the tab says so and stays until Enter", async () => {
      job.kill();
      await expect(terminalScreen).toContainText(`Process ${job.pid} ended.`);
      await expect(terminalScreen).toContainText("Press Enter to close this tab.");
      await expect(waits).toHaveCount(0);
      await page.locator(".terminal-pane .terminal-splits.shown .xterm").click();
      await page.keyboard.press("Enter");
      await expect(followTab(job)).toHaveCount(0);
    });
  });

  await test.step("a job whose output goes to no file shows what it runs; Ctrl+C closes the tab and the job runs on", async () => {
    const job = startSilentJob();
    await waitForJob(sessionId()!, job);
    await waits.getByRole("button", { name: `process ${job.pid}` }).click();
    if (onWindows) await expect(terminalScreen).toContainText(/Following process \d/);
    await expect(terminalScreen).toContainText(SLEEPING, { timeout: commandLinePatience });
    await expect(terminalScreen).toContainText(onWindows ? OUTPUT_UNKNOWN_ON_WINDOWS : "Its output goes to no file this tab can follow");
    await page.locator(".terminal-pane .terminal-splits.shown .xterm").click();
    await page.keyboard.press("Control+C");
    await expect(followTab(job)).toHaveCount(0);
    await expect(waits).toContainText(`Waiting for process ${job.pid} to end`);
    expect(job.exitCode).toBeNull();
  });
});

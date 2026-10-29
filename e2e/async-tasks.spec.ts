import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, createProfile, primaryModifier, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const logFile = join(host.root, "agent-log");

const fakeOpencode = () =>
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), {
    FAKE_ACP_PROMPTS: join(host.root, "prompts"),
    FAKE_ACP_LOG: logFile,
    FAKE_ACP_TASK_OUTPUT_DIR: host.root,
  });

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  fakeOpencode();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const stoppedLines = () => {
  try {
    return readFileSync(logFile, "utf8");
  } catch {
    return "";
  }
};

test("a background task the agent started shows with its output and Stop above the message box", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "async", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "async · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  const tasks = page.getByRole("region", { name: "Background tasks" });
  const row = tasks.locator("li");

  await test.step("the spawn shows the task running, with its Stop", async () => {
    await sendMessage(page, "ASYNC TASK");
    await waitForTurnToEnd(page);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Running:");
    await expect(row.getByRole("button", { name: "sleep 30" })).toBeVisible();
    await expect(row).toContainText("for ");
    await expect(row.getByRole("button", { name: "Stop" })).toBeVisible();
  });

  await test.step("a progress beat shows its summary, and its output file opens below", async () => {
    await expect(row).toContainText("Still running after 10s");
    await row.getByRole("button", { name: "sleep 30" }).click();
    const output = row.locator(".async-task-output");
    await expect(output).toBeVisible();
    await expect(output).toContainText("the task started");
    await expect(output, "the open output refreshes as the task writes").toContainText("still sleeping");
  });

  await test.step("Stop reaches the agent, which reports the task stopped and loses its Stop", async () => {
    await row.getByRole("button", { name: "Stop" }).click();
    await expect(row).toContainText("Stopped:");
    await expect(row.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await expect(row.getByText("Task stopped by user")).toBeVisible();
    await expect.poll(stoppedLines).toContain("stopped fake-task-");
    await expect(page.locator(".timeline:visible"), "the task lives in the panel, not the transcript").not.toContainText("sleep 30");
  });

  await test.step("a task that ends on its own shows as completed and keeps its output readable", async () => {
    await sendMessage(page, "ASYNC TASK DONE");
    await waitForTurnToEnd(page);
    await expect(row).toHaveCount(2);
    const finished = tasks.locator("li", { hasText: "Completed:" });
    await expect(finished).toHaveCount(1);
    await expect(finished).toContainText("Task completed");
    await expect(finished.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await finished.getByRole("button", { name: "sleep 30" }).click();
    await expect(finished.locator(".async-task-output")).toContainText("done sleeping");
    await expect(finished.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await finished.getByRole("button", { name: "Dismiss" }).click();
    await expect(finished).toHaveCount(0);
    await expect(row).toHaveCount(1);
  });

  await test.step("the remaining finished task can also be dismissed, removing the background tasks section", async () => {
    const remaining = tasks.locator("li", { hasText: "Stopped:" });
    await expect(remaining.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await remaining.getByRole("button", { name: "Dismiss" }).click();
    await expect(tasks).toHaveCount(0);
  });

  await test.step("Clear finished dismisses all finished tasks at once", async () => {
    await sendMessage(page, "ASYNC TASK DONE");
    await waitForTurnToEnd(page);
    await sendMessage(page, "ASYNC TASK DONE");
    await waitForTurnToEnd(page);
    await expect(row).toHaveCount(2);
    const clearButton = tasks.getByRole("button", { name: "Clear finished" });
    await expect(clearButton).toBeVisible();
    await clearButton.click();
    await expect(tasks).toHaveCount(0);
  });

  await test.step("a long command shows on one line until it is opened", async () => {
    await sendMessage(page, "ASYNC TASK LONG");
    await waitForTurnToEnd(page);
    const description = row.locator(".async-task-description");
    await expect(row).toContainText("Completed:");
    const lineHeight = await row.locator(".async-task-status > span").first().evaluate((label) => label.getBoundingClientRect().height);
    const height = () => description.evaluate((button) => button.getBoundingClientRect().height);
    expect(await height()).toBeLessThanOrEqual(lineHeight + 1);
    const durationFitsTheRow = await row.evaluate((li) => li.querySelector(".async-task-status > span:last-child")!.getBoundingClientRect().right <= li.getBoundingClientRect().right);
    expect(durationFitsTheRow, "the duration stays visible after the cut-off command").toBe(true);
    await description.click();
    await expect(row.locator(".async-task-output")).toBeVisible();
    expect(await height()).toBeGreaterThan(lineHeight * 3);
    await row.getByRole("button", { name: "Dismiss" }).click();
    await expect(tasks).toHaveCount(0);
  });

  await test.step("a Stop the agent fails on says why, and the task keeps running with its Stop", async () => {
    await sendMessage(page, "ASYNC TASK STUCK");
    await waitForTurnToEnd(page);
    await row.getByRole("button", { name: "Stop" }).click();
    await expect(page.locator(".notice")).toContainText("The task would not stop");
    await expect(row).toContainText("Running:");
    await expect(row.getByRole("button", { name: "Stop" })).toBeVisible();
  });

  await test.step("moving the conversation to another profile closes its session, and the tasks running in it go with it", async () => {
    const profiles = await createProfile(page, "async elsewhere", "", "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
    await page.getByLabel("Profile", { exact: true }).selectOption({ label: "async elsewhere" });
    await expect(page.locator(".timeline:visible")).toContainText("Now using the profile “async elsewhere”");
    await expect(tasks).toHaveCount(0);
  });
});

test("Cmd+Shift+R while a background task runs restarts the host, rather than leave it on Restarting the host…", async ({ page }) => {
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "async · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await sendMessage(page, "ASYNC TASK");
  await waitForTurnToEnd(page);
  await expect(page.getByRole("region", { name: "Background tasks" }).locator("li")).toContainText("Running:");

  const starts = () => host.log.match(/Mirador is running/g)?.length ?? 0;
  const startsBefore = starts();
  await page.keyboard.press(`${await primaryModifier(page)}+Shift+R`);
  await expect.poll(starts, { timeout: 60_000 }).toBe(startsBefore + 1);
  await expect(page.getByText("Restarting the host…")).toHaveCount(0, { timeout: 30_000 });
  expect(host.log).not.toContain("Cannot use a closed database");
});

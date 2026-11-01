import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

/** The one spec on a real model, the owner's model server; every other spec scripts Claude Code's replies with a fake API. */
const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("a real model streams its reply, asks for permission in the browser and uses a canvas tool", async ({ page }) => {
  test.setTimeout(480_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await sendMessage(
    page,
    'Use your Write tool to create a file named hello.txt in the current directory whose content is the word "hi". Then call the canvas show tool with title "Greeting" and html "<h1>Hello canvas</h1>". Then reply with the single word DONE.',
  );
  const permission = page.locator(".permission.pending");
  await expect(permission).toBeVisible({ timeout: 120_000 });
  await permission.locator("button.option-allow_once").click();
  await waitForTurnToEnd(page);
  expect(readFileSync(join(host.projectDir, "hello.txt"), "utf8")).toContain("hi");
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe").contentFrame().getByRole("heading", { name: "Hello canvas" })).toBeVisible();
  await expect(lastAgentMessage(page)).toContainText("DONE");
});

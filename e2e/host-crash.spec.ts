import { expect, test } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, sendMessage, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

test("a host killed in the middle of a turn comes back with that turn ended, not left working", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  const yolo = page.getByLabel("YOLO", { exact: true });
  await yolo.click();
  await expect(yolo).toBeChecked();
  await sendMessage(page, "RUN echo waiting; sleep 60");
  await expect(page.locator(".timeline").locator(".tool-pending, .tool-in_progress").first()).toBeVisible();

  await host.kill();
  await host.start();

  await expect(page.locator(".timeline")).toContainText("Turn ended: cancelled", { timeout: 60_000 });
  await expect(page.locator(".working")).toHaveCount(0);
});

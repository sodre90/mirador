import { expect, test } from "@playwright/test";
import { addWorkspace, removeWorkspace, signIn, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

// The desktop app's web view is WebKit, where pressing a button doesn't focus it: a confirm that has the focus loses it on mousedown.
// Chrome's channel and its audio flag don't apply to WebKit.
test.use({ browserName: "webkit", channel: "", launchOptions: {} });

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("in WebKit, a click on the confirm a menu entry raised removes the workspace", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const card = workspaceCard(page, host.projectDir);
  await removeWorkspace(page, card);
  await expect(card).toHaveCount(0);
});

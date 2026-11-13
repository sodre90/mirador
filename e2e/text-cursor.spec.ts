import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspaceFromSidebar, openSettings, signIn, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const ON_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const ON_A_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

for (const { system, userAgent, cursor } of [
  { system: "Windows", userAgent: ON_WINDOWS, cursor: /^url\("data:image\/svg\+xml,.+"\) 8 12, text$/ },
  { system: "a Mac", userAgent: ON_A_MAC, cursor: /^text$/ },
]) {
  test(`on ${system}, text fields show ${system === "Windows" ? "Mirador's own text cursor, as Windows' can come out white on white" : "the system's text cursor"}`, async ({ browser }) => {
    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();
    await signIn(page, host);
    const folder = join(host.root, `project-on-${system.replace(/\W/g, "-")}`);
    mkdirSync(folder, { recursive: true });
    await addWorkspaceFromSidebar(page, folder);
    await workspaceCard(page, folder).getByRole("button", { name: "+ New conversation" }).click();
    const messageBox = page.locator(".composer:visible").locator("textarea, [contenteditable='true']");
    await expect(messageBox).toBeVisible();
    expect(await messageBox.evaluate((field) => getComputedStyle(field).cursor)).toMatch(cursor);
    const name = (await openSettings(page, "Devices")).getByLabel("Name", { exact: true });
    expect(await name.evaluate((field) => getComputedStyle(field).cursor)).toMatch(cursor);
    await context.close();
  });
}

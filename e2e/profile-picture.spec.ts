import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, openSettings, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** A red 40×30 PNG, the kind of file a user picks: uneven, so the square crop has something to do. */
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAYAAABe3VzdAAAARklEQVR4nO3SMREAQAgDQeTgXwWueAffhmKL9Jmbreney6v0AQcVTBtjUMG0MQYVTBtjUMG0MQYVTBtjUMG0MQYVnAPOfnupucxYpsXHxQAAAABJRU5ErkJggg==",
  "base64",
);

const userPicture = (page: Page) => page.locator(".timeline:visible .avatar.user");

test("a picture set in Settings shows next to your messages on every page and reload, and comes off again", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);

  const settings = await openSettings(page);
  await expect(settings.getByRole("heading", { name: "Profile picture" })).toBeVisible();
  await settings.getByLabel("Profile picture").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a picture") });
  await expect(settings.getByRole("alert")).toHaveText("Pick an image file.");
  await expect(settings.locator(".profile-picture-preview")).toHaveCount(0);
  await settings.getByLabel("Profile picture").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PICTURE });
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await expect(settings.locator(".profile-picture-preview")).toBeVisible();

  await host.stop();
  execFileSync("bun", [
    join(import.meta.dirname, "seed-events.ts"),
    join(host.dataDir, "state.sqlite"),
    conversationId,
    JSON.stringify([{ type: "user-message", text: "hello from the seeded turn" }]),
  ]);
  await host.start();
  await reloadFromRestartedHost(page);

  const picture = userPicture(page).locator("img");
  await expect(picture).toBeVisible();
  await expect(picture).toHaveJSProperty("naturalWidth", 128);
  await expect(picture).toHaveCSS("border-radius", "7px");
  await expect(userPicture(page).locator("svg")).toHaveCount(0);

  await page.reload();
  await expect(picture).toBeVisible();

  const reopened = await openSettings(page);
  await expect(reopened.locator(".profile-picture-preview")).toBeVisible();
  await reopened.getByRole("button", { name: "Remove" }).click();
  await expect(reopened.locator(".profile-picture-preview")).toHaveCount(0);
  await reopened.getByRole("button", { name: "Close" }).click();

  await expect(userPicture(page).locator("svg")).toBeVisible();
  await expect(userPicture(page).locator("img")).toHaveCount(0);
});

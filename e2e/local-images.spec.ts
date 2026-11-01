import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const profileName = "local images";
const screenshot = join(host.root, "screenshot.png");
const notAnImage = join(host.root, "secret.png");
const spacedScreenshot = join(host.root, "Képernyőkép 1.png");

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  await host.start();
  writeFileSync(screenshot, Buffer.from(ONE_PIXEL_PNG, "base64"));
  writeFileSync(spacedScreenshot, Buffer.from(ONE_PIXEL_PNG, "base64"));
  writeFileSync(notAnImage, "TOKEN=not-an-image");
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const reply = (page: Page) => page.locator(".timeline:visible .message.agent").last();

const loadedWidth = (page: Page, name: string) => reply(page).getByRole("img", { name }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth);

async function startConversationWithTheAgent(page: Page) {
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
}

test("an image an agent names by its path on this machine shows in its reply, and a file that is not an image does not", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversationWithTheAgent(page);
  await sendMessage(page, `SAY ![sidebar](${screenshot})\n\n![spaced](<${spacedScreenshot}>)\n\n![secret](${notAnImage})`);
  await waitForTurnToEnd(page);

  await expect.poll(() => loadedWidth(page, "sidebar")).toBe(1);
  await expect.poll(() => loadedWidth(page, "spaced")).toBe(1);
  await expect.poll(() => loadedWidth(page, "secret")).toBe(0);

  const secretSource = await reply(page).getByRole("img", { name: "secret" }).getAttribute("src");
  const response = await page.request.get(new URL(secretSource!, host.origin).href);
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain("TOKEN");
});

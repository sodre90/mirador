import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, openSettings, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const profileName = "images";

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** The agent's reply, in Markdown: a chart, a badge, an image without a name, and one inlined as data. */
const imagesInReply = [
  "![build chart](https://images.invalid/chart.png)",
  "[![build](https://badges.invalid/build.svg)](https://ci.invalid/run/1)",
  "![](https://images.invalid/unnamed.png)",
  `![dot](${ONE_PIXEL_PNG})`,
].join("\n\n");

const reply = (page: Page) => page.locator(".timeline:visible .message.agent").last();

/** The stub agent offers no model to pick, so this starts the conversation without that wait. */
async function startConversationWithTheAgent(page: Page) {
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
}

/** Loads an image from another site the way the page would, and says whether the page's policy refused it. */
const refusedByPolicy = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        let refused = false;
        document.addEventListener("securitypolicyviolation", (event) => (refused ||= event.blockedURI.includes("probe.invalid")));
        const image = new Image();
        image.onerror = () => setTimeout(() => resolve(refused), 300);
        image.src = `https://probe.invalid/${crypto.randomUUID()}.png`;
      }),
  );

test("images from other sites in an agent's Markdown show as links naming the site until Settings lets them load", async ({ page }) => {
  const requestsToOtherSites: string[] = [];
  page.on("request", (request) => new URL(request.url()).hostname.endsWith(".invalid") && requestsToOtherSites.push(request.url()));
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversationWithTheAgent(page);
  await sendMessage(page, `SAY ${imagesInReply}`);
  await waitForTurnToEnd(page);

  await test.step("by default each shows as a link to the image, named for its site, and nothing is fetched from that site", async () => {
    const chart = reply(page).getByRole("link", { name: "build chart (image from images.invalid)" });
    await expect(chart).toHaveAttribute("href", "https://images.invalid/chart.png");
    await expect(reply(page).getByRole("link", { name: "Image from images.invalid", exact: true })).toBeVisible();
    await expect(reply(page).locator("img")).toHaveCount(1);
    await expect(reply(page).getByRole("img", { name: "dot" })).toBeVisible();
    expect(requestsToOtherSites).toEqual([]);
  });

  await test.step("a badge keeps its own link, with the image named inside it rather than a second link", async () => {
    const badge = reply(page).getByRole("link", { name: "badges.invalid" });
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveAttribute("href", "https://ci.invalid/run/1");
    await expect(badge).toHaveText("build (image from badges.invalid)");
  });

  await test.step("the page itself refuses an image from another site, whatever renders it", async () => {
    expect(await refusedByPolicy(page)).toBe(true);
  });

  await test.step("Settings lets them load from the next reload on", async () => {
    const settings = await openSettings(page, "Conversations");
    const asLinks = settings.getByRole("checkbox", { name: "Show images from other sites as links" });
    await expect(asLinks).toBeChecked();
    await asLinks.uncheck();
    await expect(settings.getByText("They load after a reload.")).toBeVisible();
    await expect(reply(page).locator("img")).toHaveCount(1);
    const chartRequested = page.waitForRequest("https://images.invalid/chart.png");
    await settings.getByRole("button", { name: "Reload" }).click();
    await chartRequested;
    await expect(reply(page).getByRole("img", { name: "build chart" })).toHaveAttribute("src", "https://images.invalid/chart.png");
    expect(await refusedByPolicy(page)).toBe(false);
  });

  await test.step("turning it back on shows them as links again at once", async () => {
    const settings = await openSettings(page, "Conversations");
    await settings.getByRole("checkbox", { name: "Show images from other sites as links" }).check();
    await expect(settings.getByText("They load after a reload.")).toHaveCount(0);
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(reply(page).getByRole("link", { name: "build chart (image from images.invalid)" })).toBeVisible();
    expect(await refusedByPolicy(page)).toBe(true);
  });
});

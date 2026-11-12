import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const profileName = "app-open";

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "apps", "counter"), join(host.dataDir, "plugins", "counter"), { recursive: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  mkdirSync(join(host.projectDir, "plans"), { recursive: true });
  writeFileSync(join(host.projectDir, "plans", "tally.json"), JSON.stringify({ count: 5 }));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const composer = (page: Page) => page.locator(".composer:visible textarea");
const appToggle = (page: Page) => page.locator(".canvas-header:visible .app-toggle");
const view = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.app iframe");
const problem = (page: Page) => page.locator(".composer-problem:visible");

test("the user opens an installed app on a file with /<app>:open, picking the file from the path menu, without the agent", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  await test.step("the slash menu offers the app's open, which writes itself out for the file", async () => {
    await composer(page).fill("/count");
    const picked = page.getByRole("listbox", { name: "Slash commands" }).locator('[aria-selected="true"]');
    await expect(picked.locator(".slash-command-name")).toHaveText("/counter:open");
    await expect(picked.locator(".slash-command-description")).toHaveText("Open Counter on a file of this workspace");
    await expect(picked.locator(".slash-command-hint")).toHaveText("<file>");
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue("/counter:open ");
  });

  await test.step("the path menu suggests the workspace's files right after the command, without an @", async () => {
    const paths = page.getByRole("listbox", { name: "Paths" });
    await expect(paths.getByRole("option", { name: "plans/" }), "the menu opens as soon as the command is written out").toBeVisible();
    await composer(page).pressSequentially("pla");
    await expect(paths.locator('[aria-selected="true"]')).toHaveText("plans/");
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue("/counter:open plans/");
    await expect(paths.locator('[aria-selected="true"]')).toHaveText("plans/tally.json");
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue("/counter:open plans/tally.json ");
    await expect(paths).toHaveCount(0);
  });

  await test.step("Enter opens the app on the file in this conversation's canvas, and the agent hears nothing of it", async () => {
    await composer(page).press("Enter");
    await expect(appToggle(page)).toHaveText("Counter");
    await expect(view(page).locator("#count")).toHaveText("5");
    await expect(composer(page)).toHaveValue("");
    await expect(page.locator(".timeline:visible .message.user")).toHaveCount(0);
    expect(readFileSync(promptsFile, "utf8")).toBe("");
  });

  await test.step("without a file, or with one outside the workspace, it says so and keeps the message", async () => {
    await composer(page).fill("/counter:open  ");
    await composer(page).press("Enter");
    await expect(problem(page)).toHaveText(/Write the file to open after \/counter:open\./);
    await composer(page).fill("/counter:open ../elsewhere.json");
    await expect(page.getByRole("listbox", { name: "Paths" }), "no file there to suggest, so Enter goes to the command").toHaveCount(0);
    await composer(page).press("Enter");
    await expect(problem(page)).toContainText("outside the workspace");
    await expect(composer(page)).toHaveValue("/counter:open ../elsewhere.json");
    await expect(view(page).locator("#count")).toHaveText("5");
  });

  await test.step("while a task runs on the file for this conversation alone, opening another is refused and the task goes on; once it's stopped, the same message opens it", async () => {
    writeFileSync(join(host.projectDir, "other.json"), JSON.stringify({ count: 9 }));
    await view(page).getByRole("button", { name: "Wait" }).click();
    await expect(view(page).locator("#task")).toHaveText("wait running (waiting)");
    await composer(page).fill("/counter:open other.json ");
    await expect(page.getByRole("listbox", { name: "Paths" })).toHaveCount(0);
    await composer(page).press("Enter");
    await expect(problem(page)).toContainText("Wait until stopped is still running; wait for it to end, or stop it, before opening another file.");
    await expect(composer(page)).toHaveValue("/counter:open other.json ");
    await expect(view(page).locator("#count")).toHaveText("5");
    await expect(view(page).locator("#task")).toHaveText("wait running (waiting)");
    await view(page).getByRole("button", { name: "Stop the task" }).click();
    await expect(view(page).locator("#task")).toHaveText("wait stopped (waiting)");
    await composer(page).press("Enter");
    await expect(view(page).locator("#count")).toHaveText("9");
    await expect(composer(page)).toHaveValue("");
  });
});

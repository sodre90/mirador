import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, primaryModifier, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { ScriptedModel, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const model = new ScriptedModel();
const PROFILE = "scripted opencode";
const PULL_REQUEST = "https://github.com/team/repo/pull/5";

// The second test uses the conversation and the template the first one leaves.
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  mkdirSync(host.projectDir, { recursive: true });
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

const templatesButton = (page: Page) => page.locator(".composer").getByRole("button", { name: "Templates" });
const picker = (page: Page) => page.getByRole("dialog", { name: "Prompt templates" });

async function chooseTemplate(page: Page, name: string) {
  await templatesButton(page).click();
  await picker(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
}

test("a prompt template asks for its parameters, then goes out or into the message box; Settings add, change and delete them for every window", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, PROFILE, scriptedOpencodeEnvironment(model, host.root), "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${PROFILE} · opencode` });
  await startConversation(page);
  const composer = page.locator(".composer textarea");
  await composer.fill("a draft to keep");

  await test.step("the default deep review sends once its pull request is filled in, and leaves the draft alone", async () => {
    await chooseTemplate(page, "Deep PR review");
    const send = picker(page).getByRole("button", { name: "Send" });
    await expect(send).toBeDisabled();
    await picker(page).getByLabel("Pull request").fill(PULL_REQUEST);
    await expect(picker(page).getByLabel("Message to send")).toContainText(`Review ${PULL_REQUEST} in depth,`);
    await picker(page).getByLabel("Pull request").press("Enter");
    await expect(picker(page)).toHaveCount(0);
    await expect(page.locator(".message.user").last()).toContainText(`Review ${PULL_REQUEST} in depth, and check out the code in a worktree`);
    await expect(composer).toHaveValue("a draft to keep");
    await expect(composer).toBeFocused();
    await waitForTurnToEnd(page);
  });

  await test.step("or goes into the message box after the draft; Esc and a click outside close the templates", async () => {
    await chooseTemplate(page, "Deep PR review");
    await picker(page).getByLabel("Pull request").fill(PULL_REQUEST);
    await picker(page).getByRole("button", { name: "Put in the message box" }).click();
    await expect(composer).toHaveValue(new RegExp(`^a draft to keep\\n\\nReview ${PULL_REQUEST.replaceAll(".", "\\.")} in depth,`));
    await templatesButton(page).click();
    await page.keyboard.press("Escape");
    await expect(picker(page)).toHaveCount(0);
    await templatesButton(page).click();
    await page.locator(".timeline").click({ position: { x: 5, y: 5 } });
    await expect(picker(page)).toHaveCount(0);
  });

  const settings = page.getByRole("dialog", { name: "Settings" });
  const templateList = settings.getByRole("list", { name: "Prompt templates" });

  await test.step("Manage templates opens Settings at the templates, where a new one is made with its parameter", async () => {
    await templatesButton(page).click();
    await picker(page).getByRole("button", { name: "Manage templates…" }).click();
    await expect(settings.getByRole("heading", { name: "Prompt templates" })).toBeInViewport();
    await templateList.getByText("+ New template").click();
    await settings.getByLabel("Template name").fill("Explain a file");
    await settings.getByLabel("Template text").fill("Explain {{Path}} line by line, then {{ Path }} again.");
    await expect(settings.getByText("Asks for: Path.")).toBeVisible();
    await settings.getByRole("button", { name: "Create template" }).click();
    await expect(templateList.locator("li.selected")).toHaveText("Explain a file");
  });

  await test.step("another window has it at once; a renamed one shows renamed, and a deleted default stays deleted", async () => {
    const otherWindow = await page.context().newPage();
    await otherWindow.goto(page.url());
    await chooseTemplate(otherWindow, "Explain a file");
    await picker(otherWindow).getByLabel("Path").fill("web/App.tsx");
    await expect(picker(otherWindow).getByLabel("Message to send")).toHaveText("Explain web/App.tsx line by line, then web/App.tsx again.");
    await settings.getByLabel("Template name").fill("Explain a path");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(templateList.locator("li")).toHaveText(["Code tour", "Deep PR review", "Explain a path", "Start on a ticket", "+ New template"]);
    await templateList.getByText("Deep PR review").click();
    await settings.getByRole("button", { name: "Delete template" }).click();
    await settings.getByRole("button", { name: "Confirm: Delete template" }).click();
    await expect(templateList.locator("li")).toHaveText(["Code tour", "Explain a path", "Start on a ticket", "+ New template"]);
    await otherWindow.reload();
    await templatesButton(otherWindow).click();
    await expect(picker(otherWindow).locator(".template-choice-name")).toHaveText(["Code tour", "Explain a path", "Start on a ticket"]);
    await otherWindow.close();
  });
});

test("⌘J finds a template by typing and puts it in at the caret with its first value selected; Tab and Shift+Tab go through the values", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await page.locator(".conversation-title").first().click();
  const composer = page.locator(".composer:visible textarea");
  const finder = page.getByRole("dialog", { name: "Find a prompt template" });
  const query = finder.getByLabel("Find a template");
  const selected = () => composer.evaluate((box: HTMLTextAreaElement) => box.value.slice(box.selectionStart, box.selectionEnd));
  const findTemplate = async () => composer.press(`${await primaryModifier(page)}+KeyJ`);
  await composer.fill("Please: ");

  await test.step("Esc puts the finder away and goes back to the message box", async () => {
    await findTemplate();
    await expect(query).toBeFocused();
    await query.press("Escape");
    await expect(finder).toHaveCount(0);
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("Please: ");
  });

  await test.step("typing narrows the templates, and Enter puts the picked one in with its first value selected", async () => {
    await findTemplate();
    await query.fill("nothing like it");
    await expect(finder).toContainText("No template has that.");
    await query.fill("line by");
    await expect(finder.getByRole("option")).toHaveCount(1);
    await expect(finder.getByRole("option")).toContainText("Explain a path");
    await query.press("Enter");
    await expect(finder).toHaveCount(0);
    await expect(composer).toHaveValue("Please: Explain {{Path}} line by line, then {{ Path }} again.");
    await expect(composer).toBeFocused();
    await expect.poll(selected).toBe("{{Path}}");
  });

  await test.step("Tab and Shift+Tab go from value to value, and Tab goes on from one just typed", async () => {
    await composer.press("Tab");
    await expect.poll(selected).toBe("{{ Path }}");
    await composer.press("Shift+Tab");
    await expect.poll(selected).toBe("{{Path}}");
    await page.keyboard.type("web/App.tsx");
    await composer.press("Tab");
    await expect.poll(selected).toBe("{{ Path }}");
    await page.keyboard.type("it");
    await expect(composer).toHaveValue("Please: Explain web/App.tsx line by line, then it again.");
    await composer.press("Tab");
    await expect(composer).not.toBeFocused();
  });
});

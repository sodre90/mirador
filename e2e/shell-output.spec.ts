import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, chooseInSettings, openSettings, reloadFromRestartedHost, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const shellCommand = (toolCallId: string, description: string, command: string, status: "completed" | "failed", output: string) => ({
  type: "acp",
  update: {
    sessionUpdate: "tool_call",
    toolCallId,
    title: command,
    kind: "execute",
    status,
    rawInput: { command, description },
    content: [{ type: "content", content: { type: "text", text: output } }],
  },
});

const checkedTheBuild = [
  { type: "user-message", text: "Check the build" },
  shellCommand("toolu_tests", "Run the unit tests", "bun test", "completed", "12 pass"),
  shellCommand("toolu_types", "Type check", "bunx tsc --noEmit", "failed", "error TS2322"),
  { type: "turn-end", stopReason: "end_turn" },
];

async function addWorkspaceOnce(page: Page) {
  const addProject = page.getByRole("button", { name: "+ Add a project directory" });
  await expect(addProject.or(workspaceCard(page, host.projectDir))).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
}

test("a shell command the agent ran shows what ran with its output a click away, unless Settings show it another way", async ({ page }) => {
  await signIn(page, host);
  await addWorkspaceOnce(page);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify(checkedTheBuild)]);
  await host.start();
  await reloadFromRestartedHost(page);
  const card = (description: string) => page.locator(".timeline .shell", { hasText: description });
  const tests = card("Run the unit tests");
  const typeCheck = card("Type check");

  await test.step("each starts with its command and without its output, and a click shows the output", async () => {
    await expect(tests.locator(".shell-typed")).toHaveText("bun test");
    await expect(tests.locator(".shell-output")).toBeHidden();
    await expect(typeCheck.locator(".shell-exit")).toBeVisible();
    await expect(typeCheck.locator(".shell-output")).toBeHidden();
    await tests.locator("summary").click();
    await expect(tests.locator(".shell-output")).toHaveText("12 pass");
    const command = (await tests.locator("summary").boundingBox())!;
    const output = (await tests.locator(".shell-body.below-command").boundingBox())!;
    expect(output.y).toBeCloseTo(command.y + command.height, 0);
  });

  await test.step("output open when it failed opens the failed command", async () => {
    await chooseInSettings(page, "Shell commands", "Command, output open when it failed");
    await expect(typeCheck.locator(".shell-output")).toHaveText("error TS2322");
    await expect(typeCheck.locator(".shell-output")).toBeVisible();
  });

  await test.step("one line keeps the command a click away too", async () => {
    await chooseInSettings(page, "Shell commands", "One line");
    await expect(typeCheck.locator(".shell-description")).toBeVisible();
    await expect(typeCheck.locator(".shell-typed")).toBeHidden();
    await typeCheck.locator("summary").click();
    await expect(typeCheck.locator(".shell-typed")).toHaveText("bunx tsc --noEmit");
  });

  await test.step("command and output shows everything, as before", async () => {
    await chooseInSettings(page, "Shell commands", "Command and output");
    await page.reload();
    await expect(tests.locator(".shell-output")).toBeVisible();
    await expect(typeCheck.locator(".shell-output")).toBeVisible();
  });
});

test("shell blocks follow the theme until Settings give them other colours, a font or a size, kept after a reload", async ({ page }) => {
  await signIn(page, host);
  await addWorkspaceOnce(page);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify(checkedTheBuild)]);
  await host.start();
  await reloadFromRestartedHost(page);
  const block = page.locator(".timeline .shell", { hasText: "Run the unit tests" }).locator(".shell-body").first();
  const shown = (property: "backgroundColor" | "color" | "fontFamily" | "fontSize") => block.evaluate((element, name) => getComputedStyle(element)[name], property);
  const promptColour = () => block.locator(".shell-prompt").evaluate((element) => getComputedStyle(element).color);

  await test.step("with nothing chosen, a block takes the theme's colours, light and dark", async () => {
    await expect(block).toBeVisible();
    expect(await shown("backgroundColor")).toBe("rgb(255, 255, 255)");
    expect(await shown("color")).toBe("rgb(43, 45, 51)");
    await chooseInSettings(page, "Theme", "Dark");
    await expect.poll(() => shown("backgroundColor")).toBe("rgb(18, 19, 23)");
    expect(await shown("color")).toBe("rgb(208, 210, 216)");
    await chooseInSettings(page, "Theme", "Light");
  });

  await test.step("a preset restyles the blocks already shown", async () => {
    await chooseInSettings(page, "Shell colours", "Terminal dark");
    await expect.poll(() => shown("backgroundColor")).toBe("rgb(22, 23, 28)");
    expect(await shown("color")).toBe("rgb(215, 217, 224)");
    await chooseInSettings(page, "Shell colours", "Paper");
    await expect.poll(() => shown("backgroundColor")).toBe("rgb(251, 248, 241)");
  });

  await test.step("Custom takes the colours picked, and Reset colours goes back to its starting ones", async () => {
    const settings = await openSettings(page);
    await expect(settings.getByLabel("Background")).toHaveCount(0);
    await settings.getByRole("radiogroup", { name: "Shell colours" }).getByRole("radio", { name: "Custom" }).click();
    await settings.getByLabel("Background").fill("#203040");
    await settings.getByLabel("Text", { exact: true }).fill("#f0e0d0");
    await settings.getByLabel("Prompt").fill("#ff8800");
    await expect.poll(() => shown("backgroundColor")).toBe("rgb(32, 48, 64)");
    expect(await shown("color")).toBe("rgb(240, 224, 208)");
    expect(await promptColour()).toBe("rgb(255, 136, 0)");
    await settings.getByRole("button", { name: "Reset colours" }).click();
    await expect.poll(() => shown("backgroundColor")).toBe("rgb(42, 44, 51)");
    await settings.getByLabel("Background").fill("#203040");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await test.step("a font named in Settings and a larger size show at once, and something that is no font name is refused", async () => {
    const settings = await openSettings(page);
    const font = settings.getByLabel("Shell font");
    await font.fill("Courier New");
    await expect.poll(() => shown("fontFamily")).toMatch(/^"Courier New", /);
    await font.fill("Menlo; color: red");
    await expect(font).toHaveAttribute("aria-invalid", "true");
    expect(await shown("fontFamily")).toMatch(/^"Courier New", /);
    await font.fill("Courier New");
    await settings.getByLabel("Shell text size").selectOption("120%");
    await expect.poll(() => shown("fontSize")).toBe("15px");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await test.step("the choices are kept after a reload, and Reset font brings back the monospace font at its size", async () => {
    await page.reload();
    await expect.poll(() => shown("backgroundColor")).toBe("rgb(32, 48, 64)");
    expect(await shown("fontFamily")).toMatch(/^"Courier New", /);
    expect(await shown("fontSize")).toBe("15px");
    const settings = await openSettings(page);
    await expect(settings.getByLabel("Shell font")).toHaveValue("Courier New");
    await settings.getByRole("button", { name: "Reset font" }).click();
    await expect(settings.getByLabel("Shell font")).toHaveValue("");
    await expect.poll(() => shown("fontFamily")).toMatch(/^ui-monospace, /);
    expect(await shown("fontSize")).toBe("12.5px");
  });
});

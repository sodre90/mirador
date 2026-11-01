import { sep } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, signIn, startConversation } from "./helpers.ts";
import { echo, setVariable, sum, variableOr } from "./terminal-shell.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const screen = (page: Page) => page.locator(".terminal-pane .xterm-rows");

async function runInTerminal(page: Page, command: string) {
  await page.locator(".terminal-pane .xterm").click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

test("a terminal opens under the canvas in the workspace folder, keeps its shell while hidden and after a reload, and can start a new one after exit", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await callCanvasTool(host, conversationId, "show", { title: "Drawing", html: "<h1>canvas</h1>" });
  await expect(page.locator(".canvas-panel:visible .canvas-frame.show iframe")).toBeVisible();

  await page.getByRole("button", { name: "Show terminal" }).click();
  await runInTerminal(page, `pwd; ${echo(`marker-${sum("6*7")}`)}`);
  await expect(screen(page)).toContainText(`${sep}project`);
  await expect(screen(page)).toContainText("marker-42");
  await expect(page.locator(".terminal-pane .xterm")).toHaveCSS("padding-top", "0px");
  const primary = (await page.evaluate(() => navigator.userAgent.includes("Mac"))) ? "Meta" : "Control";
  await page.keyboard.press(`${primary}+k`);
  await expect(page.getByPlaceholder(/Go to a conversation/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder(/Go to a conversation/)).toHaveCount(0);
  await expect(screen(page)).not.toContainText("$ k");

  const canvasBox = (await page.locator(".canvas-panel:visible").boundingBox())!;
  const terminalBox = (await page.locator(".terminal-pane").boundingBox())!;
  expect(terminalBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height - 1);
  expect(Math.abs(terminalBox.x - canvasBox.x)).toBeLessThan(2);

  await runInTerminal(page, setVariable("SURVIVOR", "still-here"));
  await page.getByRole("button", { name: "Hide terminal" }).click();
  await expect(page.locator(".terminal-pane")).toHaveCount(0);
  await page.getByRole("button", { name: "Show terminal" }).click();
  await expect(screen(page)).toContainText("marker-42");
  await runInTerminal(page, echo("$SURVIVOR"));
  await expect(screen(page)).toContainText("still-here");

  await page.reload();
  await expect(page.getByRole("button", { name: "Hide terminal" })).toBeVisible();
  await expect(screen(page)).toContainText("marker-42");
  await runInTerminal(page, echo("again-$SURVIVOR"));
  await expect(screen(page)).toContainText("again-still-here");

  await runInTerminal(page, "exit");
  await page.getByRole("button", { name: "Start a shell" }).click();
  await runInTerminal(page, echo(`fresh-${variableOr("SURVIVOR", "shell")}`));
  await expect(screen(page)).toContainText("fresh-shell");
});

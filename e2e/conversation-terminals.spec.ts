import { sep } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { echo, setVariable, shellPid, sum, variableOr } from "./terminal-shell.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const screen = (page: Page) => page.locator(".terminal-pane .xterm-rows");
const tabs = (page: Page) => page.locator(".terminal-pane").getByRole("tab");

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function runInTerminal(page: Page, command: string) {
  await page.locator(".terminal-pane .xterm").click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

test("each conversation of a workspace has terminals of its own, which keep running while another conversation is shown, close when it is deleted, and come back as new shells under their output after a restart", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const first = await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  await runInTerminal(page, `${setVariable("MARK", "first-shell")}; ${echo(`first-${sum("20+1")}`)}`);
  await expect(screen(page)).toContainText("first-21");
  await expect(page.getByRole("button", { name: "Hide terminal" })).toHaveAttribute("data-hint", /^Hide or show this conversation's terminals/);
  await expect(page.locator(".terminal-pane").getByRole("button", { name: "New terminal tab" })).toHaveAttribute("data-hint", /^Open a shell in a new tab of this conversation's terminals/);

  const second = await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  await expect(tabs(page)).toHaveCount(1);
  await runInTerminal(page, `pwd; ${echo(`mark-${variableOr("MARK", "unset")} shell-${shellPid}`)}`);
  await expect(screen(page)).toContainText("mark-unset");
  const secondShell = Number((await screen(page).textContent())!.match(/mark-unset shell-(\d+)/)![1]);
  await expect(screen(page)).toContainText(`${sep}project`);
  await expect(screen(page)).not.toContainText("first-21");

  await page.goto(`${host.origin}/#/c/${first}`);
  await expect(screen(page)).toContainText("first-21");
  await expect(tabs(page)).toHaveCount(1);
  await runInTerminal(page, echo("mark-$MARK"));
  await expect(screen(page)).toContainText("mark-first-shell");

  await page.goto(`${host.origin}/#/c/${second}`);
  expect(isRunning(secondShell)).toBe(true);
  const deleteButton = page.locator(".workspace li.selected").getByRole("button", { name: "Delete conversation" });
  await deleteButton.click();
  await deleteButton.click();
  await expect.poll(() => isRunning(secondShell)).toBe(false);

  await test.step("after a restart, the first conversation's tab shows what its shell printed, out of the full-screen program it ran, above a new shell", async (step) => {
    step.skip(process.platform === "win32", "Windows' console clears the screen as the new shell starts, wiping the old output and the note from view (vcs-pgm.43)");
    await page.goto(`${host.origin}/#/c/${first}`);
    await runInTerminal(page, "printf '\\033[?1049h\\033[Hfull-screen-%s' program; sleep 600");
    await expect(screen(page)).toContainText("full-screen-program");
    await host.restart();
    await page.goto(`${host.origin}/#/c/${first}`);
    await expect(screen(page)).toContainText("A new shell: the one above ended when Mirador stopped.", { timeout: 30_000 });
    await expect(screen(page)).not.toContainText("full-screen-program");
    await expect(tabs(page)).toHaveCount(1);
    await runInTerminal(page, "echo mark-${MARK:-gone}");
    await expect(screen(page)).toContainText("mark-gone");
    await expect(screen(page)).toContainText("first-21");
    await expect(screen(page)).toContainText("mark-first-shell");
  });
});

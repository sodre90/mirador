import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { countTo, echo, printRaw, shellTabName, sum } from "./terminal-shell.ts";
import { TestHost } from "./test-host.ts";

/**
 * Where sh is bash, as on Arch, /etc/profile reads /etc/bash.bashrc, whose prompt sets the terminal's title over the
 * shell's name; it skips it with POSIXLY_CORRECT set.
 */
const host = new TestHost({ environment: { POSIXLY_CORRECT: "1" } });

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const tabs = (page: Page) => page.getByRole("tab");
const views = (page: Page) => page.locator(".terminal-pane .terminal-splits.shown .xterm");
const screenOf = (page: Page, index: number) => page.locator(".terminal-pane .terminal-splits.shown .xterm-rows").nth(index);
const typingInto = (page: Page, index: number) => page.locator(".terminal-pane .terminal-splits.shown .xterm-helper-textarea").nth(index);

async function typeInto(page: Page, index: number, command: string) {
  await views(page).nth(index).click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

async function confirm(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("button", { name: `Confirm: ${label}`, exact: true }).click();
}

async function dragBy(page: Page, selector: string, deltaX: number) {
  const box = (await page.locator(selector).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y, { steps: 10 });
  await page.mouse.up();
}

test("terminals open in tabs and side-by-side splits that every window shares, take the shell's title, and close with a confirm", async ({ page, context }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);

  await page.getByRole("button", { name: "Show terminal" }).click();
  await expect(tabs(page)).toHaveText([shellTabName]);
  await typeInto(page, 0, echo(`first-${sum("1+1")}`));
  await expect(screenOf(page, 0)).toContainText("first-2");

  await page.getByRole("button", { name: "New terminal tab" }).click();
  await expect(tabs(page)).toHaveText([shellTabName, `${shellTabName} 2`]);
  await expect(page.getByRole("tab", { name: `${shellTabName} 2` })).toHaveAttribute("aria-selected", "true");
  await expect(typingInto(page, 0)).toBeFocused();
  await page.keyboard.type(`${echo(`second-${sum("2+2")}`)}\n`);
  await expect(screenOf(page, 0)).toContainText("second-4");
  await expect(screenOf(page, 0)).not.toContainText("first-2");

  await page.getByRole("button", { name: "Split right" }).click();
  await expect(views(page)).toHaveCount(2);
  await expect(typingInto(page, 1)).toBeFocused();
  await page.keyboard.type(`${echo(`right-${sum("3+3")}`)}\n`);
  await expect(screenOf(page, 1)).toContainText("right-6");
  await expect(screenOf(page, 0)).not.toContainText("right-6");

  const leftWidth = () => page.locator(".terminal-splits.shown .terminal-split").first().evaluate((element) => element.getBoundingClientRect().width);
  const evenWidth = await leftWidth();
  await dragBy(page, ".terminal-splits.shown .terminal-group > .splitter", -80);
  expect(await leftWidth()).toBeLessThan(evenWidth - 60);

  await typeInto(page, 0, printRaw("\x1b]0;my-title\x07"));
  await expect(tabs(page)).toHaveText([shellTabName, "my-title"]);
  await expect(page.locator(".terminal-splits.shown .split-title")).toHaveText(["my-title", "Terminal 2"]);

  const other = await context.newPage();
  await other.goto(page.url());
  await expect(tabs(other)).toHaveText([shellTabName, "my-title"]);

  await page.getByRole("tab", { name: shellTabName, exact: true }).click();
  await expect(views(page)).toHaveCount(1);
  await expect(screenOf(page, 0)).toContainText("first-2");

  await page.getByRole("tab", { name: "my-title" }).click();
  await expect(views(page)).toHaveCount(2);
  await confirm(page, "Close terminal 2");
  await expect(views(page)).toHaveCount(1);
  await expect(page.locator(".split-strip")).toHaveCount(0);

  await confirm(page, "Close my-title");
  await expect(tabs(page)).toHaveText([shellTabName]);
  await expect(tabs(other)).toHaveText([shellTabName]);

  const split = page.getByRole("button", { name: "Split right" });
  for (const count of [2, 3, 4]) {
    await split.click();
    await expect(views(page)).toHaveCount(count);
  }
  await expect(split).toBeDisabled();

  await page.reload();
  await expect(tabs(page)).toHaveText([shellTabName]);
  await expect(views(page)).toHaveCount(4);
  await expect(screenOf(page, 0)).toContainText("first-2");

  const topRow = () => screenOf(page, 0).locator(":scope > div").first().textContent();
  const settledTopRow = async () => {
    for (let last = await topRow(); ; ) {
      await page.waitForTimeout(150);
      const now = await topRow();
      if (now === last) return now;
      last = now;
    }
  };
  await typeInto(page, 0, countTo(400));
  await expect(screenOf(page, 0)).toContainText("400");
  const atBottom = await settledTopRow();
  for (const _ of [1, 2, 3, 4]) await page.mouse.wheel(0, -1500);
  await expect.poll(topRow).not.toBe(atBottom);
  const scrolledUp = await settledTopRow();
  await page.getByRole("button", { name: "New terminal tab" }).click();
  await expect(tabs(page)).toHaveCount(2);
  await page.getByRole("tab", { name: shellTabName, exact: true }).click();
  await expect(views(page)).toHaveCount(4);
  expect(await settledTopRow()).toBe(scrolledUp);
});

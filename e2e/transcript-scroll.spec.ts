import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const CARDS = 14;
const timeline = (page: Page) => page.locator(".timeline");
const card = (page: Page, number: number) => page.locator(".user-command", { hasText: `card-${number}:` });

async function runCommand(page: Page, command: string) {
  const composer = page.locator(".composer textarea");
  await composer.fill(`!${command}`);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

async function dragDividerBy(page: Page, deltaX: number) {
  const box = (await page.getByRole("separator", { name: "Resize the left and right panes" }).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y, { steps: 10 });
  await page.mouse.up();
}

const withoutBrowserScrollAnchoring = (page: Page) => page.addStyleTag({ content: ".timeline, .timeline * { overflow-anchor: none; }" });

const distanceFromBottom = (page: Page) => timeline(page).evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);

const offsetFromTop = (page: Page, number: number) =>
  card(page, number).evaluate((element) => element.getBoundingClientRect().top - element.closest(".timeline")!.getBoundingClientRect().top);

test("resizing the conversation keeps the reader at the bottom, or on the line they were reading", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await withoutBrowserScrollAnchoring(page);
  for (let number = 1; number <= CARDS; number++) {
    await runCommand(page, `echo "card-${number}: the quick brown fox jumps over the lazy dog, again and again, until the line has to wrap"`);
  }
  await expect(page.locator(".user-command .shell-output")).toHaveCount(CARDS);
  await expect.poll(() => distanceFromBottom(page)).toBeLessThan(2);

  await dragDividerBy(page, -250);
  await expect.poll(() => distanceFromBottom(page)).toBeLessThan(2);

  await card(page, 6).evaluate((element) => element.scrollIntoView({ block: "start" }));
  const reading = await offsetFromTop(page, 6);
  await dragDividerBy(page, 400);
  await expect.poll(() => offsetFromTop(page, 6).then((offset) => Math.abs(offset - reading))).toBeLessThan(3);
  await dragDividerBy(page, -500);
  await expect.poll(() => offsetFromTop(page, 6).then((offset) => Math.abs(offset - reading))).toBeLessThan(3);
  expect(await distanceFromBottom(page)).toBeGreaterThan(100);
});

import { expect, test, type Page } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, answerCanvasQuestion, callCanvasTool, sendMessage, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

const primaryModifier = async (page: Page) => ((await page.evaluate(() => navigator.userAgent.includes("Mac"))) ? "Meta" : "Control");

const expectOpen = (page: Page, conversationId: string) => expect(page).toHaveURL(new RegExp(`#/c/${conversationId}$`));

test("a key and the palette go to the conversation that most needs you, then to the next one waiting", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const asking = await startConversation(page);
  const finished = await startConversation(page);
  const row = (conversationId: string) => page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);
  const nextWaiting = `${await primaryModifier(page)}+Shift+KeyY`;

  api.hold();
  await sendMessage(page, "Reply with just the word OK.");
  const elsewhere = await startConversation(page);
  api.answerHeld();
  await expect(row(finished).locator(".waiting-pill")).toHaveText("Done");
  void callCanvasTool(host, asking, "ask", { question: "Which layout?", options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});
  await expect(row(asking).locator(".waiting-pill")).toHaveText("Needs you");

  await test.step("the question comes before the finished turn, though it is lower in the sidebar", async () => {
    await page.keyboard.press(nextWaiting);
    await expectOpen(page, asking);
  });

  await test.step("pressed again, it goes on to the finished one, whose mark opening it clears", async () => {
    await page.keyboard.press(nextWaiting);
    await expectOpen(page, finished);
    await expect(row(finished).locator(".waiting-pill")).toHaveCount(0);
  });

  await test.step("the palette offers the same, naming the conversation it would open", async () => {
    await page.keyboard.press(`${await primaryModifier(page)}+KeyK`);
    const palette = page.getByLabel("Search conversations and actions");
    await palette.fill("next conversation waiting");
    await palette.press("Enter");
    await expectOpen(page, asking);
  });

  await test.step("with nothing else waiting, the key stays where it is and the palette offers nothing", async () => {
    await page.keyboard.press(nextWaiting);
    await expectOpen(page, asking);
    await answerCanvasQuestion(page, "Yes");
    await row(elsewhere).click();
    await page.keyboard.press(nextWaiting);
    await expectOpen(page, elsewhere);
    await page.keyboard.press(`${await primaryModifier(page)}+KeyK`);
    const palette = page.getByLabel("Search conversations and actions");
    await palette.fill("next conversation waiting");
    await expect(page.getByRole("option", { name: "Next conversation waiting for you" })).toHaveCount(0);
  });
});

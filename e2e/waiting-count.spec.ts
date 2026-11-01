import { createInterface } from "node:readline";
import { expect, test } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, answerCanvasQuestion, callCanvasTool, sendMessage, signIn, startConversation, startDesktopNotifier } from "./helpers.ts";
import { TestHost } from "./test-host.ts";
import { conversationRoute } from "../desktop/src/core/window-menu.ts";

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

/** The agent waits on its question until it is answered, so the call is left running. */
const askInBackground = (conversationId: string, question: string) =>
  void callCanvasTool(host, conversationId, "ask", { question, options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});

async function browserToken() {
  const signedIn = await fetch(host.authUrl, { redirect: "manual" });
  return signedIn.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
}

test("the waiting count shows in the browser tab title and travels to the desktop app with the most urgent tone", async ({ page, browser }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const first = await startConversation(page);
  const second = await startConversation(page);
  await expect(page).toHaveTitle("Mirador");

  const notifier = startDesktopNotifier(host.origin, await browserToken());
  const lines = createInterface({ input: notifier.stdout! })[Symbol.asyncIterator]();
  const nextLine = async () => String((await lines.next()).value);
  const untilLine = async (text: string) => {
    for (;;) {
      if ((await nextLine()) === text) return;
    }
  };

  try {
    expect(await nextLine()).toBe("connected");
    await untilLine("waiting 0");

    await test.step("a question in another conversation puts the count in the tab title and tells the desktop app", async () => {
      askInBackground(first, "Which layout?");
      await expect(page).toHaveTitle("(1) Mirador");
      await untilLine("waiting 1 decision");
      await untilLine(`waiting in: ${first} decision New conversation · project`);
    });

    await test.step("the desktop app opens that conversation through its sign-in link, which keeps the conversation's address", async () => {
      for (const conversationId of [first, second]) {
        const desktopWindow = await browser.newContext();
        const desktopPage = await desktopWindow.newPage();
        await desktopPage.goto(`${host.authUrl}${conversationRoute(conversationId)}`);
        await expect(desktopPage.locator(".chat-header:visible")).toContainText("New conversation");
        await expect(desktopPage).toHaveURL(new RegExp(`/#/c/${conversationId}$`));
        await desktopWindow.close();
      }
    });

    await test.step("a second one raises it", async () => {
      askInBackground(second, "Which colour?");
      await expect(page).toHaveTitle("(2) Mirador");
      await untilLine("waiting 2 decision");
    });

    await test.step("answering lowers it, to nothing at the end", async () => {
      await page.locator(".workspace li").nth(0).click();
      await answerCanvasQuestion(page, "Yes");
      await expect(page).toHaveTitle("(1) Mirador");
      await untilLine("waiting 1 decision");
      await page.locator(".workspace li").nth(1).click();
      await answerCanvasQuestion(page, "Yes");
      await expect(page).toHaveTitle("Mirador");
      await untilLine("waiting 0");
    });

    await test.step("a turn that ends while you look elsewhere tells the desktop app it is done, until you open it", async () => {
      api.hold();
      await sendMessage(page, "Reply with just the word OK.");
      await page.locator(".workspace li").nth(0).click();
      api.answerHeld();
      await untilLine("waiting 1 done");
      await page.locator(".workspace li").nth(1).click();
      await untilLine("waiting 0");
    });
  } finally {
    notifier.kill();
  }
});

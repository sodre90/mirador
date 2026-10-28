import { createInterface } from "node:readline";
import { expect, test } from "@playwright/test";
import type { SystemNotification } from "../shared/system-notifications.ts";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import {
  addWorkspace,
  allowNotifications,
  answerCanvasQuestion,
  callCanvasTool,
  clickNotification,
  notificationsShown,
  sendMessage,
  signIn,
  startConversation,
  startDesktopNotifier,
} from "./helpers.ts";
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

/** The agent waits on its question until it is answered, so the call is left running. */
const askInBackground = (conversationId: string, question: string) =>
  void callCanvasTool(host, conversationId, "ask", { question, options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});

async function browserToken() {
  const signedIn = await fetch(host.authUrl, { redirect: "manual" });
  return signedIn.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
}

test("questions elsewhere notify, in the browser or else through the desktop app while it listens", async ({ page }) => {
  await allowNotifications(page);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const first = await startConversation(page);
  const second = await startConversation(page);

  await test.step("a question in another conversation notifies, and the notification opens it", async () => {
    askInBackground(first, "Which layout?");
    await expect.poll(() => notificationsShown(page)).toEqual([{ title: "New conversation", body: "project · Asks: Which layout?", tag: first, closed: false }]);
    await clickNotification(page, "project · Asks: Which layout?");
    await expect(page).toHaveURL(new RegExp(`#/c/${first}$`));
    expect((await notificationsShown(page))[0]!.closed).toBe(true);
    await answerCanvasQuestion(page, "Yes");
  });

  await test.step("nothing notifies about the conversation you are looking at", async () => {
    askInBackground(first, "Seen already?");
    await expect(page.getByRole("heading", { name: "Seen already?" })).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(await notificationsShown(page)).toHaveLength(1);
    await answerCanvasQuestion(page, "No");
  });

  await test.step("while the desktop app listens, it alone is told", async () => {
    const desktopApp = startDesktopNotifier(host.origin, await browserToken());
    const lines = createInterface({ input: desktopApp.stdout! })[Symbol.asyncIterator]();
    const isWaitingOrRunning = (line: string) => /^(waiting|running-turns) (\d+|in:)/.test(line);
    const nextLine = async (): Promise<string> => {
      const line = String((await lines.next()).value);
      return isWaitingOrRunning(line) ? nextLine() : line;
    };
    try {
      expect(await nextLine()).toBe("connected");
      askInBackground(second, "Desktop?");
      expect(JSON.parse(await nextLine()) as SystemNotification).toEqual({ kind: "question", conversationId: second, title: "New conversation", workspace: "project", body: "Asks: Desktop?" });
      await page.waitForTimeout(1_000);
      expect(await notificationsShown(page)).toHaveLength(1);
    } finally {
      desktopApp.kill();
    }
  });

  await test.step("once the desktop app is gone, a turn that finishes while you look elsewhere notifies the browser", async () => {
    api.hold();
    await sendMessage(page, "OK");
    await page.locator(".workspace li:not(.selected) .conversation-title").click();
    await expect(page).toHaveURL(new RegExp(`#/c/${second}$`));
    await expect.poll(() => api.held).toContain("OK");
    api.answerHeld();
    const bodiesAbout = async (conversationId: string) => (await notificationsShown(page)).filter(({ tag }) => tag === conversationId).map(({ body }) => body);
    await expect.poll(() => bodiesAbout(first)).toContain("project · Finished, waiting for you");
  });
});

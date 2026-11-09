import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { SystemNotification } from "../shared/system-notifications.ts";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import {
  addWorkspace,
  allowNotifications,
  answerCanvasQuestion,
  callCanvasTool,
  clickNotification,
  createProfile,
  notificationsShown,
  sendMessage,
  signIn,
  startConversation,
  startDesktopNotifier,
} from "./helpers.ts";
import { TestHost } from "./test-host.ts";

test.describe.configure({ mode: "serial" });

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });

/** A plugin whose tool starts conversations and hears how they ended, but whose plugin.json doesn't say it tells its caller. */
function installPluginThatDoesntTellItsCaller() {
  const folder = join(host.dataDir, "plugins", "untold");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "plugin.json"), JSON.stringify({ name: "untold", title: "Untold", version: "1.0.0", api: 6, canvas: { host: "host.ts", view: "canvas.js" } }));
  writeFileSync(join(folder, "canvas.js"), "");
  writeFileSync(
    join(folder, "host.ts"),
    `export default {
  items: {},
  tools: {
    hand_over_untold: {
      description: "Hand a task to a conversation on another profile, without telling the caller how it ends.",
      input: { type: "object", properties: { profile: { type: "string" }, task: { type: "string" } }, required: ["profile", "task"] },
      async run({ profile, task }, context) {
        return \`Handed over to \${(await context.startConversation({ profile, prompt: task })).id}.\`;
      },
    },
  },
  replied() {},
};
`,
  );
}

test.beforeAll(async () => {
  // The test plugins whose tools start conversations, for the handed-over tasks below.
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  installPluginThatDoesntTellItsCaller();
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

const notificationBodiesAbout = async (page: Page, conversationId: string) =>
  (await notificationsShown(page)).filter(({ tag }) => tag === conversationId).map(({ body }) => body);

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
      expect(JSON.parse(await nextLine()) as SystemNotification).toEqual({
        id: expect.any(String),
        kind: "question",
        conversationId: second,
        title: "New conversation",
        workspace: "project",
        body: "Asks: Desktop?",
        about: { kind: "conversation", reason: { kind: "question", question: "Desktop?" }, untitled: true },
      });
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

  await test.step("in Hungarian, the notification speaks Hungarian, naming an untitled conversation by the Hungarian default", async () => {
    await page.evaluate(() => localStorage.setItem("mirador-language", "hu"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "hu");
    await page.locator(".workspace li:not(.selected) .conversation-title").click();
    await expect(page).toHaveURL(new RegExp(`#/c/${first}$`));
    askInBackground(second, "Magyarul?");
    await expect.poll(() => notificationsShown(page)).toContainEqual({ title: "Új beszélgetés", body: "project · Kérdezi: Magyarul?", tag: second, closed: false });
    await page.evaluate(() => localStorage.removeItem("mirador-language"));
  });
});

test("a conversation a plugin's tool started stays quiet when its turn ends, while its caller's turn end notifies, and its questions still do", async ({ page }) => {
  await allowNotifications(page);
  await signIn(page, host);
  const profiles = await createProfile(page, "Local", "", "", "Claude Code");
  await profiles.getByRole("button", { name: "Close" }).click();
  const caller = await startConversation(page);
  // The page shows this second conversation, so a turn ending in another one notifies.
  await startConversation(page);

  const handedOver = await callCanvasTool(host, caller, "hand_over", { profile: "local", task: "Find the callers" });
  const started = handedOver.match(/^Handed over to ([0-9a-f-]+)\.$/)![1]!;
  // The plugin passes the task's reply on to the caller, and the turn that answers it is the one that notifies.
  await expect.poll(() => notificationBodiesAbout(page, caller)).toEqual(["project · Finished, waiting for you"]);
  expect(await notificationBodiesAbout(page, started)).toEqual([]);

  askInBackground(started, "Which callers count?");
  await expect.poll(() => notificationBodiesAbout(page, started)).toEqual(["project · Asks: Which callers count?"]);
});

test("a conversation started by a plugin that doesn't say it tells its caller notifies when its turn ends, as any conversation does", async ({ page }) => {
  await allowNotifications(page);
  await signIn(page, host);
  const caller = await startConversation(page);
  // The page shows this second conversation, so a turn ending in another one notifies.
  await startConversation(page);

  const handedOver = await callCanvasTool(host, caller, "hand_over_untold", { profile: "local", task: "Find the callers" });
  const started = handedOver.match(/^Handed over to ([0-9a-f-]+)\.$/)![1]!;
  await expect.poll(() => notificationBodiesAbout(page, started)).toEqual(["project · Finished, waiting for you"]);
  expect(await notificationBodiesAbout(page, caller)).toEqual([]);
});

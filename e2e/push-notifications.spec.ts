import { expect, test, type Browser, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openedPushBlob, type ClearMessage, type PushKey, type PushRequest } from "../shared/push.ts";
import { traceEachTest, type DescribeMessage } from "./app-trace.ts";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { answerCanvasQuestion, callCanvasTool, openSettings, sendMessage, signInWithWorkspace, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const networkOriginAt = (port: number) => `https://127.0.0.1:${port + 2}`;
const api = new FakeClaudeApi();
const host = new TestHost({
  environment: (port) => ({
    ...fakeClaudeEnvironment(api),
    MIRADOR_NETWORK: "on",
    MIRADOR_PUBLIC_ORIGIN: networkOriginAt(port),
    MIRADOR_PUBLIC_CANVAS_ORIGIN: `https://127.0.0.1:${port + 3}`,
    MIRADOR_PUSH_RELAY: relayOrigin(),
  }),
});

/** Stands in for the push relay, both the one Settings name and Mirador's own: it takes what the Mac posts, with the token it came with. */
const relayed: { authorization: string | undefined; push: PushRequest }[] = [];
let relay: Server;
const relayOrigin = () => `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;

test.beforeAll(async () => {
  api.limited = false;
  relay = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      relayed.push({ authorization: request.headers.authorization, push: JSON.parse(body) });
      trace().add(`relay got push ${relayed.length}: ${relayed.at(-1)!.push.kind}`);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ outcome: "sent" }));
    });
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  await Promise.all([api.start(), host.start()]);
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
  relay.close();
});

/** What of the Mac page's and the phone's messages bears on the push that on Windows sometimes never comes (vcs-0p0qr.3). */
const describePushMessage: DescribeMessage = (message) => {
  const { kind, conversationId } = (message.notification ?? {}) as { kind?: string; conversationId?: string };
  if (message.type === "presence") return `presence: ${message.conversationId}, ${message.attentive ? "attentive" : "not attentive"}`;
  if (message.type === "system-notification") return `notification: ${kind} of ${conversationId}`;
  if (message.type === "notification.shown" || message.type === "push.register") return message.type;
  return null;
};
const trace = traceEachTest(describePushMessage);

const pushKey: PushKey = { keyId: Buffer.alloc(16, 4).toString("base64url"), key: Buffer.alloc(32, 5).toString("base64url") };
const grant = `1795000000.${"g".repeat(43)}`;

/** What the phone app does on its own connection: registers for pushes, and says it showed a notification only when told to. */
async function registerForPushes(phone: Page, { answerShown, grant = null }: { answerShown: boolean; grant?: string | null }) {
  await phone.evaluate(
    ({ pushKey, answerShown, grant }) =>
      new Promise<void>((resolve) => {
        const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        socket.onopen = () => {
          socket.send(JSON.stringify({ type: "push.register", platform: "ios", deviceToken: "cd".repeat(32), sandbox: true, ...pushKey, kinds: ["question", "finished"], grant }));
          resolve();
        };
        socket.onmessage = async ({ data }) => {
          const text = typeof data === "string" ? data : await (data as Blob).text();
          const message = JSON.parse(text);
          if (message.type !== "system-notification") return;
          (window as unknown as { notificationsHeard: string[] }).notificationsHeard.push(message.notification.body);
          if (answerShown) socket.send(JSON.stringify({ type: "notification.shown", notificationId: message.notification.id }));
        };
        (window as unknown as { notificationsHeard: string[] }).notificationsHeard = [];
        (window as unknown as { pushSocket: WebSocket }).pushSocket?.close();
        (window as unknown as { pushSocket: WebSocket }).pushSocket = socket;
      }),
    { pushKey, answerShown, grant },
  );
}

/** A phone joined with an invite from Settings, showing the Mac's workspaces. */
async function joinedPhone(page: Page, browser: Browser) {
  const settings = await openSettings(page, "Devices");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  const link = (await settings.locator(".invite-link").textContent())!;
  await page.keyboard.press("Escape");
  const phone = await browser.newPage({ ignoreHTTPSErrors: true });
  trace().record(phone, "phone");
  await phone.goto(link);
  await expect(workspaceCard(phone, host.projectDir)).toBeVisible();
  return phone;
}

const askInBackground = (conversationId: string, question: string) =>
  void callCanvasTool(host, conversationId, "ask", { question, options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});

/** A turn's end, then the 5 s the Mac gives the phone to say it showed the notification before it pushes. */
const FINISHED_PUSH_TIMEOUT_MS = 30_000;
/** A Windows runner was seen to take over a minute and a half to start a conversation's agent. */
const AGENT_START_TIMEOUT_MS = 120_000;

/** Sends the message and has its turn end while the page shows another conversation: the model keeps its reply until then. */
async function endTurnWhileShowing(page: Page, elsewhere: string, text: string) {
  api.hold();
  await sendMessage(page, text);
  await expect.poll(() => api.held, { timeout: AGENT_START_TIMEOUT_MS }).toContain(text);
  trace().add(`the model holds the requests of ${JSON.stringify(api.held)}`);
  await page.goto(`${host.origin}/#/c/${elsewhere}`);
  trace().add("the model answers the held request");
  api.answerHeld();
}

test("a phone that doesn't show a notification gets it pushed through the relay set in Settings, sealed so only it can read it", async ({ page, browser }) => {
  await signInWithWorkspace(page, host);
  const asking = await startConversation(page);
  const answerLater = await startConversation(page);
  trace().add(`asking is ${asking}, answerLater is ${answerLater}`);

  await test.step("Settings take the relay's address and this machine's token, and never show the token again", async () => {
    const settings = await openSettings(page, "Notifications");
    await expect(settings.locator(".push-relay-address"), "only a relay of your own takes an address").toBeHidden();
    await settings.locator(".push-relay-choice").selectOption("own");
    await settings.locator(".push-relay-address").fill("http://push.example.com");
    await settings.locator(".push-relay-token").fill("relay-token-for-this-mac");
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(settings.locator(".push-relay-problem")).toHaveText("The push relay's address must start with https://.");
    await settings.locator(".push-relay-address").fill(`${relayOrigin()}/health`);
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(settings.locator(".push-relay-problem")).toHaveText("The push relay's address is just its origin, like https://push.example.com.");
    await settings.locator(".push-relay-address").fill(relayOrigin());
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(settings.locator(".push-relay-problem")).toBeHidden();
    await expect(settings.locator(".push-relay-token")).toHaveValue("");
    await expect(settings.locator(".push-relay-token")).toHaveAttribute("placeholder", "Set");
    await settings.locator(".push-relay-address").fill(relayOrigin().replace("127.0.0.1", "localhost"));
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(settings.locator(".push-relay-problem"), "the token is for its relay alone").toHaveText("The push relay needs this machine's token.");
    await page.reload();
    const reopened = await openSettings(page, "Notifications");
    await expect(reopened.locator(".push-relay-choice")).toHaveValue("own");
    await expect(reopened.locator(".push-relay-address")).toHaveValue(relayOrigin());
    await expect(reopened.locator(".push-relay-token")).toHaveAttribute("placeholder", "Set");
    await page.keyboard.press("Escape");
  });

  const phone = await joinedPhone(page, browser);
  await page.goto(`${host.origin}/#/c/${answerLater}`);

  await test.step("a phone that says it showed the notification gets no push", async () => {
    await registerForPushes(phone, { answerShown: true });
    askInBackground(asking, "Shown on the phone?");
    await expect.poll(() => phone.evaluate(() => (window as unknown as { notificationsHeard: string[] }).notificationsHeard)).toEqual(["Asks: Shown on the phone?"]);
    await phone.waitForTimeout(7_000);
    expect(relayed).toHaveLength(0);
  });

  let another = "";
  await test.step("one that says nothing gets the push, which opens with its own key", async () => {
    await registerForPushes(phone, { answerShown: false });
    another = await startConversation(page);
    trace().add(`another is ${another}`);
    await page.goto(`${host.origin}/#/c/${answerLater}`);
    askInBackground(another, "Pushed to the phone?");
    await expect.poll(() => relayed.length, { timeout: 15_000 }).toBe(1);
    const [{ authorization, push }] = relayed;
    expect(authorization).toBe("Bearer relay-token-for-this-mac");
    expect(push).toMatchObject({ platform: "ios", deviceToken: "cd".repeat(32), sandbox: true, kind: "alert" });
    const opened = await openedPushBlob(pushKey, push.blob!);
    expect(opened.notification).toEqual({ kind: "question", conversationId: another, title: "New conversation", workspace: "project", body: "Asks: Pushed to the phone?" });
  });

  await test.step("answered on the Mac, the question's notification is cleared on the phone with a quiet push", async () => {
    await page.goto(`${host.origin}/#/c/${another}`);
    await answerCanvasQuestion(page, "Yes");
    await expect.poll(() => relayed.length, { timeout: 15_000 }).toBe(2);
    const { push } = relayed[1];
    expect(push).toMatchObject({ platform: "ios", deviceToken: "cd".repeat(32), sandbox: true, kind: "clear" });
    expect((await openedPushBlob<ClearMessage>(pushKey, push.blob!)).cleared).toEqual({ conversationId: another });
  });

  await test.step("a turn that ended while you looked elsewhere is cleared on the phone once you open its conversation", async () => {
    const tidying = await startConversation(page);
    trace().add(`tidying is ${tidying}`);
    await endTurnWhileShowing(page, answerLater, "Tidy the config");
    await expect.poll(() => relayed.length, { timeout: FINISHED_PUSH_TIMEOUT_MS }).toBe(3);
    expect(relayed[2].push.kind).toBe("alert");
    expect((await openedPushBlob(pushKey, relayed[2].push.blob!)).notification).toMatchObject({ kind: "finished", conversationId: tidying });
    await page.goto(`${host.origin}/#/c/${tidying}`);
    await expect.poll(() => relayed.length, { timeout: 15_000 }).toBe(4);
    expect(relayed[3].push.kind).toBe("clear");
    expect((await openedPushBlob<ClearMessage>(pushKey, relayed[3].push.blob!)).cleared).toEqual({ conversationId: tidying });
  });

  await test.step("a notification pushed before a host restart is still cleared once its conversation is read", async () => {
    const acrossRestart = await startConversation(page);
    trace().add(`acrossRestart is ${acrossRestart}`);
    await endTurnWhileShowing(page, answerLater, "Survive the restart");
    await expect.poll(() => relayed.length, { timeout: FINISHED_PUSH_TIMEOUT_MS }).toBe(5);
    expect(relayed[4].push.kind).toBe("alert");
    expect((await openedPushBlob(pushKey, relayed[4].push.blob!)).notification).toMatchObject({ kind: "finished", conversationId: acrossRestart });

    await host.restart();
    await page.goto(`${host.origin}/#/c/${answerLater}`);
    await expect.poll(() => relayed.length, { timeout: 15_000 }).toBe(6);
    expect(relayed[5].push.kind).toBe("clear");
    expect((await openedPushBlob<ClearMessage>(pushKey, relayed[5].push.blob!)), "the question died with the canvas server, so its notification goes").toMatchObject({ cleared: { conversationId: asking } });

    await page.goto(`${host.origin}/#/c/${acrossRestart}`);
    await expect.poll(() => relayed.length, { timeout: 15_000 }).toBe(7);
    expect(relayed[6].push.kind, "the turn ended before the restart, and reading it after still clears it").toBe("clear");
    expect((await openedPushBlob<ClearMessage>(pushKey, relayed[6].push.blob!)).cleared).toEqual({ conversationId: acrossRestart });
  });
  await phone.close();
});

test("with no relay of its own set, the Mac pushes through Mirador's relay with the grant the phone holds, and no token", async ({ page, browser }) => {
  await signInWithWorkspace(page, host);
  const settings = await openSettings(page, "Notifications");
  await settings.locator(".push-relay-choice").selectOption("mirador");
  await expect(settings.locator(".push-relay-address")).toBeHidden();
  await expect(settings.locator(".push-relay-choice option:checked")).toHaveText(`Mirador's relay (${new URL(relayOrigin()).host})`);
  await expect(settings.locator(".push-relay-hint")).toHaveText("Each phone gets a grant from Mirador's relay, which lets this machine push to it.");
  await settings.locator(".push-relay-choice").selectOption("own");
  await expect(settings.locator(".push-relay-token"), "Mirador's relay forgot the token of your own").toHaveAttribute("placeholder", "");
  await settings.locator(".push-relay-choice").selectOption("mirador");
  await page.reload();
  const reopened = await openSettings(page, "Notifications");
  await expect(reopened.locator(".push-relay-choice")).toHaveValue("mirador");
  await page.keyboard.press("Escape");
  const asking = await startConversation(page);
  const elsewhere = await startConversation(page);
  const phone = await joinedPhone(page, browser);
  await page.goto(`${host.origin}/#/c/${elsewhere}`);
  await registerForPushes(phone, { answerShown: false, grant });
  const before = relayed.length;
  askInBackground(asking, "Pushed with the phone's grant?");
  await expect.poll(() => relayed.slice(before).filter(({ push }) => push.kind === "alert"), { timeout: 15_000 }).toHaveLength(1);
  const { authorization, push } = relayed.slice(before).find(({ push }) => push.kind === "alert")!;
  expect(authorization).toBeUndefined();
  expect(push).toMatchObject({ platform: "ios", deviceToken: "cd".repeat(32), sandbox: true, kind: "alert", grant });
  expect((await openedPushBlob(pushKey, push.blob!)).notification).toMatchObject({ kind: "question", conversationId: asking, body: "Asks: Pushed with the phone's grant?" });
  await phone.close();
});

test("with pushes off the Mac pushes nothing, so a phone hears only over its connection; back on Mirador's relay, it pushes again", async ({ page, browser }) => {
  await signInWithWorkspace(page, host);
  const settings = await openSettings(page, "Notifications");
  await settings.locator(".push-relay-choice").selectOption("off");
  await expect(settings.locator(".push-relay-hint")).toContainText("This machine sends no pushes. Android phones stay connected to it in the background instead");
  await page.reload();
  const reopened = await openSettings(page, "Notifications");
  await expect(reopened.locator(".push-relay-choice")).toHaveValue("off");
  await page.keyboard.press("Escape");
  const askedWhileOff = await startConversation(page);
  const askedWhileOn = await startConversation(page);
  const elsewhere = await startConversation(page);
  const phone = await joinedPhone(page, browser);
  await page.goto(`${host.origin}/#/c/${elsewhere}`);
  await registerForPushes(phone, { answerShown: false, grant });
  const before = relayed.length;

  askInBackground(askedWhileOff, "Heard only over the connection?");
  await expect.poll(() => phone.evaluate(() => (window as unknown as { notificationsHeard: string[] }).notificationsHeard)).toContain("Asks: Heard only over the connection?");
  const turnedOn = await openSettings(page, "Notifications");
  await turnedOn.locator(".push-relay-choice").selectOption("mirador");
  await expect(turnedOn.locator(".push-relay-hint")).toContainText("Each phone gets a grant");
  await page.keyboard.press("Escape");

  askInBackground(askedWhileOn, "Pushed once pushes are on again?");
  /** The earlier tests' phones hold the same key and may hold grants too, so pushes are told apart by what they are about. */
  const pushedAbout = () =>
    Promise.all(relayed.slice(before).filter(({ push }) => push.kind === "alert").map(async ({ push }) => (await openedPushBlob(pushKey, push.blob!)).notification.conversationId));
  await expect.poll(pushedAbout, { timeout: 15_000 }).toContain(askedWhileOn);
  expect(await pushedAbout(), "the question asked while pushes were off, which would have been pushed first, never went").not.toContain(askedWhileOff);
  await phone.close();
});

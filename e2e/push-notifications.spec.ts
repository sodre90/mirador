import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openedPushBlob, type ClearMessage, type PushKey, type PushRequest } from "../shared/push.ts";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, answerCanvasQuestion, callCanvasTool, openSettings, sendMessage, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const networkOriginAt = (port: number) => `https://127.0.0.1:${port + 2}`;
const api = new FakeClaudeApi();
const host = new TestHost({
  environment: (port) => ({
    ...fakeClaudeEnvironment(api),
    MIRADOR_NETWORK: "on",
    MIRADOR_PUBLIC_ORIGIN: networkOriginAt(port),
    MIRADOR_PUBLIC_CANVAS_ORIGIN: `https://127.0.0.1:${port + 3}`,
  }),
});

/** Stands in for the push relay: it takes what the Mac posts, with the token it came with. */
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

const pushKey: PushKey = { keyId: Buffer.alloc(16, 4).toString("base64url"), key: Buffer.alloc(32, 5).toString("base64url") };

/** What the phone app does on its own connection: registers for pushes, and says it showed a notification only when told to. */
async function registerForPushes(phone: Page, { answerShown }: { answerShown: boolean }) {
  await phone.evaluate(
    ({ pushKey, answerShown }) =>
      new Promise<void>((resolve) => {
        const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        socket.onopen = () => {
          socket.send(JSON.stringify({ type: "push.register", platform: "ios", deviceToken: "cd".repeat(32), sandbox: true, ...pushKey, kinds: ["question", "finished"] }));
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
    { pushKey, answerShown },
  );
}

const askInBackground = (conversationId: string, question: string) =>
  void callCanvasTool(host, conversationId, "ask", { question, options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});

test("a phone that doesn't show a notification gets it pushed through the relay set in Settings, sealed so only it can read it", async ({ page, browser }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const asking = await startConversation(page);
  const answerLater = await startConversation(page);

  await test.step("Settings take the relay's address and this Mac's token, and never show the token again", async () => {
    const settings = await openSettings(page, "Notifications");
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
    await expect(settings.locator(".push-relay-problem"), "the token is for its relay alone").toHaveText("The push relay needs this Mac's token.");
    await page.reload();
    const reopened = await openSettings(page, "Notifications");
    await expect(reopened.locator(".push-relay-address")).toHaveValue(relayOrigin());
    await expect(reopened.locator(".push-relay-token")).toHaveAttribute("placeholder", "Set");
    await page.keyboard.press("Escape");
  });

  const settings = await openSettings(page, "Devices");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  const link = (await settings.locator(".invite-link").textContent())!;
  await page.keyboard.press("Escape");
  await page.goto(`${host.origin}/#/c/${answerLater}`);
  const phone = await browser.newPage({ ignoreHTTPSErrors: true });
  await phone.goto(link);
  await expect(workspaceCard(phone, host.projectDir)).toBeVisible();

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
    api.hold();
    await sendMessage(page, "Tidy the config");
    await page.goto(`${host.origin}/#/c/${answerLater}`);
    api.answerHeld();
    await expect.poll(() => relayed.length, { timeout: 15_000 }).toBe(3);
    expect(relayed[2].push.kind).toBe("alert");
    expect((await openedPushBlob(pushKey, relayed[2].push.blob!)).notification).toMatchObject({ kind: "finished", conversationId: tidying });
    await page.goto(`${host.origin}/#/c/${tidying}`);
    await expect.poll(() => relayed.length, { timeout: 15_000 }).toBe(4);
    expect(relayed[3].push.kind).toBe("clear");
    expect((await openedPushBlob<ClearMessage>(pushKey, relayed[3].push.blob!)).cleared).toEqual({ conversationId: tidying });
  });
  await phone.close();
});

import { describe, expect, test } from "bun:test";
import { notificationWords } from "../desktop/src/core/desktop-words.ts";
import { Hub, socketData, type BrowserSocket, type SocketData } from "../host/hub.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { bodyWithWorkspace, joinRequestNotification, systemNotification, turnEndReason, type NotificationReason, type SystemNotification } from "../shared/system-notifications.ts";
import { inLanguage } from "../web/notification-text.ts";

const conversation = { id: "c1", title: "Fix the tray menu", titleSetByUser: false };

describe("system notification text", () => {
  test("names the conversation and its workspace, and says why and what kind it is", () => {
    expect(systemNotification(conversation, "mirador", { kind: "question", question: "Which layout?" })).toEqual({
      kind: "question",
      conversationId: "c1",
      title: "Fix the tray menu",
      workspace: "mirador",
      body: "Asks: Which layout?",
      about: { kind: "conversation", reason: { kind: "question", question: "Which layout?" } },
    });
    expect(systemNotification(conversation, "mirador", { kind: "permission", tool: "bun run test" }).body).toBe("Wants permission: bun run test");
    expect(systemNotification(conversation, "mirador", { kind: "permission", tool: null }).body).toBe("Wants permission: a tool");
    expect(systemNotification(conversation, "mirador", { kind: "finished" }).body).toBe("Finished, waiting for you");
    expect(systemNotification(conversation, "mirador", { kind: "error", message: "exited" }).body).toBe("Stopped with an error: exited");
  });

  test("keeps the body to one short line", () => {
    const body = systemNotification(conversation, "mirador", { kind: "question", question: `Line one\n\n  line two ${"x".repeat(300)}` }).body;
    expect(body.startsWith("Asks: Line one line two x")).toBe(true);
    expect(body).toHaveLength(200);
    expect(body.endsWith("…")).toBe(true);
  });

  test("a body cut short keeps an emoji at the cut whole", () => {
    const question = `${"a".repeat(192)}😀bc`;
    expect(systemNotification(conversation, "mirador", { kind: "question", question }).body).toBe(`Asks: ${"a".repeat(192)}😀…`);
  });

  test("a body of exactly 200 graphemes is not cut, even though it has more UTF-16 units", () => {
    const question = `${"a".repeat(193)}😀`;
    expect(systemNotification(conversation, "mirador", { kind: "question", question }).body).toBe(`Asks: ${"a".repeat(193)}😀`);
  });
});

describe("a turn that ends makes it your move", () => {
  test("when it finished or stopped with an error", () => {
    expect(turnEndReason({ stopReason: "end_turn" })).toEqual({ kind: "finished" });
    expect(turnEndReason({ error: "boom" })).toEqual({ kind: "error", message: "boom" });
  });

  test("but not when you cancelled it, nor when a queued message goes out next", () => {
    expect(turnEndReason({ stopReason: "cancelled" })).toBeNull();
    expect(turnEndReason({ stopReason: "end_turn" }, { messagesQueued: true })).toBeNull();
    expect(turnEndReason({ error: "boom" }, { messagesQueued: true })).toBeNull();
  });

  test("nor a queued message whose queue is held", () => {
    expect(turnEndReason({ stopReason: "end_turn" }, { messagesQueued: true, holdsQueue: true })).toEqual({ kind: "finished" });
    expect(turnEndReason({ error: "boom" }, { messagesQueued: true, holdsQueue: true })).toEqual({ kind: "error", message: "boom" });
  });

  test("nor when it finished to wait for a job whose end resumes the agent, though a failure still is", () => {
    expect(turnEndReason({ stopReason: "end_turn" }, { resumedByAJob: true })).toBeNull();
    expect(turnEndReason({ error: "boom" }, { resumedByAJob: true })).toEqual({ kind: "error", message: "boom" });
  });
});

describe("delivery", () => {
  function connect(hub: Hub, role: SocketData["role"], deviceId: string | null = null) {
    const received: ServerMessage[] = [];
    const socket = { data: socketData(role, deviceId), send: (payload: string) => received.push(JSON.parse(payload)) } as unknown as BrowserSocket;
    hub.add(socket);
    return { socket, received };
  }
  const notification: SystemNotification = { kind: "finished", conversationId: "c1", title: "t", workspace: "w", body: "Finished, waiting for you" };
  const notificationsIn = (received: ServerMessage[]) => received.filter(({ type }) => type === "system-notification");

  test("goes to every open page while the desktop app is not listening", () => {
    const hub = new Hub();
    const [first, second] = [connect(hub, "page"), connect(hub, "page")];
    hub.notify(notification);
    expect(notificationsIn(first.received)).toEqual([{ type: "system-notification", notification }]);
    expect(notificationsIn(second.received)).toHaveLength(1);
  });

  test("goes only to the desktop app while it listens, which hears nothing else", () => {
    const hub = new Hub();
    const page = connect(hub, "page");
    const desktop = connect(hub, "notifier");
    hub.notify(notification);
    hub.broadcast({ type: "workspace.deleted", workspaceId: "w1" });
    expect(notificationsIn(page.received)).toEqual([]);
    expect(desktop.received).toEqual([{ type: "system-notification", notification }]);

    hub.remove(desktop.socket);
    hub.notify(notification);
    expect(notificationsIn(page.received)).toHaveLength(1);
  });

  test("goes once to each device: through what listens on it for notifications, else to each of its pages", () => {
    const hub = new Hub();
    const [phoneTab, otherPhoneTab] = [connect(hub, "page", "phone"), connect(hub, "page", "phone")];
    const laptopHost = connect(hub, "notifier", "laptop");
    const frameOnLaptop = connect(hub, "page", "laptop");
    const [ownPage, ownDesktop] = [connect(hub, "page"), connect(hub, "notifier")];
    hub.notify(notification);
    expect([phoneTab, otherPhoneTab, laptopHost, ownDesktop].map(({ received }) => notificationsIn(received).length)).toEqual([1, 1, 1, 1]);
    expect([frameOnLaptop, ownPage].map(({ received }) => notificationsIn(received).length)).toEqual([0, 0]);
  });

  test("what it passes on from other machines stays on this computer", () => {
    const hub = new Hub();
    const [phone, ownPage] = [connect(hub, "page", "phone"), connect(hub, "page")];
    hub.notifyThisComputer(notification);
    expect(notificationsIn(phone.received)).toEqual([]);
    expect(notificationsIn(ownPage.received)).toHaveLength(1);
  });

  test("a conversation counts as watched only while a focused page shows it", () => {
    const hub = new Hub();
    const page = connect(hub, "page");
    expect(hub.isWatched("c1")).toBe(false);
    page.socket.data.presence = { conversationId: "c1", attentive: false, sideChatId: null };
    expect(hub.isWatched("c1")).toBe(false);
    page.socket.data.presence = { conversationId: "c1", attentive: true, sideChatId: null };
    expect(hub.isWatched("c1")).toBe(true);
    expect(hub.isWatched("c2")).toBe(false);
  });
});

test("without a subtitle line the workspace leads the body", () => {
  const notification = systemNotification(conversation, "mirador", { kind: "finished" });
  expect(bodyWithWorkspace(notification)).toBe("mirador · Finished, waiting for you");
  expect(bodyWithWorkspace({ ...notification, workspace: "" })).toBe("Finished, waiting for you");
});

test("a device asking to join says where it asks from, and who it is signed in to Tailscale as when it asked through tailscale serve", () => {
  const request = { id: "r", name: "Phone", fromAddress: "100.64.0.7", tailscaleUser: null, expiresAt: 0 };
  expect(joinRequestNotification(request)).toEqual({
    kind: "join-request",
    title: "Phone asks to join Mirador",
    workspace: "",
    body: "From 100.64.0.7. Open Mirador to approve it by typing the number it shows.",
    about: { kind: "join-request", request: { name: "Phone", fromAddress: "100.64.0.7", tailscaleUser: null } },
  });
  expect(joinRequestNotification({ ...request, tailscaleUser: "me@example.com" }).body).toBe(
    "From 100.64.0.7, signed in to Tailscale as me@example.com. Open Mirador to approve it by typing the number it shows.",
  );
});

describe("a notification in the page's or the desktop app's language", () => {
  const hungarian = notificationWords("hu");
  test("says why the conversation needs you, and names an untitled one by the default name", () => {
    const untitled = systemNotification({ ...conversation, title: "New conversation" }, "mirador", { kind: "permission", tool: null });
    expect(inLanguage(untitled, hungarian)).toMatchObject({ title: "Új beszélgetés", workspace: "mirador", body: "Engedélyt kér: egy eszköz" });
    expect(inLanguage(systemNotification(conversation, "mirador", { kind: "finished" }), hungarian)).toMatchObject({ title: "Fix the tray menu", body: "Kész, rád vár" });
  });

  test("says an error the host described in that language, and one from the agent as it came", () => {
    const described = systemNotification(conversation, "mirador", { kind: "error", message: "The workspace no longer exists.", problem: { code: "workspace-gone" } });
    expect(inLanguage(described, hungarian).body).toBe("Hibával leállt: A munkaterület már nem létezik.");
    expect(inLanguage(systemNotification(conversation, "mirador", { kind: "error", message: "Overloaded" }), hungarian).body).toBe("Hibával leállt: Overloaded");
  });

  test("in English, it says what the host wrote", () => {
    const english = notificationWords("en");
    const reasons: NotificationReason[] = [
      { kind: "question", question: `Line one\n${"x".repeat(300)}` },
      { kind: "permission", tool: "bun run test" },
      { kind: "permission", tool: null },
      { kind: "finished" },
      { kind: "error", message: "exited" },
      { kind: "error", message: "The workspace no longer exists.", problem: { code: "workspace-gone" } },
      { kind: "job-ended", message: "The build ended" },
    ];
    for (const reason of reasons) {
      const notification = systemNotification({ ...conversation, title: "New conversation" }, "mirador", reason);
      expect(inLanguage(notification, english)).toEqual(notification);
    }
    for (const tailscaleUser of [null, "me@example.com"]) {
      const notification = joinRequestNotification({ id: "r", name: "Phone", fromAddress: "100.64.0.7", tailscaleUser, expiresAt: 0 });
      expect(inLanguage(notification, english)).toEqual(notification);
    }
  });

  test("one from a host that doesn't say what it is about stays as it came", () => {
    const { about: _, ...older } = systemNotification(conversation, "mirador", { kind: "finished" });
    expect(inLanguage(older, hungarian)).toEqual(older);
  });
});

import { describe, expect, test } from "bun:test";
import { HostNotifications, nativeNotification, notificationSocketUrl, type NotificationSocket } from "../desktop/src/core/host-notifications.ts";
import type { NewerVersion } from "../shared/newer-version.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import type { SystemNotification } from "../shared/system-notifications.ts";
import type { WaitingSummary } from "../shared/waiting.ts";

const notification: SystemNotification = { kind: "question", conversationId: "c1", title: "Fix the tray menu", workspace: "mirador", body: "Asks: Which layout?" };

class FakeSocket implements NotificationSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;

  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}

  receive(message: ServerMessage) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  hostGoesAway() {
    this.onclose?.(new CloseEvent("close"));
  }

  close() {
    this.closed = true;
  }
}

function listen(token: () => string | null = () => "secret") {
  const sockets: FakeSocket[] = [];
  const shown: SystemNotification[] = [];
  const waitings: WaitingSummary[] = [];
  const runningTurnsCounts: number[] = [];
  const newerVersions: (NewerVersion | null)[] = [];
  const notifications = new HostNotifications({
    origin: "http://127.0.0.1:4600",
    token,
    show: (shownNotification) => void shown.push(shownNotification),
    showWaiting: (summary) => void waitings.push(summary),
    showRunningTurnsCount: (count) => void runningTurnsCounts.push(count),
    showNewerVersion: (newerVersion) => void newerVersions.push(newerVersion),
    open: (url, headers) => {
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      return socket;
    },
    retryDelayMilliseconds: 1,
  });
  return { notifications, sockets, shown, waitings, runningTurnsCounts, newerVersions };
}

describe("host notifications in the desktop app", () => {
  test("connects to the host's notification socket signed in like a page", () => {
    const { notifications, sockets } = listen();
    notifications.start();
    expect(sockets[0]).toMatchObject({ url: "ws://127.0.0.1:4600/notifications", headers: { Origin: "http://127.0.0.1:4600", Cookie: "mirador_token=secret" } });
    notifications.stop();
  });

  test("shows each system notification the host sends, and nothing else", () => {
    const { notifications, sockets, shown } = listen();
    notifications.start();
    sockets[0]!.receive({ type: "workspace.deleted", workspaceId: "w1" });
    sockets[0]!.receive({ type: "system-notification", notification });
    expect(shown).toEqual([notification]);
    notifications.stop();
  });

  test("shows the number of conversations waiting and the most urgent tone that the host sends", () => {
    const { notifications, sockets, waitings } = listen();
    notifications.start();
    sockets[0]!.receive({ type: "waiting.counted", count: 2, mostUrgent: "decision" });
    expect(waitings).toEqual([{ count: 2, mostUrgent: "decision" }]);
    notifications.stop();
  });

  test("takes no urgent tone from an older host that sends only the count", () => {
    const { notifications, sockets, waitings } = listen();
    notifications.start();
    sockets[0]!.receive({ type: "waiting.counted", count: 2 } as unknown as ServerMessage);
    expect(waitings).toEqual([{ count: 2, mostUrgent: null }]);
    notifications.stop();
  });

  test("shows the number of running turns that the host sends, and forgets it when the host goes away", async () => {
    const { notifications, sockets, runningTurnsCounts } = listen();
    notifications.start();
    sockets[0]!.receive({ type: "running-turns.counted", count: 3 });
    sockets[0]!.hostGoesAway();
    expect(runningTurnsCounts).toEqual([3, 0]);
    await Bun.sleep(20);
    sockets[1]!.receive({ type: "running-turns.counted", count: 1 });
    expect(runningTurnsCounts).toEqual([3, 0, 1]);
    notifications.stop();
  });

  test("forgets what waits when the host goes away, and takes the next summary on reconnecting", async () => {
    const { notifications, sockets, waitings } = listen();
    notifications.start();
    sockets[0]!.receive({ type: "waiting.counted", count: 2, mostUrgent: "done" });
    sockets[0]!.hostGoesAway();
    expect(waitings).toEqual([{ count: 2, mostUrgent: "done" }, { count: 0, mostUrgent: null }]);
    await Bun.sleep(20);
    expect(sockets).toHaveLength(2);
    sockets[1]!.receive({ type: "waiting.counted", count: 1, mostUrgent: "decision" });
    expect(waitings.at(-1)).toEqual({ count: 1, mostUrgent: "decision" });
    notifications.stop();
  });

  test("shows the newer version the host found, and forgets it when the host goes away, which may have been updated", () => {
    const { notifications, sockets, newerVersions } = listen();
    const newerVersion = { kind: "release", version: "9.9.9", url: "https://github.com/sodre90/mirador/releases/tag/v9.9.9" } as const;
    notifications.start();
    sockets[0]!.receive({ type: "newer-version.found", newerVersion });
    sockets[0]!.hostGoesAway();
    expect(newerVersions).toEqual([newerVersion, null]);
    notifications.stop();
  });

  test("connects again after the host restarts, and stops for good when told", async () => {
    const { notifications, sockets } = listen();
    notifications.start();
    sockets[0]!.hostGoesAway();
    await Bun.sleep(20);
    expect(sockets).toHaveLength(2);
    notifications.stop();
    expect(sockets[1]!.closed).toBe(true);
    sockets[1]!.hostGoesAway();
    await Bun.sleep(20);
    expect(sockets).toHaveLength(2);
  });

  test("waits for the host to write its token", async () => {
    let token: string | null = null;
    const { notifications, sockets } = listen(() => token);
    notifications.start();
    await Bun.sleep(20);
    expect(sockets).toHaveLength(0);
    token = "written";
    await Bun.sleep(20);
    expect(sockets[0]?.headers.Cookie).toBe("mirador_token=written");
    notifications.stop();
  });

  test("puts the workspace on macOS's subtitle line, and ahead of the body on Linux", () => {
    expect(nativeNotification(notification, "darwin")).toEqual({ title: "Fix the tray menu", subtitle: "mirador", body: "Asks: Which layout?" });
    expect(nativeNotification(notification, "linux")).toEqual({ title: "Fix the tray menu", body: "mirador · Asks: Which layout?" });
  });

  test("turns the app's origin into its notification socket", () => {
    expect(notificationSocketUrl("http://127.0.0.1:4790")).toBe("ws://127.0.0.1:4790/notifications");
    expect(notificationSocketUrl("https://mac.tail0.ts.net:4600", "65a3d4c7")).toBe("wss://mac.tail0.ts.net:4600/notifications?desktop-app-code=65a3d4c7");
  });
});

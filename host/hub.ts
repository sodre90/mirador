import type { ServerWebSocket } from "bun";
import { deflateRawSync } from "node:zlib";
import type { ClientAddress, DeviceConnection, StoredEvent } from "../shared/model.ts";
import { DEFLATED_MESSAGE_MIN_LENGTH } from "../shared/low-data.ts";
import type { NewerVersion } from "../shared/newer-version.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { appKey, type AppDocumentState, type PluginUpdate } from "../shared/apps.ts";
import type { SystemNotification } from "../shared/system-notifications.ts";
import type { WaitingSummary } from "../shared/waiting.ts";
import { lowDataEvent, pageEvent } from "./low-data.ts";

export interface Presence {
  conversationId: string | null;
  attentive: boolean;
}

/** A page is the app open in a browser tab or the desktop window; a notifier is the desktop app, listening for system notifications only. */
export interface SocketData {
  role: "page" | "notifier";
  /** The joined device the socket signed in as; null for the host's own link. */
  deviceId: string | null;
  subscriptions: Set<string>;
  /** The apps the socket's page shows, by appKey: only these pages get the apps' documents, which can be large. */
  appSubscriptions: Set<string>;
  /** The subscribed conversations the socket follows in their low-data form, as a phone does. */
  lowDataSubscriptions: Set<string>;
  /** The socket's client reads long messages deflated, in binary frames. */
  readsDeflatedMessages: boolean;
  /** The socket's page edits profiles, so it gets their environments and prelaunch commands. */
  readsProfileLaunch: boolean;
  terminalConversationId: string | null;
  presence: Presence;
  /** Where the page loads canvas libraries from, fitting the address it reached the host at. */
  canvasAssetsOrigin: string;
  from: ClientAddress;
  /** The code a desktop app built from a checkout was built from; null for pages and release builds. */
  desktopAppCode: string | null;
}

const thisMachine: ClientAddress = { fromAddress: "127.0.0.1", tailscaleUser: null };

export const socketData = (
  role: SocketData["role"],
  deviceId: string | null = null,
  canvasAssetsOrigin = "",
  from = thisMachine,
  readsDeflatedMessages = false,
  readsProfileLaunch = false,
  desktopAppCode: string | null = null,
): SocketData => ({
  role,
  deviceId,
  canvasAssetsOrigin,
  from,
  readsDeflatedMessages,
  readsProfileLaunch,
  desktopAppCode,
  subscriptions: new Set<string>(),
  appSubscriptions: new Set<string>(),
  lowDataSubscriptions: new Set<string>(),
  terminalConversationId: null,
  presence: { conversationId: null, attentive: false },
});

export type BrowserSocket = ServerWebSocket<SocketData>;

/** Bun's shared compressor ends each message with a final deflate block, which Android's OkHttp then inflates forever without delivering anything; a compressor per socket does not. */
export const webSocketCompression = { compress: "dedicated", decompress: true } as const;

/** Other devices reach the host over a network, often a phone's mobile data; this machine's own pages don't, and skip the work. */
function deliver(socket: BrowserSocket, payload: string) {
  if (socket.data.readsDeflatedMessages && payload.length > DEFLATED_MESSAGE_MIN_LENGTH) socket.sendBinary(deflateRawSync(payload), false);
  else socket.send(payload, socket.data.deviceId !== null);
}

const once = (make: () => string) => {
  let made: string | undefined;
  return () => (made ??= make());
};

export class Hub {
  private readonly sockets = new Set<BrowserSocket>();
  private readonly notifiers = new Set<BrowserSocket>();
  private announcedWaiting: WaitingSummary | null = null;
  private announcedRunningTurnsCount: number | null = null;

  add(socket: BrowserSocket) {
    (socket.data.role === "notifier" ? this.notifiers : this.sockets).add(socket);
  }

  remove(socket: BrowserSocket) {
    this.sockets.delete(socket);
    this.notifiers.delete(socket);
  }

  send(socket: BrowserSocket, message: ServerMessage) {
    deliver(socket, JSON.stringify(message));
  }

  broadcast(message: ServerMessage) {
    const payload = JSON.stringify(message);
    this.sockets.forEach((socket) => deliver(socket, payload));
  }

  /** Pages keep recently opened conversations subscribed, hidden; this is whether one is showing it. */
  isShown(conversationId: string) {
    return [...this.sockets].some(({ data: { presence } }) => presence.conversationId === conversationId);
  }

  isWatched(conversationId: string) {
    return [...this.sockets].some(({ data: { presence } }) => presence.attentive && presence.conversationId === conversationId);
  }

  /**
   * Once on each device, this computer counting as one: through its desktop app, or the host that shows this machine
   * there, while one listens, so its pages don't repeat it; otherwise through each of its open pages.
   */
  notify(notification: SystemNotification) {
    this.notifyEachDevice([...this.sockets, ...this.notifiers], notification);
  }

  /** Only the desktop app's notification sockets hear it, and only when it changed; pages work it out from the conversations they already hold. */
  announceWaiting(waiting: WaitingSummary) {
    if (waiting.count === this.announcedWaiting?.count && waiting.mostUrgent === this.announcedWaiting.mostUrgent) return;
    this.announcedWaiting = waiting;
    const payload = JSON.stringify({ type: "waiting.counted", ...waiting } satisfies ServerMessage);
    this.notifiers.forEach((socket) => deliver(socket, payload));
  }

  /** Only the desktop app's notification sockets hear it, and only when it changed. */
  announceRunningTurnsCount(count: number) {
    if (count === this.announcedRunningTurnsCount) return;
    this.announcedRunningTurnsCount = count;
    const payload = JSON.stringify({ type: "running-turns.counted", count } satisfies ServerMessage);
    this.notifiers.forEach((socket) => deliver(socket, payload));
  }

  /** Pages show it whichever device they are on, as it is about this host; another machine's desktop app runs an install of its own. */
  announceNewerVersion(newerVersion: NewerVersion | null) {
    const payload = JSON.stringify({ type: "newer-version.found", newerVersion } satisfies ServerMessage);
    [...this.sockets, ...[...this.notifiers].filter(({ data }) => data.deviceId === null)].forEach((socket) => deliver(socket, payload));
  }

  announcePluginUpdates(pluginUpdates: PluginUpdate[]) {
    this.broadcast({ type: "plugin-updates.found", pluginUpdates });
  }

  /** What this host passes on from its other machines; a device that wants those joins the machine itself. Whether a page or app here got it. */
  notifyThisComputer(notification: SystemNotification): boolean {
    const listeners = [...this.sockets, ...this.notifiers].filter(({ data }) => data.deviceId === null);
    this.notifyEachDevice(listeners, notification);
    return listeners.length > 0;
  }

  private notifyEachDevice(sockets: BrowserSocket[], notification: SystemNotification) {
    const payload = JSON.stringify({ type: "system-notification", notification } satisfies ServerMessage);
    const isNotifier = ({ data }: BrowserSocket) => data.role === "notifier";
    const listenersOn = (device: BrowserSocket[]) => (device.some(isNotifier) ? device.filter(isNotifier) : device);
    [...Map.groupBy(sockets, ({ data }) => data.deviceId).values()].flatMap(listenersOn).forEach((socket) => deliver(socket, payload));
  }

  /** Each page gets a message of its own. */
  sendEach(messageFor: (socket: BrowserSocket) => ServerMessage) {
    this.sockets.forEach((socket) => this.send(socket, messageFor(socket)));
  }

  /** Each joined device with a connection open now; the latest one says where it connects from. */
  deviceConnections(): Map<string, DeviceConnection> {
    const ofDevices = [...this.notifiers, ...this.sockets].filter(({ data }) => data.deviceId !== null);
    return new Map(
      [...Map.groupBy(ofDevices, ({ data }) => data.deviceId!)].map(([deviceId, sockets]) => [
        deviceId,
        { ...sockets.at(-1)!.data.from, pages: sockets.filter(({ data }) => data.role === "page").length },
      ]),
    );
  }

  disconnectWhere(isTarget: (socket: BrowserSocket) => boolean, reason: string) {
    [...this.sockets, ...this.notifiers].filter(isTarget).forEach((socket) => socket.close(4401, reason));
  }

  publishWhere(isRecipient: (socket: BrowserSocket) => boolean, message: ServerMessage) {
    const payload = JSON.stringify(message);
    this.sockets.forEach((socket) => {
      if (isRecipient(socket)) deliver(socket, payload);
    });
  }

  publishAppState(state: AppDocumentState) {
    this.publishWhere((socket) => socket.data.appSubscriptions.has(appKey(state)), { type: "app.state", state });
  }

  publishToConversation(conversationId: string, message: ServerMessage) {
    const payload = JSON.stringify(message);
    this.sockets.forEach((socket) => {
      if (socket.data.subscriptions.has(conversationId)) deliver(socket, payload);
    });
  }

  publishEvent(conversationId: string, event: StoredEvent) {
    const forPage = once(() => JSON.stringify({ type: "conversation.event", conversationId, event: pageEvent(event) } satisfies ServerMessage));
    const lowData = once(() => JSON.stringify({ type: "conversation.event", conversationId, event: lowDataEvent(conversationId, event) } satisfies ServerMessage));
    this.sockets.forEach((socket) => {
      if (socket.data.subscriptions.has(conversationId)) deliver(socket, socket.data.lowDataSubscriptions.has(conversationId) ? lowData() : forPage());
    });
  }
}

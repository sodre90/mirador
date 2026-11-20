import type { ServerWebSocket } from "bun";
import { deflateRawSync } from "node:zlib";
import type { ClientAddress, DeviceConnection, StoredEvent } from "../shared/model.ts";
import { DEFLATED_MESSAGE_MIN_LENGTH } from "../shared/low-data.ts";
import type { NewerVersion } from "../shared/newer-version.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { appKey, type AppDocumentState, type AppStorageItems, type PluginUpdate } from "../shared/apps.ts";
import type { SystemNotification } from "../shared/system-notifications.ts";
import type { WaitingSummary } from "../shared/waiting.ts";
import { lowDataEvent, pageEvent } from "./low-data.ts";

export interface Presence {
  conversationId: string | null;
  attentive: boolean;
  sideChatId: string | null;
  roomId: string | null;
}

const showsIn = (presence: Presence, conversationId: string) => presence.conversationId === conversationId || presence.sideChatId === conversationId;

/** A page is the app open in a browser tab or the desktop window; a notifier is the desktop app, listening for system notifications only. */
export interface SocketData {
  role: "page" | "notifier";
  /** The joined device the socket signed in as; null for the host's own link. */
  deviceId: string | null;
  /** Who writes the messages the socket sends. */
  personId: string;
  /** Signed in as the machine's owner; anyone else reaches only the rooms they are in. */
  isOwner: boolean;
  /** For a person other than the owner: the rooms their page was told of, so it hears when one is gone for them. */
  roomsShown: Set<string>;
  subscriptions: Set<string>;
  /** The documents the socket's page shows, by their ids: only these pages get their documents, which can be large. */
  appSubscriptions: Set<string>;
  /** The apps whose storage the socket's page shows, by appKey: what a view keeps is one app's, not one document's. */
  appStorageSubscriptions: Set<string>;
  /** By appKey: the document the view of a phone that names none subscribed to, which the view's operations then go to. */
  appViewsNamingNoDocument: Map<string, string>;
  /** The plugins whose own window the socket's page is. */
  pluginWindowSubscriptions: Set<string>;
  /** The workspaces whose plugin tabs the socket's page shows. */
  pluginTabSubscriptions: Set<string>;
  /** The subscribed conversations the socket follows in their low-data form, as a phone does. */
  lowDataSubscriptions: Set<string>;
  /** The rooms whose messages the socket's page shows. */
  roomSubscriptions: Set<string>;
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

/** The page runs in a browser on the host's own machine, not on a joined device or another machine on the network. */
export const pageOnHost = ({ deviceId, from }: Pick<SocketData, "deviceId" | "from">) =>
  deviceId === null && from.tailscaleUser === null && isLoopback(from.fromAddress);

export const isLoopback = (address: string) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);

/** Who a request or socket signed in as; nobody is null. */
export type SignedIn = Pick<SocketData, "deviceId" | "personId" | "isOwner">;

export const socketData = (
  role: SocketData["role"],
  { deviceId, personId, isOwner }: SignedIn,
  canvasAssetsOrigin = "",
  from = thisMachine,
  readsDeflatedMessages = false,
  readsProfileLaunch = false,
  desktopAppCode: string | null = null,
): SocketData => ({
  role,
  deviceId,
  personId,
  isOwner,
  roomsShown: new Set<string>(),
  canvasAssetsOrigin,
  from,
  readsDeflatedMessages,
  readsProfileLaunch,
  desktopAppCode,
  subscriptions: new Set<string>(),
  appSubscriptions: new Set<string>(),
  appStorageSubscriptions: new Set<string>(),
  appViewsNamingNoDocument: new Map<string, string>(),
  pluginWindowSubscriptions: new Set<string>(),
  pluginTabSubscriptions: new Set<string>(),
  lowDataSubscriptions: new Set<string>(),
  roomSubscriptions: new Set<string>(),
  terminalConversationId: null,
  presence: { conversationId: null, attentive: false, sideChatId: null, roomId: null },
});

export type BrowserSocket = ServerWebSocket<SocketData>;

/** Bun's shared compressor ends each message with a final deflate block, which Android's OkHttp then inflates forever without delivering anything; a compressor per socket does not. */
export const webSocketCompression = { compress: "dedicated", decompress: true } as const;

/** Other devices reach the host over a network, often a phone's mobile data; this machine's own pages don't, and skip the work. */
function transmit(socket: BrowserSocket, payload: string) {
  if (socket.data.readsDeflatedMessages && payload.length > DEFLATED_MESSAGE_MIN_LENGTH) socket.sendBinary(deflateRawSync(payload), false);
  else socket.send(payload, socket.data.deviceId !== null);
}

const once = <T>(make: () => T) => {
  let made: T | undefined;
  return () => (made ??= make());
};

/** A message goes to many sockets as the same object, written out once. */
const payloads = new WeakMap<ServerMessage, string>();

function payloadOf(message: ServerMessage) {
  const known = payloads.get(message);
  if (known !== undefined) return known;
  const payload = JSON.stringify(message);
  payloads.set(message, payload);
  return payload;
}

/** What a person other than the machine's owner may see of a message: the message, ones made for them from it, or nothing. */
export type ShownToPerson = (message: ServerMessage, socket: SocketData) => ServerMessage[];

export class Hub {
  private readonly sockets = new Set<BrowserSocket>();
  private readonly notifiers = new Set<BrowserSocket>();
  private announcedWaiting: string | null = null;
  private announcedRunningTurnsCount: number | null = null;
  private readonly runningTurnsListeners: ((count: number) => void)[] = [];
  /** Until the host says what people see, nothing reaches anyone but the owner. */
  private shownToPerson: ShownToPerson = () => [];

  /** Every message to people other than the owner passes through this first. */
  showsPeople(shownToPerson: ShownToPerson) {
    this.shownToPerson = shownToPerson;
  }

  /** The one way out to a socket: the owner's get every message as it is, anyone else's only what they may see of it. */
  private deliver(socket: BrowserSocket, message: ServerMessage) {
    if (socket.data.isOwner) return transmit(socket, payloadOf(message));
    this.shownToPerson(message, socket.data).forEach((shown) => transmit(socket, payloadOf(shown)));
  }

  add(socket: BrowserSocket) {
    (socket.data.role === "notifier" ? this.notifiers : this.sockets).add(socket);
  }

  remove(socket: BrowserSocket) {
    this.sockets.delete(socket);
    this.notifiers.delete(socket);
  }

  send(socket: BrowserSocket, message: ServerMessage) {
    this.deliver(socket, message);
  }

  broadcast(message: ServerMessage) {
    this.sockets.forEach((socket) => this.deliver(socket, message));
  }

  /** Pages keep recently opened conversations subscribed, hidden; this is whether one is showing it. */
  isShown(conversationId: string) {
    return [...this.sockets].some(({ data: { presence } }) => showsIn(presence, conversationId));
  }

  isWatched(conversationId: string) {
    return [...this.sockets].some(({ data: { presence } }) => presence.attentive && showsIn(presence, conversationId));
  }

  isRoomWatched(roomId: string) {
    return [...this.sockets].some(({ data: { presence } }) => presence.attentive && presence.roomId === roomId);
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
    const message: ServerMessage = { type: "waiting.counted", ...waiting };
    const payload = payloadOf(message);
    if (payload === this.announcedWaiting) return;
    this.announcedWaiting = payload;
    this.notifiers.forEach((socket) => this.deliver(socket, message));
  }

  /** Of pages, only the desktop app's notification sockets hear it; it goes out only when it changed. */
  announceRunningTurnsCount(count: number) {
    if (count === this.announcedRunningTurnsCount) return;
    this.announcedRunningTurnsCount = count;
    const message: ServerMessage = { type: "running-turns.counted", count };
    this.notifiers.forEach((socket) => this.deliver(socket, message));
    this.runningTurnsListeners.forEach((listener) => listener(count));
  }

  whenRunningTurnsCounted(listener: (count: number) => void) {
    this.runningTurnsListeners.push(listener);
  }

  /** Pages show it whichever device they are on, as it is about this host; another machine's desktop app runs an install of its own. */
  announceNewerVersion(newerVersion: NewerVersion | null) {
    const message: ServerMessage = { type: "newer-version.found", newerVersion };
    [...this.sockets, ...[...this.notifiers].filter(({ data }) => data.deviceId === null)].forEach((socket) => this.deliver(socket, message));
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
    const message: ServerMessage = { type: "system-notification", notification };
    const isNotifier = ({ data }: BrowserSocket) => data.role === "notifier";
    const listenersOn = (device: BrowserSocket[]) => (device.some(isNotifier) ? device.filter(isNotifier) : device);
    [...Map.groupBy(sockets, ({ data }) => data.deviceId).values()].flatMap(listenersOn).forEach((socket) => this.deliver(socket, message));
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
    this.sockets.forEach((socket) => {
      if (isRecipient(socket)) this.deliver(socket, message);
    });
  }

  /** A document's whole state, to the pages that show that document. */
  publishAppState(state: AppDocumentState) {
    this.publishWhere((socket) => socket.data.appSubscriptions.has(state.documentId), { type: "app.state", state });
  }

  /** What an app's views keep in a workspace, to the pages that show any document of that app. */
  publishAppStorage(workspaceId: string, app: string, items: AppStorageItems) {
    this.publishWhere((socket) => socket.data.appStorageSubscriptions.has(appKey({ workspaceId, app })), { type: "app.storage", workspaceId, app, items });
  }

  publishToPluginWindows(plugin: string, message: ServerMessage) {
    this.publishWhere((socket) => socket.data.pluginWindowSubscriptions.has(plugin), message);
  }

  publishToPluginTabs(workspaceId: string, message: ServerMessage) {
    this.publishWhere((socket) => socket.data.pluginTabSubscriptions.has(workspaceId), message);
  }

  publishToRoom(roomId: string, message: ServerMessage) {
    this.publishWhere((socket) => socket.data.roomSubscriptions.has(roomId), message);
  }

  publishToConversation(conversationId: string, message: ServerMessage) {
    this.publishWhere((socket) => socket.data.subscriptions.has(conversationId), message);
  }

  publishEvent(conversationId: string, event: StoredEvent) {
    const forPage = once((): ServerMessage => ({ type: "conversation.event", conversationId, event: pageEvent(event) }));
    const lowData = once((): ServerMessage => ({ type: "conversation.event", conversationId, event: lowDataEvent(conversationId, event) }));
    this.sockets.forEach((socket) => {
      if (socket.data.subscriptions.has(conversationId)) this.deliver(socket, socket.data.lowDataSubscriptions.has(conversationId) ? lowData() : forPage());
    });
  }
}

import type { NewerVersion } from "../../../shared/newer-version.ts";
import { DESKTOP_APP_CODE_PARAMETER, TOKEN_COOKIE, type ServerMessage } from "../../../shared/protocol.ts";
import { bodyWithWorkspace, type SystemNotification } from "../../../shared/system-notifications.ts";
import type { WaitingSummary } from "../../../shared/waiting.ts";

const RETRY_DELAY_MILLISECONDS = 2_000;
const NOTHING_WAITING: WaitingSummary = { count: 0, mostUrgent: null };

export interface NativeNotification {
  title: string;
  subtitle?: string;
  body: string;
}

/** macOS has a subtitle line for the workspace; notify-send on Linux does not. */
export const nativeNotification = (notification: SystemNotification, platform: NodeJS.Platform): NativeNotification =>
  platform === "darwin"
    ? { title: notification.title, subtitle: notification.workspace, body: notification.body }
    : { title: notification.title, body: bodyWithWorkspace(notification) };

export function notificationSocketUrl(origin: string, builtFromCode: string | null = null) {
  const url = new URL("/notifications", origin.replace(/^http/, "ws"));
  if (builtFromCode !== null) url.searchParams.set(DESKTOP_APP_CODE_PARAMETER, builtFromCode);
  return url.href;
}

export interface NotificationSocket {
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  close(): void;
}

export type SocketOpener = (url: string, headers: Record<string, string>) => NotificationSocket;

/** With the DOM library loaded, TypeScript hides the overload of Bun's WebSocket that takes headers. */
type BunWebSocket = new (url: string, options: Bun.WebSocketOptions) => WebSocket;

export const openWebSocket: SocketOpener = (url, headers) => new (WebSocket as unknown as BunWebSocket)(url, { headers });

export interface HostNotificationsOptions {
  origin: string;
  /** Read again for every connection: the host writes it on its first start, which may come after the app's. */
  token: () => string | null;
  show: (notification: SystemNotification) => void;
  /** How many conversations wait for you and the most urgent one's tone, which the host sends on connecting and whenever they may have changed. */
  showWaiting?: (waiting: WaitingSummary) => void;
  /** The number of running turns, which the host sends on connecting and whenever it changes. */
  showRunningTurnsCount?: (count: number) => void;
  /** A newer Mirador than the host, which the host sends on connecting while there is one, and whenever it finds another; null once the host goes away. */
  showNewerVersion?: (newerVersion: NewerVersion | null) => void;
  /** What the app was built from, for the host to tell when its checkout has moved on; a release build has none. */
  builtFromCode?: string | null;
  open?: SocketOpener;
  retryDelayMilliseconds?: number;
}

/** Listens to the host for system notifications, connecting again whenever the host restarts or is not up yet. */
export class HostNotifications {
  private socket?: NotificationSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private readonly options: HostNotificationsOptions) {}

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.close();
  }

  private connect() {
    const { origin, token, show, showWaiting = () => {}, showRunningTurnsCount = () => {}, showNewerVersion = () => {}, builtFromCode = null, open = openWebSocket } = this.options;
    const currentToken = token();
    if (!currentToken) return this.connectLater();
    const socket = open(notificationSocketUrl(origin, builtFromCode), { Origin: origin, Cookie: `${TOKEN_COOKIE}=${currentToken}` });
    this.socket = socket;
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type === "system-notification") show(message.notification);
      if (message.type === "waiting.counted") showWaiting({ count: message.count, mostUrgent: message.mostUrgent ?? null });
      if (message.type === "running-turns.counted") showRunningTurnsCount(message.count);
      if (message.type === "newer-version.found") showNewerVersion(message.newerVersion);
    };
    socket.onclose = () => {
      showWaiting(NOTHING_WAITING);
      showRunningTurnsCount(0);
      showNewerVersion(null);
      this.connectLater();
    };
  }

  private connectLater() {
    if (this.stopped) return;
    this.retry = setTimeout(() => this.connect(), this.options.retryDelayMilliseconds ?? RETRY_DELAY_MILLISECONDS);
  }
}

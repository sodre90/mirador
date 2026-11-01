import { PROFILE_LAUNCH_PARAMETER, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";

export type ConnectionStatus = "connecting" | "open" | "unauthorized" | "reconnecting";

type MessageListener = (message: ServerMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;

const MAX_RETRY_DELAY_MS = 10_000;

export class Connection {
  private socket?: WebSocket;
  private retryDelay = 500;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly unsent: ClientMessage[] = [];
  status: ConnectionStatus = "connecting";

  connect() {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws?${PROFILE_LAUNCH_PARAMETER}`);
    this.socket = socket;
    let opened = false;
    socket.onopen = () => {
      opened = true;
      this.retryDelay = 500;
      this.unsent.splice(0).forEach((message) => socket.send(JSON.stringify(message)));
      this.setStatus("open");
    };
    socket.onmessage = (event) => {
      this.dispatchMessage(JSON.parse(String(event.data)) as ServerMessage);
    };
    socket.onclose = async () => {
      if (!opened && (await this.isUnauthorized())) return this.setStatus("unauthorized");
      this.setStatus("reconnecting");
      setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
    };
  }

  /** Sends at once, or as soon as the socket opens, so that what the user does while the page connects or reconnects counts. */
  send(message: ClientMessage): boolean {
    if (this.status === "unauthorized") return false;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    else this.unsent.push(message);
    return true;
  }

  /**
   * Sends a request that expects a response. Rejects if disconnected or if the connection
   * drops while waiting, and unsubscribes its message and status listeners on settlement.
   */
  sendAndAwait<T>(
    send: (requestId: string) => ClientMessage,
    pick: (message: ServerMessage, requestId: string) => T | undefined,
  ): Promise<T> {
    if (this.status !== "open" || (this.socket && this.socket.readyState !== WebSocket.OPEN)) {
      return Promise.reject(new Error("Not connected to the host."));
    }
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanUp = () => {
        settled = true;
        unsubscribeMessage();
        unsubscribeStatus();
      };
      const unsubscribeMessage = this.onMessage((message) => {
        if (settled) return;
        try {
          const picked = pick(message, requestId);
          if (picked !== undefined) {
            cleanUp();
            resolve(picked);
          }
        } catch (error) {
          cleanUp();
          reject(error);
        }
      });
      const unsubscribeStatus = this.onStatus((status) => {
        if (settled) return;
        if (status !== "open") {
          cleanUp();
          reject(new Error("Disconnected from the host."));
        }
      });
      if (!this.send(send(requestId))) {
        cleanUp();
        reject(new Error("Not connected to the host."));
      }
    });
  }

  onMessage(listener: MessageListener) {
    this.messageListeners.add(listener);
    return () => void this.messageListeners.delete(listener);
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => void this.statusListeners.delete(listener);
  }

  dispatchMessage(message: ServerMessage) {
    this.messageListeners.forEach((listener) => listener(message));
  }

  setStatus(status: ConnectionStatus) {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  get listenerCount() {
    return {
      messages: this.messageListeners.size,
      statuses: this.statusListeners.size,
    };
  }

  private async isUnauthorized() {
    const probe = await fetch("/ws").catch(() => null);
    return probe?.status === 401;
  }
}

export const connection = new Connection();

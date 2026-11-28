import { sentByPeople } from "../shared/person-messages.ts";
import { OUT_OF_ROOMS_CLOSE_CODE, PROFILE_LAUNCH_PARAMETER, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";

/** `out-of-rooms`: the host took the person this page signed in as out of their last room there, and with it every way back in. */
export type ConnectionStatus = "connecting" | "open" | "unauthorized" | "reconnecting" | "out-of-rooms";

type MessageListener = (message: ServerMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;

const MAX_RETRY_DELAY_MS = 10_000;

/** Beside the page rather than at the root: a machine shown as someone else's is under its relay's key, which signs in only what asks there. */
const besideThePage = (path: string) => new URL(path, location.href);

function socketAddress() {
  const address = besideThePage(`ws?${PROFILE_LAUNCH_PARAMETER}`);
  address.protocol = address.protocol.replace(/^http/, "ws");
  return address;
}

export class Connection {
  private socket?: WebSocket;
  private retryDelay = 500;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly unsent: ClientMessage[] = [];
  /** The host's snapshot, the first message on each connection, says who the page signed in as; until it comes, what the page sends waits. */
  private snapshotCame = false;
  /** Signed in as a person other than the machine's owner, the page holds back all the host refuses from people. */
  private sendsAsPerson = false;
  /** The run of the host the page was loaded from: a restarted host may speak a newer protocol and serves newer UI code. */
  private loadedFromHostRun: string | null = null;
  status: ConnectionStatus = "connecting";

  connect() {
    const socket = new WebSocket(socketAddress());
    this.socket = socket;
    this.snapshotCame = false;
    let opened = false;
    socket.onopen = () => {
      opened = true;
      this.retryDelay = 500;
      this.setStatus("open");
    };
    socket.onmessage = (event) => {
      this.dispatchMessage(JSON.parse(String(event.data)) as ServerMessage);
    };
    socket.onclose = async ({ code }) => {
      if (code === OUT_OF_ROOMS_CLOSE_CODE) return this.setStatus("out-of-rooms");
      if (!opened && (await this.isUnauthorized())) return this.setStatus("unauthorized");
      this.setStatus("reconnecting");
      setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
    };
  }

  /** Sends at once, or as soon as the host's snapshot comes, so that what the user does while the page connects or reconnects counts. */
  send(message: ClientMessage): boolean {
    if (this.status === "unauthorized" || this.status === "out-of-rooms" || !this.mayBeSent(message)) return false;
    if (this.snapshotCame && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    else this.unsent.push(message);
    return true;
  }

  private mayBeSent(message: ClientMessage) {
    return !this.sendsAsPerson || sentByPeople(message);
  }

  private sendWaitingAs({ you, ownerId }: Extract<ServerMessage, { type: "snapshot" }>) {
    this.snapshotCame = true;
    this.sendsAsPerson = you !== ownerId;
    this.unsent
      .splice(0)
      .filter((message) => this.mayBeSent(message))
      .forEach((message) => this.socket?.send(JSON.stringify(message)));
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

  /** A snapshot of a restarted host loads the page again from it before any of the page reads that snapshot, which its older code may not be able to. */
  dispatchMessage(message: ServerMessage) {
    if (message.type === "snapshot") {
      this.sendWaitingAs(message);
      if (this.isOfAnotherHostRun(message.hostRunId)) return location.reload();
    }
    this.messageListeners.forEach((listener) => listener(message));
  }

  private isOfAnotherHostRun(hostRunId: string) {
    this.loadedFromHostRun ??= hostRunId;
    return hostRunId !== this.loadedFromHostRun;
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
    const probe = await fetch(besideThePage("ws")).catch(() => null);
    return probe?.status === 401;
  }
}

export const connection = new Connection();

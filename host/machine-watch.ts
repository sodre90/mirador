import type { Conversation, Machine, MachineStatus, WaitingFor } from "../shared/model.ts";
import { TOKEN_COOKIE, type ServerMessage } from "../shared/protocol.ts";
import type { SystemNotification } from "../shared/system-notifications.ts";
import { signInRevoked } from "./machine-sign-in.ts";
import { trusting } from "./machine-trust.ts";
import type { Store } from "./store.ts";

/** Waits longer after each failed try in a row, so a machine that is off is asked about once a minute at most. */
const RECONNECT_DELAYS_MS = [2_000, 5_000, 15_000, 60_000];

/** With the DOM library loaded, TypeScript hides the overload of Bun's WebSocket that takes headers. */
type BunWebSocket = new (url: string, options: Bun.WebSocketOptions) => WebSocket;

/** A socket to a machine that opens again whenever it closes, for as long as it is wanted. */
class MachineSocket {
  private socket: WebSocket | null = null;
  private retry?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly signIn: () => Bun.WebSocketOptions | null,
    private readonly events: { opened?: () => void; message: (message: ServerMessage) => void; closed?: () => void; refused?: () => void },
  ) {}

  start() {
    const options = this.signIn();
    if (!options || this.stopped) return;
    const socket = new (WebSocket as unknown as BunWebSocket)(this.url, options);
    this.socket = socket;
    let opened = false;
    socket.onopen = () => {
      opened = true;
      this.failures = 0;
      this.events.opened?.();
    };
    socket.onmessage = ({ data }) => this.receive(data);
    socket.onclose = () => {
      this.socket = null;
      this.events.closed?.();
      if (!opened && !this.stopped) this.events.refused?.();
      if (this.stopped) return;
      this.retry = setTimeout(() => this.start(), RECONNECT_DELAYS_MS[Math.min(this.failures++, RECONNECT_DELAYS_MS.length - 1)]);
    };
  }

  /** A message this host cannot read or follow, e.g. from a machine on another version, is skipped rather than taking the host down. */
  private receive(data: unknown) {
    try {
      this.events.message(JSON.parse(String(data)) as ServerMessage);
    } catch (error) {
      console.error(`skipped a message from ${this.url} it could not follow:`, error);
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.close();
  }
}

interface WatchedMachine {
  sockets: MachineSocket[];
  status: MachineStatus;
  waitingIn: Map<string, WaitingFor>;
}

const waitingOf = (conversations: Conversation[]) =>
  new Map(conversations.flatMap(({ id, waitingFor }) => (waitingFor ? [[id, waitingFor] as const] : [])));

/**
 * Keeps up with each joined machine while this host runs: whether it answers, which of its conversations wait for
 * you, and its notifications, which it passes on as this host's own. It listens as a page for the conversations and
 * as a desktop app for the notifications, so the machine tells this host instead of the frames this host shows it in.
 */
export class MachineWatch {
  private readonly watched = new Map<string, WatchedMachine>();

  constructor(
    private readonly store: Store,
    private readonly statusChanged: (status: MachineStatus) => void,
    private readonly notify: (notification: SystemNotification) => void,
    private readonly signedOut: (machineId: string) => void,
  ) {}

  startAll() {
    this.store.listMachines().forEach((machine) => this.start(machine.id));
  }

  /** Again from the start, e.g. with the token of a new join. */
  start(machineId: string) {
    this.stop(machineId);
    const machine = this.store.findMachine(machineId);
    if (!machine?.joined) return;
    const watched: WatchedMachine = { sockets: [], status: { machineId, reachable: false, waiting: [] }, waitingIn: new Map() };
    const signIn = () => {
      const token = this.store.machineDeviceToken(machineId);
      return token ? { headers: { Origin: machine.origin, Cookie: `${TOKEN_COOKIE}=${token}` }, ...trusting(this.store.machineAuthority(machineId)) } : null;
    };
    const socketUrl = (path: string) => `${machine.origin.replace(/^http/, "ws")}${path}`;
    watched.sockets = [
      new MachineSocket(socketUrl("/ws"), signIn, {
        opened: () => this.update(watched, { reachable: true }),
        message: (message) => this.follow(watched, message),
        closed: () => this.update(watched, { reachable: false }),
        refused: () => signInRevoked(this.store, machineId).then((revoked) => revoked && this.signedOut(machineId)),
      }),
      new MachineSocket(socketUrl("/notifications"), signIn, {
        message: (message) => message.type === "system-notification" && this.notify(this.passedOn(machine, message.notification)),
      }),
    ];
    this.watched.set(machineId, watched);
    watched.sockets.forEach((socket) => socket.start());
  }

  stop(machineId: string) {
    this.watched.get(machineId)?.sockets.forEach((socket) => socket.stop());
    this.watched.delete(machineId);
  }

  stopAll() {
    [...this.watched.keys()].forEach((machineId) => this.stop(machineId));
  }

  statuses(): MachineStatus[] {
    return [...this.watched.values()].map(({ status }) => status);
  }

  private follow(watched: WatchedMachine, message: ServerMessage) {
    switch (message.type) {
      case "snapshot":
        watched.waitingIn = waitingOf(message.conversations);
        break;
      case "conversation.upserted":
        watched.waitingIn.delete(message.conversation.id);
        if (message.conversation.waitingFor) watched.waitingIn.set(message.conversation.id, message.conversation.waitingFor);
        break;
      case "conversation.deleted":
        watched.waitingIn.delete(message.conversationId);
        break;
      default:
        return;
    }
    this.update(watched, { waiting: [...watched.waitingIn.values()].sort() });
  }

  private update(watched: WatchedMachine, change: Partial<MachineStatus>) {
    const next = { ...watched.status, ...change };
    if (next.reachable === watched.status.reachable && next.waiting.join() === watched.status.waiting.join()) return;
    watched.status = next;
    this.statusChanged(next);
  }

  private passedOn(machine: Machine, notification: SystemNotification): SystemNotification {
    return { ...notification, machineId: machine.id, workspace: notification.workspace ? `${machine.name} · ${notification.workspace}` : machine.name };
  }
}

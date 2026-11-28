import { describe, expect, test } from "bun:test";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { Connection } from "../web/connection.ts";

/** The first of what the host sends on a connection, as far as who the page signed in as goes. */
const snapshotFor = (you: string): ServerMessage => ({ type: "snapshot", you, ownerId: "owner" }) as Extract<ServerMessage, { type: "snapshot" }>;

function connectionWithSocket() {
  const connection = new Connection();
  const sentMessages: ClientMessage[] = [];
  (connection as unknown as { socket: { readyState: number; send: (raw: string) => void } }).socket = {
    readyState: 1, // WebSocket.OPEN
    send: (raw: string) => sentMessages.push(JSON.parse(raw) as ClientMessage),
  };
  connection.setStatus("open");
  return { connection, sentMessages };
}

function openConnection(you = "owner") {
  const opened = connectionWithSocket();
  opened.connection.dispatchMessage(snapshotFor(you));
  return opened;
}

describe("Connection.send", () => {
  test("holds what the page sends until the host's snapshot says who it signed in as, then sends it in order", () => {
    const { connection, sentMessages } = connectionWithSocket();
    connection.send({ type: "ping" });
    connection.send({ type: "conversation.subscribe", conversationId: "c1" });
    expect(sentMessages).toEqual([]);
    connection.dispatchMessage(snapshotFor("owner"));
    expect(sentMessages.map(({ type }) => type)).toEqual(["ping", "conversation.subscribe"]);
    connection.send({ type: "ping" });
    expect(sentMessages).toHaveLength(3);
  });

  test("signed in as a person other than the owner, sends nothing the host refuses people, held or not", () => {
    const { connection, sentMessages } = connectionWithSocket();
    connection.send({ type: "conversation.cancel", conversationId: "c1" });
    connection.send({ type: "room.subscribe", roomId: "r1" });
    connection.dispatchMessage(snapshotFor("mia"));
    expect(connection.send({ type: "room.usage.get", requestId: "u1", roomId: "r1", since: null })).toBe(false);
    expect(connection.send({ type: "presence", conversationId: null, attentive: true, roomId: "r1", visible: true })).toBe(true);
    expect(connection.send({ type: "room.writing", roomId: "r1", threadId: null, writing: true })).toBe(true);
    expect(connection.send({ type: "room.write", roomId: "r1", text: "hello", tags: [], threadId: null })).toBe(true);
    expect(sentMessages.map(({ type }) => type)).toEqual(["room.subscribe", "presence", "room.writing", "room.write"]);
  });
});

describe("a snapshot of a restarted host", () => {
  test("loads the page again before anything on it reads that snapshot, and the reconnection's snapshots of the same run go on to it", () => {
    const reloads: number[] = [];
    const pageLocation = globalThis.location;
    globalThis.location = { reload: () => void reloads.push(Date.now()) } as unknown as Location;
    try {
      const { connection } = connectionWithSocket();
      const read: ServerMessage[] = [];
      connection.onMessage((message) => read.push(message));
      const ofRun = (hostRunId: string) => ({ ...snapshotFor("owner"), hostRunId }) as ServerMessage;

      connection.dispatchMessage(ofRun("first"));
      connection.dispatchMessage(ofRun("first"));
      expect(read).toHaveLength(2);
      expect(reloads).toHaveLength(0);

      connection.dispatchMessage(ofRun("second"));
      expect(read, "the page never reads the newer host's snapshot").toHaveLength(2);
      expect(reloads).toHaveLength(1);
    } finally {
      globalThis.location = pageLocation;
    }
  });
});

describe("Connection.sendAndAwait", () => {
  test("rejects immediately when not connected, without leaking listeners", async () => {
    const connection = new Connection();
    expect(connection.status).toBe("connecting");

    await expect(
      connection.sendAndAwait(
        (requestId) => ({ type: "devices.invite", requestId }),
        (message, id) => (message.type === "devices.invited" && message.requestId === id ? message : undefined),
      ),
    ).rejects.toThrow("Not connected to the host.");

    expect(connection.listenerCount).toEqual({ messages: 0, statuses: 0 });
  });

  test("sends the request, resolves when answered, and cleans up listeners", async () => {
    const { connection, sentMessages } = openConnection();

    const pending = connection.sendAndAwait(
      (requestId) => ({ type: "settings.set-network", requestId, on: true }),
      (message, id) => (message.type === "settings.saved" && message.requestId === id ? message.problem : undefined),
    );

    expect(sentMessages).toHaveLength(1);
    const sent = sentMessages[0] as Extract<ClientMessage, { type: "settings.set-network" }>;
    expect(sent.type).toBe("settings.set-network");
    expect(sent.on).toBe(true);
    expect(connection.listenerCount).toEqual({ messages: 1, statuses: 1 });

    connection.dispatchMessage({ type: "settings.saved", requestId: sent.requestId, problem: null });

    const problem = await pending;
    expect(problem).toBeNull();
    expect(connection.listenerCount).toEqual({ messages: 0, statuses: 0 });
  });

  test("rejects when pick throws an error and cleans up listeners", async () => {
    const { connection, sentMessages } = openConnection();

    const pending = connection.sendAndAwait(
      (requestId) => ({ type: "changes.list", requestId, conversationId: "c1", scope: "turn" }),
      (message, id) => {
        if (message.type === "changes.failed" && message.requestId === id) throw new Error(message.message);
        return undefined;
      },
    );

    const sent = sentMessages[0] as Extract<ClientMessage, { type: "changes.list" }>;
    connection.dispatchMessage({ type: "changes.failed", requestId: sent.requestId, message: "File not found" });

    await expect(pending).rejects.toThrow("File not found");
    expect(connection.listenerCount).toEqual({ messages: 0, statuses: 0 });
  });

  test("rejects when connection drops in flight and cleans up listeners", async () => {
    const { connection } = openConnection();

    const pending = connection.sendAndAwait(
      (requestId) => ({ type: "devices.invite", requestId }),
      (message, id) => (message.type === "devices.invited" && message.requestId === id ? message : undefined),
    );

    expect(connection.listenerCount).toEqual({ messages: 1, statuses: 1 });

    connection.setStatus("reconnecting");

    await expect(pending).rejects.toThrow("Disconnected from the host.");
    expect(connection.listenerCount).toEqual({ messages: 0, statuses: 0 });
  });
});

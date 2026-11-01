import { describe, expect, test } from "bun:test";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { Connection } from "../web/connection.ts";

function openConnection() {
  const connection = new Connection();
  const sentMessages: ClientMessage[] = [];
  (connection as unknown as { socket: { readyState: number; send: (raw: string) => void } }).socket = {
    readyState: 1, // WebSocket.OPEN
    send: (raw: string) => sentMessages.push(JSON.parse(raw) as ClientMessage),
  };
  connection.setStatus("open");
  return { connection, sentMessages };
}

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

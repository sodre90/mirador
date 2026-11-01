import { expect, test } from "bun:test";

const sessionExtensionModule = "pi-acp/dist/session-extension.js";
const { default: sessionExtension, STEER_MARK } = (await import(sessionExtensionModule)) as { default: (pi: object) => void; STEER_MARK: string };

test("Mirador's pi extension turns down a pi older than 0.99.0, which has no MCP servers to give the canvas to", () => {
  expect(() => sessionExtension({ on: () => {} })).toThrow("Mirador needs pi 0.99.0 or later. Update pi with npm install -g @earendil-works/pi-coding-agent");
});

function fakePi() {
  const handlers = new Map<string, ((event: object) => void)[]>();
  const entries: { customType: string; data: unknown }[] = [];
  const pi = {
    registerMcpServer: () => {},
    on: (name: string, handler: (event: object) => void) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
  };
  const emit = (name: string, event: object) => handlers.get(name)?.forEach((handler) => handler(event));
  const userMessageEnds = (timestamp: number) => emit("message_end", { message: { role: "user", timestamp } });
  return { pi, emit, userMessageEnds, entries };
}

test("pi's user messages that joined a run are marked, by their timestamp, and the one a run started with is not", () => {
  const { pi, emit, userMessageEnds, entries } = fakePi();
  sessionExtension(pi);
  emit("before_agent_start", { messageType: "user" });
  userMessageEnds(1);
  emit("message_end", { message: { role: "assistant", timestamp: 2 } });
  userMessageEnds(3);
  emit("before_agent_start", { messageType: "custom" });
  userMessageEnds(4);
  expect(entries).toEqual([
    { customType: STEER_MARK, data: { timestamp: 3 } },
    { customType: STEER_MARK, data: { timestamp: 4 } },
  ]);
});

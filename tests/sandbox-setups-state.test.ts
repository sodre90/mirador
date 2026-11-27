import { expect, test } from "bun:test";
import type { ServerMessage } from "../shared/protocol.ts";
import { roomSandbox, setupOf, workspaceSandbox } from "../shared/sandbox.ts";
import { initialState, reducer } from "../web/state.ts";
import { snapshotMessage } from "./snapshot-message.ts";

const fromHost = (message: ServerMessage) => ({ type: "server" as const, message });
const project = workspaceSandbox("project");
const garden = roomSandbox("garden");

test("the page keeps where each sandbox's setup stands, apart from the others'", () => {
  const connected = reducer(initialState, fromHost(snapshotMessage({ sandboxSetups: [{ owner: project, setup: { stage: "pulling-image", image: "team/dev:1" } }] })));
  const moved = reducer(connected, fromHost({ type: "sandbox.setup", owner: garden, setup: { stage: "ready" } }));
  const checked = reducer(moved, fromHost({ type: "sandbox.setup", owner: project, setup: { stage: "checking-image", image: "team/dev:1" } }));
  expect(setupOf(checked.sandboxSetups, project)).toEqual({ stage: "checking-image", image: "team/dev:1" });
  expect(setupOf(checked.sandboxSetups, garden)).toEqual({ stage: "ready" });
  expect(setupOf(checked.sandboxSetups, workspaceSandbox("other"))).toEqual({ stage: "not-started" });
});

test("a host that hasn't restarted since the page was rebuilt, which says one setup for every sandbox, leaves each not started", () => {
  const { sandboxSetups: _, ...ofAnOlderHost } = snapshotMessage();
  const connected = reducer(initialState, fromHost(ofAnOlderHost as ServerMessage));
  expect(connected.sandboxSetups).toEqual([]);
  const moved = reducer(connected, fromHost({ type: "sandbox.setup", setup: { stage: "installing-tool" } } as unknown as ServerMessage));
  expect(setupOf(moved.sandboxSetups, project)).toEqual({ stage: "not-started" });
});

import { expect, test } from "bun:test";
import type { ServerMessage } from "../shared/protocol.ts";
import { initialState, reducer } from "../web/state.ts";
import { snapshotMessage } from "./snapshot-message.ts";

const fromHost = (message: ServerMessage) => ({ type: "server" as const, message });
const counter = { title: "Counter", reason: "It counts your keystrokes." };

test("the page lists the revoked plugins the host runs, from its snapshot and as the catalog changes; a host older than revocations lists none", () => {
  expect(reducer(initialState, fromHost(snapshotMessage())).revokedPlugins).toEqual([]);
  const told = reducer(initialState, fromHost(snapshotMessage({ revokedPlugins: [counter] })));
  expect(told.revokedPlugins).toEqual([counter]);
  expect(reducer(told, fromHost({ type: "plugins.revoked-running", plugins: [] })).revokedPlugins).toEqual([]);
});

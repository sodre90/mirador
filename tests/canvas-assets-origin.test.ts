import { expect, test } from "bun:test";
import type { ShowItem } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { initialState, reducer, selectedOpen, type AppState } from "../web/state.ts";

const agentsOrigin = "https://box.local:4603";
const page = (html: string): ShowItem => ({ id: "item", conversationId: "a", kind: "show", title: "Chart", html, status: "shown", createdAt: 0 });
const chart = page(`<script src="${agentsOrigin}/d3.min.js"></script><p>${agentsOrigin}</p>`);

function connectedAt(canvasAssetsOrigin: string): AppState {
  const snapshot = {
    type: "snapshot",
    workspaces: [],
    workspaceGroups: [],
    conversations: [],
    profiles: [],
    promptTemplates: [],
    canvasUse: "often",
    claudeProgram: { configured: "", found: null, version: null, installFolders: "", installCommand: "" },
    scriptProgram: "",
    avatar: null,
    canvasAssetsOrigin,
    agentsCanvasAssetsOrigin: agentsOrigin,
    installedAgents: ["claude"],
    machines: [],
    machineStatuses: [],
    homeDir: "/home/me",
    hostRunId: "run",
    hostCodeChanged: false,
    desktopAppOutdated: false,
    version: "0.2.0",
    newerVersion: null,
    installedApps: [],
    openApps: [],
    canvasViews: {},
  } satisfies ServerMessage;
  const connected = reducer(initialState, { type: "server", message: snapshot });
  return reducer(connected, { type: "select", conversationId: "a" });
}

const shownHtml = (state: AppState) => {
  const shown = selectedOpen(state)?.canvas[0];
  return shown?.kind === "show" ? shown.html : undefined;
};

test("a page that reached the host at another address loads canvas libraries from there, in history and in new pages", () => {
  const local = connectedAt("http://127.0.0.1:4601");
  const history = reducer(local, { type: "server", message: { type: "conversation.history", conversationId: "a", events: [], canvas: [chart] } });
  expect(shownHtml(history)).toBe(`<script src="http://127.0.0.1:4601/d3.min.js"></script><p>http://127.0.0.1:4601</p>`);

  const upserted = reducer(local, { type: "server", message: { type: "canvas.upserted", item: chart } });
  expect(shownHtml(upserted)).toContain(`src="http://127.0.0.1:4601/d3.min.js"`);
});

test("a page at the address agents were given shows their pages as written", () => {
  const atAgentsAddress = connectedAt(agentsOrigin);
  const state = reducer(atAgentsAddress, { type: "server", message: { type: "canvas.upserted", item: chart } });
  expect(shownHtml(state)).toBe(chart.html);
});

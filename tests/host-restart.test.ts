import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { ConversationService, agentFinishedItsTurn, lastTurnRequest, openTurnTheAgentWorkedOn, unfinishedTurnRequest } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { HostRestart, hostCommandLine, relaunchOf, stoppedWithinTimeout, takeRelaunchEnvironment, takeTurnsStoppedForRestart } from "../host/restart.ts";
import { Store } from "../host/store.ts";
import type { ConversationEvent } from "../shared/model.ts";
import { isEdit, SourceWatcher } from "../host/source-watcher.ts";

describe("hostCommandLine", () => {
  /** The desktop app does not run on Windows yet, and knows its host by host/main.ts, which a restart there gives as host\main.ts. */
  test.todoIf(process.platform === "win32")("restarts with the command line the host was started with, which the desktop app recognises its host by", () => {
    expect(hostCommandLine("bun", "/repo/host/main.ts", "/repo", [])).toEqual(["bun", "host/main.ts"]);
    expect(hostCommandLine("/opt/bun", "/repo/host/main.ts", "/repo", ["--flag"])).toEqual(["/opt/bun", "host/main.ts", "--flag"]);
  });
});

describe("takeTurnsStoppedForRestart", () => {
  test("tells the next host which turns the previous one stopped, once", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mirador-restart-"));
    const file = join(dataDir, "turns-stopped-for-restart.json");
    expect(takeTurnsStoppedForRestart(dataDir)).toEqual([]);
    writeFileSync(file, JSON.stringify(["c1", "c2"]));
    expect(takeTurnsStoppedForRestart(dataDir)).toEqual(["c1", "c2"]);
    expect(existsSync(file)).toBe(false);
    expect(takeTurnsStoppedForRestart(dataDir)).toEqual([]);
  });
});

/** A conversation that ran a turn before, so it has a session, on a profile whose pre-launch command runs until `releasePrelaunch`. */
function conversationWithSlowStartingAgent() {
  const scratch = mkdtempSync(join(tmpdir(), "mirador-restart-start-"));
  const prelaunchStarted = join(scratch, "prelaunch-started");
  const prelaunchReleased = join(scratch, "prelaunch-released");
  const workspacePath = join(scratch, "project");
  mkdirSync(workspacePath);
  const store = new Store(":memory:");
  const prelaunch = `touch '${prelaunchStarted}'; while [ ! -e '${prelaunchReleased}' ]; do sleep 0.05; done; exit 3`;
  store.saveProfile({ id: "p1", name: "slow start", harness: "claude", environment: "CLAUDE_CODE_EXECUTABLE=/usr/bin/false", prelaunch, mode: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "project", path: workspacePath, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  store.insertConversation({
    id: "c1",
    workspaceId: "w1",
    harness: "claude",
    profileId: "p1",
    title: "t",
    titleSetByUser: false,
    acpSessionId: "session-of-an-earlier-turn",
    askMode: "wait",
    bypassPermissions: false,
    status: "idle",
    statusDetail: null,
    openInTerminal: null,
    contextUsage: null,
    queuedMessages: [],
    usageLimit: null,
    jobWaits: [],
    asyncTasks: [],
    waitingFor: null,
    pendingRequest: null,
    lastWords: null,
    activity: null,
    configOptions: [],
    createdAt: 1,
    updatedAt: 1,
  });
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, "data") });
  const conversations = new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, {} as never);
  return {
    conversations,
    prelaunchHasStarted: () => existsSync(prelaunchStarted),
    releasePrelaunch: () => writeFileSync(prelaunchReleased, ""),
  };
}

describe("prepareForRestart", () => {
  test("stops a turn whose agent is still starting, and names it for the next host to continue", async () => {
    const { conversations, prelaunchHasStarted, releasePrelaunch } = conversationWithSlowStartingAgent();
    conversations.send("c1", "Fix the build").catch(() => {});
    while (!prelaunchHasStarted()) await Bun.sleep(20);

    const prepared = conversations.prepareForRestart();
    setTimeout(releasePrelaunch, 200);
    expect(await prepared).toEqual(["c1"]);
    expect(conversations.runningTurnsCount()).toBe(0);
  });
});

/** A next host whose store holds a conversation with these events already written, on a profile whose agent fails to start. */
function hostWithEvents(events: ConversationEvent[], store = new Store(":memory:")) {
  const scratch = mkdtempSync(join(tmpdir(), "mirador-restart-resume-"));
  const workspacePath = join(scratch, "project");
  mkdirSync(workspacePath);
  store.saveProfile({ id: "p1", name: "failing", harness: "claude", environment: "CLAUDE_CODE_EXECUTABLE=/usr/bin/false", prelaunch: "", mode: null, bypassPermissions: false, askMode: "wait", color: null, createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "project", path: workspacePath, defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 1 });
  store.insertConversation({
    id: "c1",
    workspaceId: "w1",
    harness: "claude",
    profileId: "p1",
    title: "t",
    titleSetByUser: false,
    acpSessionId: "session-of-an-earlier-turn",
    askMode: "wait",
    bypassPermissions: false,
    status: "idle",
    statusDetail: null,
    openInTerminal: null,
    contextUsage: null,
    queuedMessages: [],
    usageLimit: null,
    jobWaits: [],
    asyncTasks: [],
    waitingFor: null,
    pendingRequest: null,
    lastWords: null,
    activity: null,
    configOptions: [],
    createdAt: 1,
    updatedAt: 1,
  });
  events.forEach((event) => store.appendEvent("c1", event));
  const config = loadConfig({ MIRADOR_DATA_DIR: join(scratch, "data") });
  return new ConversationService(store, new Hub(), config, {} as never, {} as never, {} as never, {} as never);
}

describe("a host continuing turns the previous one stopped for a restart", () => {
  const said = (text: string): ConversationEvent => ({ type: "user-message", text });
  const worked: ConversationEvent = { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "on it" } } };
  const ended: ConversationEvent = { type: "turn-end", stopReason: "end_turn" };
  const cancelled: ConversationEvent = { type: "turn-end", stopReason: "cancelled" };

  test("leaves a turn the agent finished during the wait alone, rather than send its message a second time", () => {
    const conversations = hostWithEvents([said("What colour is the sky?"), worked, ended]);
    conversations.resumeAfterRestart(["c1"]);
    expect(conversations.get("c1").status).toBe("idle");
    void conversations.shutdown();
  });

  test("re-sends an open turn's own message, not the previous turn's", () => {
    const events = [said("What colour is the sky?"), worked, ended, said("Fix the build")].map((event, index) => ({ seq: index + 1, at: index, event }));
    expect(unfinishedTurnRequest(events)).toEqual({ text: "Fix the build", firstText: "Fix the build", imageIds: [] });
  });

  test("still continues a turn the stop really cut short", () => {
    const conversations = hostWithEvents([said("What colour is the sky?"), worked, ended, said("Fix the build"), worked]);
    conversations.resumeAfterRestart(["c1"]);
    expect(conversations.get("c1").status).toBe("starting");
    void conversations.shutdown();
  });

  test("holds a message sent while it reopens the session behind the turn it continues", async () => {
    const conversations = hostWithEvents([said("Fix the build"), worked]);
    conversations.resumeAfterRestart(["c1"]);
    await conversations.send("c1", "And run the tests");
    expect(conversations.get("c1").queuedMessages.map(({ text }) => text)).toEqual(["And run the tests"]);
    void conversations.shutdown();
  });

  test("sends the message it held once the session fails to reopen, rather than keep it waiting", async () => {
    const store = new Store(":memory:");
    const conversations = hostWithEvents([said("Fix the build"), worked], store);
    const userMessages = () => store.listEvents("c1").flatMap(({ event }) => (event.type === "user-message" ? [event.text] : []));
    conversations.resumeAfterRestart(["c1"]);
    await conversations.send("c1", "And run the tests");
    while (!userMessages().includes("And run the tests")) await Bun.sleep(20);
    expect(conversations.get("c1").queuedMessages).toEqual([]);
    void conversations.shutdown();
  });

  test("continues a turn the stop cut short with its own request", () => {
    const events = [said("What colour is the sky?"), worked, ended, said("Fix the build"), worked, cancelled].map((event, index) => ({ seq: index + 1, at: index, event }));
    expect(unfinishedTurnRequest(events)?.firstText).toBe("Fix the build");
  });

  test("asks for nothing when the agent finished the turn itself", () => {
    const events = [said("What colour is the sky?"), worked, ended].map((event, index) => ({ seq: index + 1, at: index, event }));
    expect(unfinishedTurnRequest(events)).toBeNull();
  });

  test("goes idle when no turn asks for a resending, rather than continue some other turn", () => {
    const conversations = hostWithEvents([said("What colour is the sky?"), worked, ended, cancelled]);
    conversations.resumeAfterRestart(["c1"]);
    expect(conversations.get("c1").status).toBe("idle");
    void conversations.shutdown();
  });
});

describe("HostRestart", () => {
  test("goes through with a restart whose turns could not be stopped, rather than leave the host holding every queue", async () => {
    const conversations = { prepareForRestart: () => Promise.reject(new Error("The agent is not running")) } as unknown as ConversationService;
    const hub = { broadcast: () => {} } as unknown as Hub;
    let servicesStopped = false;
    let relaunches = 0;
    const restart = new HostRestart(hub, conversations, mkdtempSync(join(tmpdir(), "mirador-restart-")), async () => void (servicesStopped = true), () => void relaunches++);

    await restart.restart();
    expect(servicesStopped).toBe(true);
    expect(relaunches).toBe(1);
  });

  test("refuses before it stops anything when nothing would start the host again", async () => {
    let turnsStopped = false;
    const conversations = { prepareForRestart: async () => ((turnsStopped = true), []) } as unknown as ConversationService;
    const hub = { broadcast: () => {} } as unknown as Hub;
    const restart = new HostRestart(hub, conversations, mkdtempSync(join(tmpdir(), "mirador-restart-")), async () => {}, null);

    await expect(restart.restart()).rejects.toThrow("restart it from the tray or the terminal");
    expect(turnsStopped).toBe(false);
  });
});

describe("relaunchOf", () => {
  test("re-executes the host in place where the system can", () => {
    expect(relaunchOf({}, "darwin", true)).toEqual({ by: "re-executing" });
    expect(relaunchOf({ MIRADOR_RESTART_EXIT_CODE: "75" }, "linux", true)).toEqual({ by: "re-executing" });
  });

  test("on Windows, leaves it to the scheduled task or the desktop app that started the host", () => {
    expect(relaunchOf({ MIRADOR_SCHEDULED_TASK: "Mirador host 4600 S-1-5-21-1" }, "win32", true)).toEqual({ by: "scheduled-task", task: "Mirador host 4600 S-1-5-21-1" });
    expect(relaunchOf({ MIRADOR_RESTART_EXIT_CODE: "75" }, "win32", true)).toEqual({ by: "exit-code", exitCode: 75 });
  });

  test("is taken out of the environment, with the pid written where the app asked, so the host's programs do not act on it", () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), "mirador-relaunch-")), "data", "background-host.pid");
    const env: Record<string, string | undefined> = { MIRADOR_SCHEDULED_TASK: "Mirador-host-4600-S-1", MIRADOR_PID_FILE: pidFile, MIRADOR_RESTART_EXIT_CODE: "75", PATH: "/bin" };
    expect(takeRelaunchEnvironment(env, "win32", false)).toEqual({ by: "scheduled-task", task: "Mirador-host-4600-S-1" });
    expect(env).toEqual({ PATH: "/bin" });
    expect(readFileSync(pidFile, "utf8")).toBe(`${process.pid}\n`);
  });

  test("is none for a host that nothing would start again", () => {
    expect(relaunchOf({}, "win32", true)).toBeNull();
    expect(relaunchOf({ MIRADOR_RESTART_EXIT_CODE: "soon" }, "win32", false)).toBeNull();
    expect(relaunchOf({}, "linux", false)).toBeNull();
  });
});

describe("lastTurnRequest", () => {
  const stored = (events: ConversationEvent[]) => events.map((event, index) => ({ seq: index + 1, at: index, event }));
  const said = (text: string, imageIds?: string[]): ConversationEvent => ({ type: "user-message", text, ...(imageIds && { imageIds }) });
  const cancelled: ConversationEvent = { type: "turn-end", stopReason: "cancelled" };

  test("is what the user asked in the turn a restart stopped: the message that started it and those that joined it", () => {
    const events = stored([said("first"), { type: "turn-end", stopReason: "end_turn" }, said("Fix the build", ["img-1"]), said("and the docs"), cancelled]);
    expect(lastTurnRequest(events)).toEqual({ text: "Fix the build\n\nand the docs", firstText: "Fix the build", imageIds: ["img-1"] });
  });

  test("leaves out a message that joined the turn but went out again after it, as the agent never answered it", () => {
    const events = stored([said("Fix the build"), said("and the docs"), cancelled, { type: "steered-messages-returned", seqs: [2] }]);
    expect(lastTurnRequest(events)).toEqual({ text: "Fix the build", firstText: "Fix the build", imageIds: [] });
  });

  test("counts a turn that failed as ended, and finds nothing in a turn without a message", () => {
    expect(lastTurnRequest(stored([said("lost"), { type: "error", message: "boom" }, said("Try again"), cancelled]))?.firstText).toBe("Try again");
    expect(lastTurnRequest(stored([said("done"), { type: "turn-end", stopReason: "end_turn" }, cancelled]))).toBeNull();
    expect(lastTurnRequest([])).toBeNull();
  });
});

describe("agentFinishedItsTurn", () => {
  const stored = (events: ConversationEvent[]) => events.map((event, index) => ({ seq: index + 1, at: index, event }));
  const said = (text: string): ConversationEvent => ({ type: "user-message", text });
  const worked: ConversationEvent = { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "on it" } } };

  test("is one the agent wrapped up itself, as a turn that finishes during the wait for a restart", () => {
    expect(agentFinishedItsTurn(stored([said("Fix the build"), worked, { type: "turn-end", stopReason: "end_turn" }]))).toBe(true);
  });

  test("is none a stop cut short, one that failed, or one still open", () => {
    expect(agentFinishedItsTurn(stored([said("go"), worked, { type: "turn-end", stopReason: "cancelled" }]))).toBe(false);
    expect(agentFinishedItsTurn(stored([said("go"), worked, { type: "error", message: "boom" }]))).toBe(false);
    expect(agentFinishedItsTurn(stored([said("go"), worked]))).toBe(false);
    expect(agentFinishedItsTurn(stored([said("first"), worked, { type: "turn-end", stopReason: "end_turn" }, said("go"), worked]))).toBe(false);
    expect(agentFinishedItsTurn(stored([]))).toBe(false);
  });
});

describe("openTurnTheAgentWorkedOn", () => {
  const stored = (events: ConversationEvent[]) => events.map((event, index) => ({ seq: index + 1, at: index, event }));
  const said = (text: string): ConversationEvent => ({ type: "user-message", text });
  const worked: ConversationEvent = { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "on it" } } };
  const stopped: ConversationEvent = { type: "turn-end", stopReason: "cancelled" };

  test("is a turn the agent worked on that nothing ended, since the host died in the middle of it", () => {
    expect(openTurnTheAgentWorkedOn(stored([said("go"), worked]))).toBe(true);
    expect(openTurnTheAgentWorkedOn(stored([said("Fix it"), worked, worked]))).toBe(true);
    expect(openTurnTheAgentWorkedOn(stored([said("first"), worked, { type: "turn-end", stopReason: "end_turn" }, said("go"), worked]))).toBe(true);
  });

  test("is none the log ends, whether the agent finished, was stopped or failed", () => {
    expect(openTurnTheAgentWorkedOn(stored([said("go"), worked, { type: "turn-end", stopReason: "end_turn" }]))).toBe(false);
    expect(openTurnTheAgentWorkedOn(stored([said("go"), worked, stopped]))).toBe(false);
    expect(openTurnTheAgentWorkedOn(stored([said("go"), worked, { type: "error", message: "ACP connection closed" }]))).toBe(false);
    expect(openTurnTheAgentWorkedOn(stored([]))).toBe(false);
  });

  test("is none the agent never worked on, which has no session a resume could continue", () => {
    expect(openTurnTheAgentWorkedOn(stored([said("go")]))).toBe(false);
    expect(openTurnTheAgentWorkedOn(stored([said("first"), worked, stopped, said("go")]))).toBe(false);
  });
});

/** Windows tells a watch nothing when the folder it watches is renamed away. */
const toldOfAReplacedWatchedFolder = process.platform !== "win32";

/** Long enough for anything else an edit makes the watch tell of to show too, once what was expected has. */
const SETTLE_MS = 200;

/** Waits for the watch to tell of each of `expected`, which takes longer on a loaded machine, then gives all it told. */
async function toldOnceExpected(edited: string[], expected: string[], timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!expected.every((listener) => edited.includes(listener)) && Date.now() < deadline) await Bun.sleep(20);
  await Bun.sleep(SETTLE_MS);
  return [...new Set(edited)].sort();
}

/** One file edited in a source folder of its own, under a watch of its own, so that nothing told late of another edit mixes in. */
async function staleAfterEditing(file: string, expected: string[]) {
  const sourceDir = mkdtempSync(join(tmpdir(), "mirador-source-"));
  ["web", "shared", "host/acp"].forEach((directory) => mkdirSync(join(sourceDir, directory), { recursive: true }));
  // macOS reports writes from the last few milliseconds before a watch starts.
  await Bun.sleep(200);
  const edited: string[] = [];
  const watcher = new SourceWatcher(sourceDir, { uiEdited: () => edited.push("ui"), hostEdited: () => edited.push("host") });
  watcher.start();
  try {
    writeFileSync(join(sourceDir, file), "export {};\n");
    return await toldOnceExpected(edited, expected);
  } finally {
    watcher.stop();
  }
}

describe("SourceWatcher", () => {
  test("an edit in web/ makes the UI stale, in host/ the host, and in shared/ both", async () => {
    expect(await staleAfterEditing("web/App.tsx", ["ui"])).toEqual(["ui"]);
    expect(await staleAfterEditing("host/acp/harness.ts", ["host"])).toEqual(["host"]);
    expect(await staleAfterEditing("shared/model.ts", ["host", "ui"])).toEqual(["host", "ui"]);
  });

  test("a change Linux tells of without a name is an edit", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "mirador-source-"));
    mkdirSync(join(sourceDir, "acp"));
    writeFileSync(join(sourceDir, "main.ts"), "export {};\n");
    expect(isEdit(sourceDir, undefined)).toBe(true);
    expect(isEdit(sourceDir, null)).toBe(true);
    expect(isEdit(sourceDir, "main.ts")).toBe(true);
    expect(isEdit(sourceDir, "acp")).toBe(false);
  });

  test("replacing a watched folder, as a deploy can, makes the UI stale, and edits in the new folder are heard", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "mirador-source-"));
    ["web", "shared", "host"].forEach((directory) => mkdirSync(join(sourceDir, directory)));
    await Bun.sleep(200);
    const edited: string[] = [];
    const watcher = new SourceWatcher(sourceDir, { uiEdited: () => edited.push("ui"), hostEdited: () => edited.push("host") });
    watcher.start();
    try {
      renameSync(join(sourceDir, "web"), join(sourceDir, "web.old"));
      mkdirSync(join(sourceDir, "web"));
      writeFileSync(join(sourceDir, "web", "App.tsx"), "export {};\n");
      expect(await toldOnceExpected(edited, ["ui"])).toEqual(["ui"]);
      edited.length = 0;
      writeFileSync(join(sourceDir, "web", "Other.tsx"), "export {};\n");
      expect(await toldOnceExpected(edited, ["ui"])).toEqual(["ui"]);
    } finally {
      watcher.stop();
    }
  });

  test("loading a module is not an edit, though Windows tells of its folder then", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "mirador-source-"));
    ["web", "shared", "host/acp"].forEach((directory) => mkdirSync(join(sourceDir, directory), { recursive: true }));
    writeFileSync(join(sourceDir, "host", "acp", "harness.ts"), "export const loaded = true;\n");
    await Bun.sleep(200);
    const edited: string[] = [];
    const watcher = new SourceWatcher(sourceDir, { uiEdited: () => edited.push("ui"), hostEdited: () => edited.push("host") });
    watcher.start();
    try {
      expect((await import(join(sourceDir, "host", "acp", "harness.ts"))).loaded).toBe(true);
      await Bun.sleep(300);
      expect(edited).toEqual([]);
    } finally {
      watcher.stop();
    }
  });
});

describe("stoppedWithinTimeout", () => {
  test("settles as soon as the services have stopped, not after the timeout", async () => {
    const startedAt = Date.now();
    await stoppedWithinTimeout(() => Bun.sleep(20), 5_000);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test("settles after the timeout when a service never stops", async () => {
    const startedAt = Date.now();
    await stoppedWithinTimeout(() => new Promise(() => {}), 100);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90);
  });

  test("starts stopping the services", async () => {
    let started = false;
    await stoppedWithinTimeout(async () => void (started = true), 100);
    expect(started).toBe(true);
  });
});

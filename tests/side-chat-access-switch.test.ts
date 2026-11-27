import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentBlock, RequestPermissionRequest, SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { loadConfig } from "../host/config.ts";
import { ConversationService } from "../host/conversations.ts";
import { Hub } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import { SystemNotifications } from "../host/system-notifications.ts";
import type { HarnessId } from "../shared/model.ts";

const scratch = mkdtempSync(join(tmpdir(), "side-chat-access-switch-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Inside {
  agentProcesses: Map<string, unknown>;
  handlePermissionRequest(request: RequestPermissionRequest, signal: AbortSignal): Promise<{ outcome: { outcome: string; optionId?: string } }>;
}

const inside = (conversations: ConversationService) => conversations as unknown as Inside;

const modesOn = (modes: string[], mode: string): SessionConfigOption[] => [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: mode, options: modes.map((value) => ({ value, name: value })) },
];

const textIn = (prompt: ContentBlock[]) => prompt.map((block) => (block.type === "text" ? block.text : "")).join("\n");

/** An agent whose sessions start in the first of its modes, which holds its answers, or its new sessions, while told to. */
function agentOffering(harness: HarnessId, modes: string[]) {
  const prompts: { mode: string; words: string }[] = [];
  const steered: string[] = [];
  const stopped: string[] = [];
  const modeOf = new Map<string, string>();
  let sessions = 0;
  let heldTurns: (() => void)[] | null = null;
  let sessionsMayOpen = Promise.resolve();
  const agent = {
    spec: { id: harness, label: harness },
    start: async () => ({ agentCapabilities: { sessionCapabilities: { resume: {} } } }),
    newSession: async () => {
      await sessionsMayOpen;
      const sessionId = `session-${crypto.randomUUID()}-${++sessions}`;
      modeOf.set(sessionId, modes[0]!);
      return { sessionId, configOptions: modesOn(modes, modes[0]!) };
    },
    resumeSession: async ({ sessionId }: { sessionId: string }) => {
      modeOf.set(sessionId, modes[0]!);
      return { configOptions: modesOn(modes, modes[0]!) };
    },
    setConfigOption: async (sessionId: string, _configId: string, value: string) => {
      modeOf.set(sessionId, value);
      return { configOptions: modesOn(modes, value) };
    },
    prompt: async (sessionId: string, prompt: ContentBlock[]) => {
      prompts.push({ mode: modeOf.get(sessionId)!, words: textIn(prompt) });
      if (heldTurns) await new Promise<void>((answer) => heldTurns!.push(answer));
      return { stopReason: stopped.includes(sessionId) ? "cancelled" : "end_turn" };
    },
    canSteer: async () => true,
    steer: async (_sessionId: string, prompt: ContentBlock[]) => {
      steered.push(textIn(prompt));
      return "injected";
    },
    cancel: async (sessionId: string) => {
      stopped.push(sessionId);
      heldTurns?.splice(0).forEach((answer) => answer());
    },
    closeSession: async () => {},
  };
  return {
    agent,
    prompts,
    steered,
    stopped,
    modeOf,
    holdTurns: () => (heldTurns ??= []),
    answerTurns: () => {
      const held = heldTurns;
      heldTurns = null;
      held?.forEach((answer) => answer());
    },
    holdSessions: () => {
      let open = () => {};
      sessionsMayOpen = new Promise<void>((resolve) => (open = resolve));
      return open;
    },
  };
}

function serviceOn(store: Store, agent: unknown) {
  const conversations = new ConversationService(store, new Hub(), loadConfig({ MIRADOR_DATA_DIR: join(scratch, `data-${crypto.randomUUID()}`) }), { mute() {}, unmute() {} } as never, {} as never, {} as never, new SystemNotifications(store, new Hub()));
  inside(conversations).agentProcesses.set("p1", agent);
  return conversations;
}

const claudeModes = ["default", "acceptEdits", "plan"];
const codexModes = ["agent", "workspace-write", "read-only"];

function besideAConversation({ harness = "claude", modes = claudeModes, profileMode = "acceptEdits" }: { harness?: HarnessId; modes?: string[]; profileMode?: string | null } = {}) {
  const store = new Store(":memory:");
  const project = join(scratch, `project-${crypto.randomUUID()}`);
  mkdirSync(project);
  store.saveProfile({ id: "p1", name: "p", harness, environment: "", prelaunch: "", model: null, mode: profileMode, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });
  store.insertWorkspace({ id: "w1", name: "p", path: project, defaultLaunch: { harness, profileId: "p1" }, createdAt: 1 });
  const fake = agentOffering(harness, modes);
  const conversations = serviceOn(store, fake.agent);
  const conversation = conversations.create("w1", { harness, profileId: "p1" });
  const ask = (question: string) => conversations.startSideChat(conversation.id, question, store.ownerId());
  const mayChangeFiles = (sideChatId: string) => store.findConversation(sideChatId)?.sideChatMayChangeFiles === true;
  const settled = (sideChatId: string, prompts: number) => until(() => fake.prompts.length === prompts && conversations.get(sideChatId).status === "idle");
  return { store, conversations, conversation, ask, mayChangeFiles, settled, ...fake };
}

async function until(condition: () => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
}

const askToRun = (sessionId: string): RequestPermissionRequest => ({
  sessionId,
  toolCall: { toolCallId: "run", title: "rm -rf build", kind: "execute" },
  options: [
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
});

describe("a side chat held to reading, switched to change files", () => {
  test("goes to its conversation's mode at once, and its agent is told with the next message, once", async () => {
    const { conversations, conversation, ask, mayChangeFiles, settled, prompts, modeOf, store } = besideAConversation();
    await conversations.setConfigOption(conversation.id, "mode", "default");
    const sideChat = ask("What does this do");
    await settled(sideChat.id, 1);
    expect(prompts[0]).toMatchObject({ mode: "plan" });

    await conversations.switchSideChatAccess(sideChat.id, "can-change-files");
    expect(mayChangeFiles(sideChat.id)).toBe(true);
    expect(modeOf.get(store.findConversation(sideChat.id)!.acpSessionId!)).toBe("default");

    await conversations.send(sideChat.id, "Fix it", []);
    await settled(sideChat.id, 2);
    expect(prompts[1]).toMatchObject({ mode: "default" });
    expect(prompts[1]!.words).toContain("The user switched what this side chat may do.");
    expect(prompts[1]!.words).toContain("change files or run commands where the user asks you to");
    await conversations.send(sideChat.id, "And that", []);
    await settled(sideChat.id, 3);
    expect(prompts[2]!.words).not.toContain("The user switched");
  });

  test("is remembered by its conversation, whose next side chats start that way ahead of the workspace, while its others stay as they are", async () => {
    const { store, conversations, conversation, ask, mayChangeFiles, settled } = besideAConversation();
    conversations.setSideChatAccess("w1", "read-only");
    const other = ask("An earlier one");
    await settled(other.id, 1);
    const sideChat = ask("What does this do");
    await settled(sideChat.id, 2);

    await conversations.switchSideChatAccess(sideChat.id, "can-change-files");
    expect(store.findConversation(conversation.id)?.sideChatAccess).toBe("can-change-files");
    const next = ask("The next one");
    await settled(next.id, 3);
    expect(mayChangeFiles(next.id)).toBe(true);
    expect(mayChangeFiles(other.id)).toBe(false);

    const otherConversation = conversations.create("w1", { harness: "claude", profileId: "p1" });
    expect(mayChangeFiles(conversations.startSideChat(otherConversation.id, "Elsewhere", store.ownerId()).id)).toBe(false);
  });

  test("leaves plan mode for the one that asks when its conversation plans too and its profile names no other", async () => {
    const namesNone = besideAConversation({ profileMode: null });
    await namesNone.conversations.setConfigOption(namesNone.conversation.id, "mode", "plan");
    const sideChat = namesNone.ask("What does this do");
    await namesNone.settled(sideChat.id, 1);
    await namesNone.conversations.switchSideChatAccess(sideChat.id, "can-change-files");
    expect(namesNone.modeOf.get(namesNone.store.findConversation(sideChat.id)!.acpSessionId!)).toBe("default");

    const plans = besideAConversation({ profileMode: "plan" });
    const planning = plans.ask("What does this do");
    await plans.settled(planning.id, 1);
    await plans.conversations.switchSideChatAccess(planning.id, "can-change-files");
    expect(plans.modeOf.get(plans.store.findConversation(planning.id)!.acpSessionId!)).toBe("default");
  });

  test("hears the brief of what it may do by then, when switched before its first question went out", async () => {
    const { conversations, ask, settled, holdSessions, prompts } = besideAConversation();
    const openSessions = holdSessions();
    const sideChat = ask("What does this do");
    const switched = conversations.switchSideChatAccess(sideChat.id, "can-change-files");
    openSessions();
    await switched;
    await settled(sideChat.id, 1);
    expect(prompts[0]).toMatchObject({ mode: "acceptEdits" });
    expect(prompts[0]!.words).toContain("may be editing the same files");
    expect(prompts[0]!.words).not.toContain("do not change files");
    expect(prompts[0]!.words).not.toContain("The user switched");
  });

  test("hears of it with a message that joins its running turn", async () => {
    const { conversations, ask, prompts, steered, holdTurns, answerTurns, settled } = besideAConversation();
    holdTurns();
    const sideChat = ask("What does this do");
    await until(() => prompts.length === 1);
    await conversations.switchSideChatAccess(sideChat.id, "can-change-files");
    await conversations.send(sideChat.id, "Fix it too", []);
    await until(() => steered.length === 1);
    expect(steered[0]).toContain("The user switched what this side chat may do.");
    answerTurns();
    await settled(sideChat.id, 1);
    await conversations.send(sideChat.id, "And that", []);
    await settled(sideChat.id, 2);
    expect(prompts[1]!.words).not.toContain("The user switched");
  });
});

describe("a side chat that may change files, switched to reading", () => {
  test("goes to plan mode, and what its agent waits for the user's permission for is turned down, as is what it asks next", async () => {
    const { store, conversations, ask, settled, prompts, modeOf } = besideAConversation();
    store.setSideChatAccess("can-change-files");
    const sideChat = ask("Fix the typo");
    await settled(sideChat.id, 1);
    const sessionId = store.findConversation(sideChat.id)!.acpSessionId!;
    const asked = inside(conversations).handlePermissionRequest(askToRun(sessionId), new AbortController().signal);
    await until(() => conversations.waitingPermissions(sideChat.id).length === 1);

    await conversations.switchSideChatAccess(sideChat.id, "read-only");
    expect(await asked).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });
    expect(modeOf.get(sessionId)).toBe("plan");
    expect(await inside(conversations).handlePermissionRequest(askToRun(sessionId), new AbortController().signal)).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });

    await conversations.send(sideChat.id, "And that", []);
    await settled(sideChat.id, 2);
    expect(prompts[1]!.words).toContain("do not change files");
  });

  test("turns down a request that was still on its way to the user", async () => {
    const { store, conversations, ask, settled } = besideAConversation();
    store.setSideChatAccess("can-change-files");
    const sideChat = ask("Fix the typo");
    await settled(sideChat.id, 1);
    const asked = inside(conversations).handlePermissionRequest(askToRun(store.findConversation(sideChat.id)!.acpSessionId!), new AbortController().signal);
    await conversations.switchSideChatAccess(sideChat.id, "read-only");
    expect(await asked).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });
    expect(conversations.waitingPermissions(sideChat.id)).toEqual([]);
  });

  test("turns down what its agent asks even with YOLO on, until it may change files again", async () => {
    const { store, conversations, ask, settled } = besideAConversation();
    store.setSideChatAccess("can-change-files");
    const sideChat = ask("Fix the typo");
    await settled(sideChat.id, 1);
    conversations.setBypassPermissions(sideChat.id, true);
    const askNow = () => inside(conversations).handlePermissionRequest(askToRun(store.findConversation(sideChat.id)!.acpSessionId!), new AbortController().signal);
    expect(await askNow()).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });

    await conversations.switchSideChatAccess(sideChat.id, "read-only");
    expect(await askNow()).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });

    await conversations.switchSideChatAccess(sideChat.id, "can-change-files");
    expect(await askNow()).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
  });

  test("ends where the last of two quick switches leaves it", async () => {
    const { store, conversations, ask, settled, modeOf, mayChangeFiles } = besideAConversation();
    const sideChat = ask("What does this do");
    await settled(sideChat.id, 1);
    await Promise.all([conversations.switchSideChatAccess(sideChat.id, "can-change-files"), conversations.switchSideChatAccess(sideChat.id, "read-only")]);
    expect(mayChangeFiles(sideChat.id)).toBe(false);
    expect(modeOf.get(store.findConversation(sideChat.id)!.acpSessionId!)).toBe("plan");
  });

  test("stops a turn of Codex's, which would go on in the mode it started in, and lets one of Claude Code's go on", async () => {
    const codex = besideAConversation({ harness: "codex", modes: codexModes, profileMode: "workspace-write" });
    codex.store.setSideChatAccess("can-change-files");
    codex.holdTurns();
    const codexSideChat = codex.ask("Fix the typo");
    await until(() => codex.prompts.length === 1);
    await codex.conversations.switchSideChatAccess(codexSideChat.id, "read-only");
    const codexSession = codex.store.findConversation(codexSideChat.id)!.acpSessionId!;
    expect(codex.stopped).toEqual([codexSession]);
    expect(codex.modeOf.get(codexSession)).toBe("read-only");
    await codex.settled(codexSideChat.id, 1);

    const claude = besideAConversation();
    claude.store.setSideChatAccess("can-change-files");
    claude.holdTurns();
    const claudeSideChat = claude.ask("Fix the typo");
    await until(() => claude.prompts.length === 1);
    await claude.conversations.switchSideChatAccess(claudeSideChat.id, "read-only");
    expect(claude.stopped).toEqual([]);
    expect(claude.modeOf.get(claude.store.findConversation(claudeSideChat.id)!.acpSessionId!)).toBe("plan");
    claude.answerTurns();
  });
});

describe("a side chat switched while its session is closed", () => {
  test("reopens it in the mode of what it may do by then, and one left alone reopens it as it was", async () => {
    const { store, agent, ask, settled, prompts, modeOf } = besideAConversation();
    const switched = ask("What does this do");
    await settled(switched.id, 1);
    const leftAlone = ask("And this");
    await settled(leftAlone.id, 2);

    const restarted = serviceOn(store, agent);
    await restarted.switchSideChatAccess(switched.id, "can-change-files");
    await restarted.send(switched.id, "Fix it", []);
    await until(() => prompts.length === 3);
    expect(prompts[2]).toMatchObject({ mode: "acceptEdits" });
    await restarted.send(leftAlone.id, "Go on", []);
    await until(() => prompts.length === 4);
    expect(prompts[3]).toMatchObject({ mode: "plan" });

    const restartedAgain = serviceOn(store, agent);
    await restartedAgain.switchSideChatAccess(switched.id, "read-only");
    await restartedAgain.send(switched.id, "Now only look", []);
    await until(() => prompts.length === 5);
    expect(prompts[4]).toMatchObject({ mode: "plan" });
    expect(modeOf.get(store.findConversation(switched.id)!.acpSessionId!)).toBe("plan");
  });
});

describe("switching what side chats may do", () => {
  test("on the conversation itself only sets how its next ones start", async () => {
    const { store, conversations, conversation, ask, mayChangeFiles, settled } = besideAConversation();
    const open = ask("What does this do");
    await settled(open.id, 1);
    await conversations.switchSideChatAccess(conversation.id, "can-change-files");
    expect(store.findConversation(conversation.id)?.sideChatAccess).toBe("can-change-files");
    expect(mayChangeFiles(open.id)).toBe(false);
    const next = ask("The next one");
    await settled(next.id, 2);
    expect(mayChangeFiles(next.id)).toBe(true);
  });

  test("is refused where an agent can't be held to reading, in a room, and for a choice there isn't", async () => {
    const opencode = besideAConversation({ harness: "opencode", modes: ["build", "plan"], profileMode: "build" });
    const asked = opencode.ask("What does this do");
    await expect(opencode.conversations.switchSideChatAccess(asked.id, "can-change-files")).rejects.toMatchObject({ problem: { code: "side-chat-access-no-choice" } });
    expect(opencode.mayChangeFiles(asked.id)).toBe(false);

    const { conversations, store, conversation, ask } = besideAConversation();
    const inRoom = conversations.startInRoom("room", "w1", { harness: "claude", profileId: "p1" }, "In a room");
    const besideRoom = conversations.startSideChat(inRoom.id, "What does this do", store.ownerId());
    await expect(conversations.switchSideChatAccess(besideRoom.id, "can-change-files")).rejects.toMatchObject({ problem: { code: "side-chat-access-no-choice" } });
    await expect(conversations.switchSideChatAccess(inRoom.id, "can-change-files")).rejects.toMatchObject({ problem: { code: "side-chat-access-no-choice" } });
    await expect(conversations.switchSideChatAccess(ask("Fine").id, "anything" as never)).rejects.toMatchObject({ problem: { code: "unknown-side-chat-access" } });
    expect(store.findConversation(conversation.id)?.sideChatAccess).toBeUndefined();
  });

  test("is not told to one opened as a conversation meanwhile", async () => {
    const { store, conversations, ask, settled, prompts } = besideAConversation();
    store.setSideChatAccess("can-change-files");
    const sideChat = ask("Fix the typo");
    await settled(sideChat.id, 1);
    await conversations.switchSideChatAccess(sideChat.id, "read-only");
    await conversations.promoteSideChat(sideChat.id);
    await conversations.send(sideChat.id, "Go on", []);
    await settled(sideChat.id, 2);
    expect(prompts[1]!.words).not.toContain("The user switched");
  });
});

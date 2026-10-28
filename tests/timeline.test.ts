import { describe, expect, test } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { ConversationEvent, StoredEvent } from "../shared/model.ts";
import { lineDiff } from "../web/diff.ts";
import { pageEvent } from "../host/low-data.ts";
import { canTryAgain } from "../shared/try-again.ts";
import { approvalsWaiting, authorOf, buildTimeline, latestPlan, spokenSeverity, startsAuthorGroup, stepsAtWork, stepsRunning, subagentAsking, subagentEndedAt, subagentsIn, subagentState, toolCallsAwaitingPermission, type SubagentBlock, type TimelineBlock } from "../shared/timeline.ts";

function stored(events: ConversationEvent[]): StoredEvent[] {
  return events.map((event, index) => ({ seq: index + 1, at: (index + 1) * 1000, event }));
}

const acp = (update: SessionUpdate): ConversationEvent => ({ type: "acp", update });
const agentText = (text: string, meta?: Record<string, unknown>) =>
  acp({ sessionUpdate: "agent_message_chunk", content: { type: "text", text }, _meta: meta });

const bashCall = (toolCallId: string) => acp({ sessionUpdate: "tool_call", toolCallId, title: "Bash", status: "pending" });

describe("buildTimeline", () => {
  test("merges consecutive agent chunks into one message", () => {
    const timeline = buildTimeline(stored([{ type: "user-message", text: "hi" }, agentText("Hel"), agentText("lo")]));
    expect(timeline.map((block) => [block.kind, "text" in block ? block.text : ""])).toEqual([
      ["user", "hi"],
      ["agent", "Hello"],
    ]);
  });

  test("a message offers to undo its turn's files once they are kept, whether that is said in the message or after it", () => {
    const timeline = buildTimeline(
      stored([
        { type: "user-message", text: "old", checkpoint: "abc" },
        { type: "user-message", text: "new" },
        { type: "user-message", text: "joined" },
        { type: "files-kept", turnSeq: 2, checkpoint: "def" },
        { type: "files-kept", turnSeq: 99, checkpoint: "ghi" },
      ]),
    );
    expect(timeline.map((block) => [block.kind === "user" && block.text, block.kind === "user" && block.filesKept])).toEqual([
      ["old", true],
      ["new", true],
      ["joined", undefined],
    ]);
  });

  test("shows a message that joined a stopped turn but went out again after it only where it went out", () => {
    const timeline = buildTimeline(
      stored([
        { type: "user-message", text: "First task" },
        { type: "user-message", text: "Also this" },
        { type: "turn-end", stopReason: "cancelled" },
        { type: "steered-messages-returned", seqs: [2] },
        { type: "user-message", text: "Also this" },
        agentText("Done"),
      ]),
    );
    expect(timeline.map((block) => [block.kind, "text" in block ? block.text : ""])).toEqual([
      ["user", "First task"],
      ["notice", "Turn ended: cancelled"],
      ["user", "Also this"],
      ["agent", "Done"],
    ]);
  });

  test("keeps hook notices out of the agent's reply", () => {
    const timeline = buildTimeline(stored([agentText("DONE"), agentText("**Notice:** Stop says", { claudeCode: { kind: "informational" } })]));
    expect(timeline.map(({ kind }) => kind)).toEqual(["agent", "info"]);
  });

  test("folds tool call updates into the original card", () => {
    const timeline = buildTimeline(
      stored([
        acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", status: "pending" }),
        acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: "ok" }),
      ]),
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ kind: "tool", title: "Read", status: "completed", rawOutput: "ok" });
  });

  test("gathers a command's output and exit code from the terminal meta pi-acp sends", () => {
    const timeline = buildTimeline(
      stored([
        acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "ls", kind: "execute", status: "pending", content: [{ type: "terminal", terminalId: "t1" }] }),
        acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", _meta: { terminal_output: { terminal_id: "t1", data: "a.txt\n" } } }),
        acp({
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "failed",
          _meta: { terminal_output: { terminal_id: "t1", data: "ls: b.txt: No such file\n" }, terminal_exit: { terminal_id: "t1", exit_code: 1, signal: null } },
        }),
      ]),
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ kind: "tool", status: "failed", terminalOutput: "a.txt\nls: b.txt: No such file\n", terminalExitCode: 1 });
  });

  test("marks a permission as resolved with the chosen option", () => {
    const timeline = buildTimeline(
      stored([
        { type: "permission", permissionId: "p1", toolCall: { toolCallId: "t1" }, options: [{ optionId: "allow", name: "Yes", kind: "allow_once" }] },
        { type: "permission-resolved", permissionId: "p1", optionId: "allow" },
      ]),
    );
    expect(timeline[0]).toMatchObject({ kind: "permission", resolved: true, chosenOptionId: "allow" });
  });

  test("updates one plan per turn in place", () => {
    const entry = (status: "pending" | "completed") => ({ content: "step", priority: "medium" as const, status });
    const timeline = buildTimeline(
      stored([acp({ sessionUpdate: "plan", entries: [entry("pending")] }), acp({ sessionUpdate: "plan", entries: [entry("completed")] })]),
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ kind: "plan", entries: [{ status: "completed" }] });
  });

  test("says which agent a conversation moved to, along with the profile", () => {
    const notices = buildTimeline(stored([{ type: "profile-changed", profileName: "Work" }, { type: "profile-changed", profileName: "Radiance", agent: "opencode" }]));
    expect(notices.map((block) => block.kind === "notice" && block.text)).toEqual(["Now using the profile “Work”", "Now using opencode, with the profile “Radiance”"]);
  });

  test("shows abnormal turn endings only", () => {
    const timeline = buildTimeline(stored([{ type: "turn-end", stopReason: "end_turn" }, { type: "turn-end", stopReason: "cancelled" }]));
    expect(timeline).toEqual([{ kind: "notice", key: "2", at: 2000, text: "Turn ended: cancelled" }]);
  });

  test("the calls at work in the conversation are those of the turn still open", () => {
    const atWork = (events: ConversationEvent[]) => [...stepsRunning(buildTimeline(stored(events)))];
    expect(atWork([{ type: "user-message", text: "a" }, bashCall("t1"), { type: "turn-end", stopReason: "cancelled" }, { type: "user-message", text: "b" }, bashCall("t2")])).toEqual(["t2"]);
    expect(atWork([bashCall("t1"), { type: "error", message: "boom" }])).toEqual([]);
    expect(atWork([bashCall("t1"), finish("t1"), bashCall("t2"), { type: "turn-end", stopReason: "end_turn" }])).toEqual([]);
  });

  test("a call waiting for the user's permission is not running", () => {
    const ask = (toolCallId: string): ConversationEvent => ({ type: "permission", permissionId: `p-${toolCallId}`, toolCall: { toolCallId }, options: [] });
    const running = (events: ConversationEvent[]) => [...stepsRunning(buildTimeline(stored(events)))];
    expect(running([bashCall("t1"), bashCall("t2"), ask("t2")])).toEqual(["t1"]);
    expect(running([bashCall("t1"), ask("t1"), { type: "permission-resolved", permissionId: "p-t1", optionId: "allow" }])).toEqual(["t1"]);
  });

  test("a message made of many chunks has the time of its first chunk", () => {
    const timeline = buildTimeline(stored([{ type: "user-message", text: "hi" }, agentText("Hel"), agentText("lo")]));
    expect(timeline.map(({ at }) => at)).toEqual([1000, 2000]);
  });
});

describe("an agent's notice update", () => {
  const notice = (severity: string, title: string, description?: string): ConversationEvent =>
    acp({ sessionUpdate: "notice", severity, title, ...(description ? { description } : {}) });

  test("is a block of its own between the agent's messages, not text glued to the reply", () => {
    const timeline = buildTimeline(stored([agentText("Working."), notice("info", "Task stopped by user", "the watcher did not end."), agentText("Done")]));
    expect(timeline).toEqual([
      { kind: "agent", key: "1", at: 1000, text: "Working." },
      { kind: "agent-notice", key: "2", at: 2000, severity: "info", title: "Task stopped by user", description: "the watcher did not end." },
      { kind: "agent", key: "3", at: 3000, text: "Done" },
    ]);
    expect(timeline.map(authorOf)).toEqual(["agent", null, "agent"]);
  });

  test("names the hook once and keeps each of its lines without the prefix", () => {
    const timeline = buildTimeline(
      stored([notice("info", "SessionStart:compact says: <persisted-output>", "SessionStart:compact says: Recent context, needle in it\nSessionStart:compact says: \nSessionStart:compact says: Mode: code")]),
    );
    expect(timeline[0]).toEqual({
      kind: "agent-notice",
      key: "1",
      at: 1000,
      severity: "info",
      title: "SessionStart:compact hook",
      description: "<persisted-output>\nRecent context, needle in it\n\nMode: code",
    });
  });

  test("keeps a short notice whole: one line stands with its title, a bare title needs nothing", () => {
    expect(buildTimeline(stored([notice("warning", "PreToolUse:Bash says: rm -rf was blocked")]))[0]).toMatchObject({
      title: "PreToolUse:Bash hook",
      severity: "warning",
      description: "rm -rf was blocked",
    });
    expect(buildTimeline(stored([notice("info", "Fast mode turned off")]))[0]).toMatchObject({ kind: "agent-notice", title: "Fast mode turned off" });
  });

  test("says a warning's and an error's severity in words for screen readers, and nothing for a quieter one", () => {
    expect(spokenSeverity({ severity: "warning" })).toBe("Warning");
    expect(spokenSeverity({ severity: "error" })).toBe("Error");
    expect(spokenSeverity({ severity: "info" })).toBeNull();
  });
});

const launch = (toolCallId: string, input: Record<string, unknown>) =>
  acp({ sessionUpdate: "tool_call", toolCallId, title: "Task", kind: "think", status: "pending", rawInput: input, _meta: { claudeCode: { toolName: "Agent" } } });
const finish = (toolCallId: string, status: "completed" | "failed" = "completed") => acp({ sessionUpdate: "tool_call_update", toolCallId, status });
const answeredAtOnce = (toolCallId: string) =>
  acp({ sessionUpdate: "tool_call_update", toolCallId, _meta: { claudeCode: { toolName: "Agent", toolResponse: { isAsync: true, status: "async_launched" } } } });
const byParent = (parent: string) => ({ claudeCode: { parentToolUseId: parent } });
const read = (toolCallId: string, parent: string) =>
  acp({ sessionUpdate: "tool_call", toolCallId, title: `Read ${toolCallId}.ts`, status: "pending", _meta: { claudeCode: { parentToolUseId: parent, toolName: "Read" } } });

describe("a gateway that repeats a streamed message whole, under its id", () => {
  const says = (text: string, messageId?: string) => acp({ sessionUpdate: "agent_message_chunk", content: { type: "text", text }, messageId });
  const toolStarts = acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Task", status: "pending" });
  const toolEnds = acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
  const shape = (events: ConversationEvent[]) => buildTimeline(stored(events)).map((block) => `${block.kind}:${"text" in block ? block.text : ""}`);
  const streamed = ["Both ", "worktrees ", "are clean."].map((piece) => says(piece, "chatcmpl-A"));

  test("shows the message once, whether the repeat comes after tool calls or straight after it", () => {
    expect(shape([...streamed, toolStarts, toolEnds, says("Both worktrees are clean.", "chatcmpl-A")])).toEqual(["agent:Both worktrees are clean.", "tool:"]);
    expect(shape([...streamed, says("Both worktrees are clean.", "chatcmpl-A")])).toEqual(["agent:Both worktrees are clean."]);
  });

  test("keeps what the agent really says twice: another message, equal chunks, no id, or a message sent whole", () => {
    const done = (messageId: string) => ["Do", "ne", "."].map((piece) => says(piece, messageId));
    expect(shape([...done("m1"), toolStarts, ...done("m2")])).toEqual(["agent:Done.", "tool:", "agent:Done."]);
    expect(shape([says("ha", "m"), says("ha", "m")])).toEqual(["agent:haha"]);
    expect(shape([says("a", "m"), says("b", "m"), says("ab", "m2")])).toEqual(["agent:abab"]);
    expect(shape([says("Hi"), says("Hi"), says("HiHi")])).toEqual(["agent:HiHiHiHi"]);
  });
});

describe("an API error Claude Code also says as the agent's message", () => {
  const apiError = "API Error: 502 Bad Gateway. This is a server-side issue, usually temporary.";

  test("shows once, as the error, with what marks it", () => {
    const timeline = buildTimeline(stored([{ type: "user-message", text: "go" }, agentText(apiError), { type: "error", message: `Internal error: ${apiError}: {"errorKind":"server_error"}` }]));
    expect(timeline.map(({ kind }) => kind)).toEqual(["user", "error"]);
    const limit = "You've hit your session limit · resets 6:20pm (Europe/Budapest)";
    expect(buildTimeline(stored([agentText(limit), { type: "error", message: limit, usageLimit: { resetsAt: 1 } }]))).toEqual([expect.objectContaining({ kind: "error", usageLimit: true })]);
  });

  test("keeps a reply an unrelated error follows, even one the error happens to contain", () => {
    expect(buildTimeline(stored([agentText("All done."), { type: "error", message: "ACP connection closed" }])).map(({ kind }) => kind)).toEqual(["agent", "error"]);
    expect(buildTimeline(stored([agentText("Done."), { type: "error", message: "Done. Then the agent stopped" }])).map(({ kind }) => kind)).toEqual(["agent", "error"]);
  });
});

describe("a failed turn the user can try again", () => {
  const failed = (message: string): ConversationEvent => ({ type: "error", message, continuable: true });
  const errorsOfferingTryAgain = (events: ConversationEvent[]) =>
    buildTimeline(stored(events)).flatMap((block) => (block.kind === "error" && block.tryAgainSeq !== undefined ? [`${block.message} @${block.tryAgainSeq}`] : []));

  test("only the error that ended the latest turn offers it, naming itself", () => {
    const tryAgain: ConversationEvent = { type: "user-message", text: "Continue where you left off." };
    expect(errorsOfferingTryAgain([{ type: "user-message", text: "go" }, failed("502")])).toEqual(["502 @2"]);
    expect(errorsOfferingTryAgain([{ type: "user-message", text: "go" }, failed("502"), tryAgain, failed("503")])).toEqual(["503 @4"]);
    expect(errorsOfferingTryAgain([{ type: "user-message", text: "go" }, failed("502"), tryAgain, agentText("Done.")])).toEqual([]);
    expect(errorsOfferingTryAgain([{ type: "user-message", text: "go" }, failed("502"), { type: "context-cleared" }])).toEqual([]);
  });

  test("not a usage limit or a sign-in, which have their own buttons, nor an error before the message went to the agent or one the turn went on after", () => {
    expect(errorsOfferingTryAgain([{ type: "error", message: "limit", usageLimit: { resetsAt: 1 }, continuable: true }])).toEqual([]);
    expect(errorsOfferingTryAgain([{ type: "error", message: "log in", authRequired: true, continuable: true }])).toEqual([]);
    expect(errorsOfferingTryAgain([{ type: "user-message", text: "go" }, { type: "error", message: "The agent did not start" }])).toEqual([]);
    expect(errorsOfferingTryAgain([{ type: "error", message: "Could not resume the previous agent session; starting a fresh one." }])).toEqual([]);
  });

  test("the host tries again only from the error still ending the latest turn", () => {
    const events = stored([{ type: "user-message", text: "go" }, failed("502"), { type: "error", message: "Could not set Model to opus" }]);
    expect(canTryAgain(events.slice(1), 2)).toBe(true);
    expect(canTryAgain(events.slice(2), 2)).toBe(false);
    expect(canTryAgain(events, 1)).toBe(false);
    const leftBehind = stored([failed("502"), { type: "user-message", text: "something else" }]);
    expect(canTryAgain(leftBehind, 1)).toBe(false);
    expect(canTryAgain(stored([failed("502"), { type: "context-cleared" }]), 1)).toBe(false);
  });
});

describe("subagents", () => {
  test("what a subagent does goes under the tool call that started it, its own subagents' work under theirs", () => {
    const timeline = buildTimeline(
      stored([
        launch("a1", { description: "Explore the cache", subagent_type: "Explore" }),
        read("r1", "a1"),
        acp({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Looking" }, _meta: byParent("a1") }),
        agentText("Meanwhile, I read the store."),
        launch("a2", { description: "Nested" }),
        acp({ sessionUpdate: "tool_call", toolCallId: "n1", title: "Inside", status: "pending", _meta: byParent("a1") }),
        acp({ sessionUpdate: "tool_call", toolCallId: "n2", title: "Deeper", status: "pending", _meta: byParent("a2") }),
        acp({ sessionUpdate: "tool_call", toolCallId: "lost", title: "Unknown parent", status: "pending", _meta: byParent("gone") }),
        acp({ sessionUpdate: "plan", entries: [{ content: "subagent's own checklist", priority: "low", status: "pending" }], _meta: byParent("a1") }),
      ]),
    );
    expect(timeline.map((block) => (block.kind === "tool" ? block.title : block.kind))).toEqual(["Task", "agent", "Task", "Unknown parent"]);
    const [first, second] = subagentsIn(timeline);
    expect(first!.subagent.blocks.map((block) => (block.kind === "tool" ? block.title : block.kind))).toEqual(["Read r1.ts", "agent", "Inside"]);
    expect(second!.subagent.blocks.map((block) => (block.kind === "tool" ? block.title : block.kind))).toEqual(["Deeper"]);
    expect(first!.subagent.lastActivityAt).toBe(9000);
  });

  test("a call that says it starts a subagent only in a later update still gathers that subagent's work", () => {
    const timeline = buildTimeline(
      stored([
        acp({ sessionUpdate: "tool_call", toolCallId: "a1", title: "Task", kind: "think", status: "pending" }),
        acp({ sessionUpdate: "tool_call_update", toolCallId: "a1", _meta: { claudeCode: { toolName: "Agent" } } }),
        read("r1", "a1"),
        { type: "turn-end", stopReason: "cancelled" },
      ]),
    );
    expect(timeline.map((block) => (block.kind === "tool" ? block.title : block.kind))).toEqual(["Task", "notice"]);
    const [subagent] = subagentsIn(timeline);
    expect(subagent!.subagent.blocks.map((block) => (block.kind === "tool" ? block.title : block.kind))).toEqual(["Read r1.ts"]);
    expect(subagentState(subagent!, true)).toBe("stopped");
  });

  test("one runs until its call completes, and one in the background until the turn that started it ends", () => {
    const states = (events: ConversationEvent[], busy = true) => subagentsIn(buildTimeline(stored(events))).map((block) => subagentState(block, busy));
    const background = [launch("b1", { description: "Watch the build" }), answeredAtOnce("b1"), finish("b1")];
    expect(states([launch("s1", {}), ...background])).toEqual(["running", "running"]);
    expect(states([launch("s1", {}), finish("s1"), ...background, read("r1", "b1")])).toEqual(["done", "running"]);
    expect(states([...background, { type: "turn-end", stopReason: "end_turn" }])).toEqual(["done"]);
    expect(states([launch("s1", {}), launch("b1", {}), { type: "turn-end", stopReason: "cancelled" }])).toEqual(["stopped", "stopped"]);
    expect(states([launch("s1", {}), finish("s1", "failed")])).toEqual(["failed"]);
    expect(states([launch("s1", {})], false)).toEqual(["stopped"]);
    expect(states([{ type: "turn-end", stopReason: "end_turn" }, launch("s2", {})])).toEqual(["running"]);
  });

  test("one in the background ends when claude-agent-acp says its task ended, though its turn still runs, and works again once resumed", () => {
    const states = (events: ConversationEvent[]) => subagentsIn(buildTimeline(stored(events))).map((block) => subagentState(block, true));
    const taskIs = (toolCallId: string, subagentTaskStatus: string) => acp({ sessionUpdate: "tool_call_update", toolCallId, _meta: { claudeCode: { subagentTaskStatus } } });
    const background = (toolCallId: string) => [launch(toolCallId, {}), answeredAtOnce(toolCallId), finish(toolCallId)];
    expect(states([...background("b1"), ...background("b2"), taskIs("b1", "completed")])).toEqual(["done", "running"]);
    expect(states([...background("b1"), taskIs("b1", "failed")])).toEqual(["failed"]);
    expect(states([...background("b1"), taskIs("b1", "killed")])).toEqual(["stopped"]);
    expect(states([...background("b1"), taskIs("b1", "completed"), taskIs("b1", "running")])).toEqual(["running"]);
    expect(states([...background("b1"), taskIs("b1", "completed"), { type: "turn-end", stopReason: "cancelled" }]), "it ended before the turn was stopped").toEqual(["done"]);
    expect(states([...background("b1"), taskIs("b1", "constructor")])).toEqual(["running"]);
  });

  test("an error ends the turn as a stop does, so a subagent it leaves behind stops working with it", () => {
    const states = (events: ConversationEvent[], busy = true) => subagentsIn(buildTimeline(stored(events))).map((block) => subagentState(block, busy));
    const background = [launch("b1", { description: "Watch the build" }), answeredAtOnce("b1"), finish("b1")];
    expect(states([...background, { type: "error", message: "ACP connection closed" }])).toEqual(["stopped"]);
    expect(states([...background, { type: "error", message: "ACP connection closed" }], false)).toEqual(["stopped"]);
  });

  test("its calls at work are the ones not ended, but not a server call that anything followed", () => {
    const advisor = (toolCallId: string) =>
      acp({ sessionUpdate: "tool_call", toolCallId, title: "advisor", status: "pending", _meta: { claudeCode: { parentToolUseId: "a1", toolName: "advisor" } } });
    const atWork = (events: ConversationEvent[]) => [...stepsAtWork(subagentsIn(buildTimeline(stored([launch("a1", {}), ...events])))[0]!.subagent.blocks)];
    expect(atWork([read("r1", "a1"), finish("r1"), read("r2", "a1"), read("r3", "a1")])).toEqual(["r2", "r3"]);
    expect(atWork([advisor("srvtoolu_1"), advisor("srvtoolu_2")])).toEqual(["srvtoolu_2"]);
    expect(atWork([advisor("srvtoolu_1"), read("r1", "a1")])).toEqual(["r1"]);
    expect(atWork([advisor("srvtoolu_1"), finish("srvtoolu_1")])).toEqual([]);
    expect(atWork([read("r1", "a1"), { type: "turn-end", stopReason: "end_turn" }]), "a background subagent works on after its turn ends").toEqual(["r1"]);
  });

  test("a step of its own waiting for the user's permission is not at work", () => {
    const ask = (toolCallId: string): ConversationEvent => ({ type: "permission", permissionId: `p-${toolCallId}`, toolCall: { toolCallId }, options: [] });
    const timeline = buildTimeline(stored([launch("a1", {}), read("r1", "a1"), read("r2", "a1"), ask("r2")]));
    const [subagent] = subagentsIn(timeline);
    expect([...stepsAtWork(subagent!.subagent.blocks, toolCallsAwaitingPermission(timeline))]).toEqual(["r1"]);
  });

  test("an approval waits until it is answered, and names the subagent whose call it is for", () => {
    const ask = (toolCallId: string): ConversationEvent => ({ type: "permission", permissionId: `p-${toolCallId}`, toolCall: { toolCallId }, options: [] });
    const answered: ConversationEvent = { type: "permission-resolved", permissionId: "p-answered", optionId: "allow" };
    const timeline = buildTimeline(stored([launch("a1", {}), read("r1", "a1"), ask("r1"), ask("own"), ask("answered"), answered]));
    const waiting = approvalsWaiting(timeline);
    expect(waiting.map(({ permissionId }) => permissionId)).toEqual(["p-r1", "p-own"]);
    expect(waiting.map((approval) => subagentAsking(timeline, approval)?.toolCallId)).toEqual(["a1", undefined]);
  });

  test("ends when its call completes, or at its last activity when it ran in the background", () => {
    const [sync, background] = subagentsIn(
      buildTimeline(stored([launch("s1", {}), launch("b1", {}), answeredAtOnce("b1"), finish("b1"), read("r1", "b1"), finish("s1"), read("r2", "b1")])),
    );
    expect(subagentEndedAt(sync!)).toBe(6000);
    expect(subagentEndedAt(background!)).toBe(7000);
  });
});

describe("startsAuthorGroup", () => {
  test("a block opens a group when its author differs from the one before, and notices belong to no one", () => {
    const block = (kind: string) => ({ kind, key: kind, at: 0, text: "" }) as TimelineBlock;
    const timeline = ["user", "user", "agent", "tool", "notice", "agent", "error", "notice"].map(block);
    expect(timeline.map((_, index) => startsAuthorGroup(timeline, index))).toEqual([true, false, true, false, false, true, false, false]);
  });

  test("a message from a script has its own author, so it never hides in the user's group", () => {
    const timeline = buildTimeline(
      stored([
        { type: "user-message", text: "run the build in the background" },
        { type: "user-message", text: "build finished", fromScript: true },
        { type: "user-message", text: "and then?" },
      ]),
    );
    expect(timeline.map(authorOf)).toEqual(["user", "script", "user"]);
    expect(timeline.map((_, index) => startsAuthorGroup(timeline, index))).toEqual([true, true, true]);
  });

  test("a message from a plugin is the plugin's, and each plugin's messages group apart from another's", () => {
    const timeline = buildTimeline(
      stored([
        { type: "user-message", text: "find the callers" },
        { type: "user-message", text: "The task delegated to Local finished.", fromPlugin: "Delegate" },
        { type: "user-message", text: "The task delegated to Local failed.", fromPlugin: "Delegate" },
        { type: "user-message", text: "The user pressed the card.", fromPlugin: "Board" },
      ]),
    );
    expect(timeline.map(authorOf)).toEqual(["user", { plugin: "Delegate" }, { plugin: "Delegate" }, { plugin: "Board" }]);
    expect(timeline.map((_, index) => startsAuthorGroup(timeline, index))).toEqual([true, true, false, true]);
  });
});

describe("lineDiff", () => {
  test("marks added and removed lines around common ones", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  test("treats a new file as all additions", () => {
    expect(lineDiff(null, "a\nb").map(({ kind }) => kind)).toEqual(["added", "added"]);
  });
});

describe("images in the agent's updates", () => {
  const png = { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgo=" };

  test("a replayed user message keeps its image with its text, instead of a placeholder", () => {
    const timeline = buildTimeline(
      stored([
        acp({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "what is this?" } }),
        acp({ sessionUpdate: "user_message_chunk", content: png }),
        agentText("A logo."),
      ]),
    );
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ kind: "user", text: "what is this?", images: [png] });
    expect(timeline[1]).toMatchObject({ kind: "agent", text: "A logo." });
  });

  test("an image the agent sends joins its reply", () => {
    const timeline = buildTimeline(stored([{ type: "user-message", text: "draw" }, agentText("Here:"), acp({ sessionUpdate: "agent_message_chunk", content: png })]));
    expect(timeline.at(-1)).toMatchObject({ kind: "agent", text: "Here:", images: [png] });
  });

  test("an image that starts a message makes a message of its own", () => {
    const timeline = buildTimeline(stored([{ type: "user-message", text: "draw" }, acp({ sessionUpdate: "agent_message_chunk", content: png })]));
    expect(timeline.at(-1)).toMatchObject({ kind: "agent", text: "", images: [png] });
  });
});

describe("opencode 2 subagents", () => {
  const child = (id: string, title?: string, { parentID = "ses_root", depth = 1 } = {}) => ({
    "opencode/child-session": { id, parentID, depth, ...(title && { title }) },
  });
  const startSubagent = (toolCallId: string, description: string, meta?: ReturnType<typeof child>) =>
    acp({
      sessionUpdate: "tool_call",
      toolCallId,
      title: meta ? `${meta["opencode/child-session"].title}: subagent` : "subagent",
      kind: "think",
      status: "pending",
      rawInput: { description, agent: "general", prompt: `Do ${description}` },
      ...(meta && { _meta: meta }),
    });
  const endSubagent = (toolCallId: string, status: "completed" | "failed", text: string, sessionID: string) =>
    acp({ sessionUpdate: "tool_call_update", toolCallId, status, content: [{ type: "content", content: { type: "text", text } }], rawOutput: { metadata: { sessionID } } });
  const finished = (toolCallId: string, sessionID: string) => endSubagent(toolCallId, "completed", `<subagent sessionID="${sessionID}" state="completed">\nDone\n</subagent>`, sessionID);
  const childSays = (text: string, meta: ReturnType<typeof child>) => acp({ sessionUpdate: "agent_message_chunk", content: { type: "text", text }, _meta: meta });
  const childThinks = (text: string, meta: ReturnType<typeof child>) => acp({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text }, _meta: meta });
  /** As a page gets them, without the raw output. */
  const timelineOf = (events: ConversationEvent[]) => buildTimeline(stored(events).map(pageEvent));
  const workOf = (block: SubagentBlock | undefined) => block?.subagent.blocks.map((entry) => (entry.kind === "tool" ? `tool ${entry.title}` : `${entry.kind} ${"text" in entry ? entry.text : ""}`));
  const card = (timeline: TimelineBlock[], toolCallId: string) => subagentsIn(timeline).find((block) => block.toolCallId === toolCallId);

  test("what a subagent does goes under its card, keeping its thoughts and text out of the main timeline", () => {
    const fixBug = child("ses_sub1", "Fix bug");
    const timeline = timelineOf([
      startSubagent("call_sub1", "Fix bug"),
      childThinks("Investigating...", fixBug),
      acp({ sessionUpdate: "tool_call", toolCallId: "ses_sub1:call_read", title: "Fix bug: shell", kind: "execute", status: "pending", _meta: fixBug }),
      childSays("Fixed the bug.", fixBug),
      agentText("Parent continues."),
      finished("call_sub1", "ses_sub1"),
    ]);

    expect(timeline.map((block) => (block.kind === "tool" ? block.title : block.kind))).toEqual(["subagent", "agent"]);
    expect(workOf(card(timeline, "call_sub1"))).toEqual(["thought Investigating...", "tool shell", "agent Fixed the bug."]);
    expect(subagentState(card(timeline, "call_sub1")!, false)).toBe("done");
  });

  test("subagents running at once each gather their own work, by the child's title, whichever speaks first", () => {
    const [a, b] = [child("ses_a", "Task A"), child("ses_b", "Task B")];
    const timeline = timelineOf([
      startSubagent("call_1", "Task A"),
      startSubagent("call_2", "Task B"),
      childThinks("Thought B1. ", b),
      childThinks("Thought A1. ", a),
      childThinks("Thought B2.", b),
      childThinks("Thought A2.", a),
      childSays("Message B", b),
    ]);

    expect(workOf(card(timeline, "call_1"))).toEqual(["thought Thought A1. Thought A2."]);
    expect(workOf(card(timeline, "call_2"))).toEqual(["thought Thought B1. Thought B2.", "agent Message B"]);
    expect(timeline.map((block) => block.kind)).toEqual(["tool", "tool"]);
  });

  test("subagents with the same description each get the call whose result names their session", () => {
    const [a, b] = [child("ses_a", "Same task"), child("ses_b", "Same task")];
    const timeline = timelineOf([
      startSubagent("call_1", "Same task"),
      startSubagent("call_2", "Same task"),
      childSays("B starts. ", b),
      childSays("A starts. ", a),
      childSays("B ends.", b),
      finished("call_1", "ses_a"),
      childSays("A ends.", a),
      finished("call_2", "ses_b"),
    ]);

    expect(workOf(card(timeline, "call_1"))).toEqual(["agent A starts. A ends."]);
    expect(workOf(card(timeline, "call_2"))).toEqual(["agent B starts. B ends."]);
  });

  test("a subagent still running leaves alone the call whose result names another session", () => {
    const [a, b] = [child("ses_a", "Same task"), child("ses_b", "Same task")];
    const timeline = timelineOf([
      startSubagent("call_1", "Same task"),
      startSubagent("call_2", "Same task"),
      childSays("B works.", b),
      childSays("A works.", a),
      finished("call_1", "ses_a"),
    ]);

    expect(workOf(card(timeline, "call_1"))).toEqual(["agent A works."]);
    expect(workOf(card(timeline, "call_2"))).toEqual(["agent B works."]);
  });

  test.each([
    ["failed", "failed", "Subagent failed (sessionID: ses_x): boom"],
    ["was cancelled", "failed", "Subagent cancelled (sessionID: ses_x)"],
    ["went on in the background", "completed", "The subagent is working in the background (sessionID: ses_x). You will be notified automatically when it finishes."],
  ] as const)("the result of a subagent's call that %s names its session too", (_, status, result) => {
    const x = child("ses_x", "Same task");
    const timeline = timelineOf([startSubagent("call_1", "Same task"), startSubagent("call_2", "Same task"), endSubagent("call_2", status, result, "ses_x"), childSays("Working.", x)]);

    expect(workOf(card(timeline, "call_1"))).toEqual([]);
    expect(workOf(card(timeline, "call_2"))).toEqual(["agent Working."]);
  });

  test("a subagent's own subagent goes under the call that its parent made", () => {
    const outer = child("ses_outer", "Outer");
    const inner = child("ses_inner", "Inner", { parentID: "ses_outer", depth: 2 });
    const timeline = timelineOf([
      startSubagent("call_outer", "Outer"),
      startSubagent("call_other", "Inner"),
      childSays("Delegating.", outer),
      startSubagent("ses_outer:call_inner", "Inner", outer),
      childSays("Inner work.", inner),
    ]);

    expect(workOf(card(timeline, "call_outer"))).toEqual(["agent Delegating.", "tool subagent"]);
    expect(workOf(card(timeline, "ses_outer:call_inner"))).toEqual(["agent Inner work."]);
    expect(workOf(card(timeline, "call_other"))).toEqual([]);
  });

  test("a child without a title goes to the first running call that no other child took", () => {
    const timeline = timelineOf([startSubagent("call_1", "Task A"), startSubagent("call_2", "Task B"), childSays("A.", child("ses_a", "Task A")), childSays("Untitled.", child("ses_b"))]);

    expect(workOf(card(timeline, "call_1"))).toEqual(["agent A."]);
    expect(workOf(card(timeline, "call_2"))).toEqual(["agent Untitled."]);
  });

  test("a child never goes under a call that already ended, as one of an earlier turn that failed", () => {
    const timeline = timelineOf([
      startSubagent("call_old", "Old task"),
      endSubagent("call_old", "failed", "Invalid input", "ses_none"),
      { type: "turn-end", stopReason: "end_turn" },
      startSubagent("call_new", "New task"),
      childSays("New work.", child("ses_new", "Unrelated title")),
    ]);

    expect(workOf(card(timeline, "call_old"))).toEqual([]);
    expect(workOf(card(timeline, "call_new"))).toEqual(["agent New work."]);
  });

  test("a child that no call can be taken to have started is held aside, out of the main message and plan", () => {
    const stray = child("ses_stray", "Stray");
    const timeline = timelineOf([
      acp({ sessionUpdate: "plan", entries: [{ content: "Main step", priority: "medium", status: "pending" }] }),
      agentText("Main says "),
      childSays("stray words ", stray),
      acp({ sessionUpdate: "plan", entries: [{ content: "Stray step", priority: "medium", status: "pending" }], _meta: stray }),
      agentText("more."),
    ]);

    expect(timeline).toMatchObject([{ kind: "plan", entries: [{ content: "Main step" }] }, { kind: "agent", text: "Main says more." }]);
  });
});

const planEvent = (seq: number, entries: { content: string; status: "pending" | "in_progress" | "completed" }[], meta?: Record<string, unknown>): StoredEvent => ({
  seq,
  at: seq,
  event: { type: "acp", update: { sessionUpdate: "plan", entries: entries.map((entry) => ({ ...entry, priority: "medium" })), ...(meta && { _meta: meta }) } },
});

describe("latestPlan", () => {
  test("is the agent's newest plan, across turns; a subagent's plan or an emptied one leaves it standing", () => {
    const events: StoredEvent[] = [
      planEvent(1, [{ content: "Old", status: "completed" }]),
      planEvent(2, [{ content: "Read the code", status: "completed" }, { content: "Write the tool", status: "in_progress" }]),
      { seq: 3, at: 3, event: { type: "turn-end", stopReason: "end_turn" } },
      { seq: 4, at: 4, event: { type: "user-message", text: "Next" } },
      planEvent(5, [{ content: "Subagent step", status: "pending" }], { claudeCode: { parentToolUseId: "toolu_1" } }),
      planEvent(6, []),
    ];
    expect(latestPlan(events)?.map(({ content }) => content)).toEqual(["Read the code", "Write the tool"]);
    expect(latestPlan(events.slice(2, 4))).toBeNull();
  });
});

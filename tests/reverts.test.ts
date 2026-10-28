import { expect, test } from "bun:test";
import type { ConversationEvent, StoredEvent } from "../shared/model.ts";
import {
  anythingToUndo,
  joinedRunningTurn,
  lastAgentMessageId,
  listsAnyFile,
  pendingReverts,
  putsAnyFileBack,
  REVERT_EVENT_TYPES,
  rewindPointBefore,
  turnTitle,
  turnsFrom,
  undoableTurns,
  whatChanged,
  whatFiles,
  whatLeaves,
  whatWasLeft,
  whyNoRewindTo,
  withRevertNotes,
} from "../shared/reverts.ts";
import { awaitingDelivery, USER_COMMAND_EVENT_TYPES, userCommandsIn } from "../shared/user-commands.ts";

const userMessage = (text: string, extra: Partial<Extract<ConversationEvent, { type: "user-message" }>> = {}) =>
  ({ type: "user-message", text, ...extra }) as ConversationEvent;
const revertEvent = (revertId: string, toSeq: number, restored = 1, removed = 0) => ({ type: "revert", revertId, toSeq, restored, removed }) as ConversationEvent;
const said = (messageId?: string) =>
  ({ type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" }, ...(messageId && { messageId }) } }) as ConversationEvent;
const stored = (...events: ConversationEvent[]): StoredEvent[] => events.map((event, index) => ({ seq: index + 1, at: 0, event }));

test("a turn is undoable when Mirador kept the files it began with", () => {
  const events = stored(userMessage("first", { checkpoint: "abc" }), userMessage("second"), userMessage("third", { checkpoint: "def" }));
  expect(undoableTurns(events)).toEqual([
    { seq: 1, text: "first" },
    { seq: 3, text: "third" },
  ]);
});

test("a turn is undoable when the files it began with were kept after its message", () => {
  const events = stored(userMessage("first"), userMessage("second"), { type: "files-kept", turnSeq: 1, checkpoint: "abc" });
  expect(undoableTurns(events)).toEqual([{ seq: 1, text: "first" }]);
});

test("a revert note is pending until a message of the user's carries it", () => {
  const events = stored(userMessage("do the thing"), revertEvent("r1", 1, 2, 1));
  expect(pendingReverts(events)).toEqual([{ revertId: "r1", toSeq: 1, restored: 2, removed: 1, toMessage: "do the thing" }]);
  expect(pendingReverts(stored(...events.map(({ event }) => event), userMessage("carry on", { attachedRevertIds: ["r1"] })))).toEqual([]);
});

test("a revert note that went with a message the agent never answered is pending again", () => {
  const events = stored(
    userMessage("do the thing"),
    revertEvent("r1", 1),
    userMessage("carry on", { attachedRevertIds: ["r1"] }),
    { type: "turn-end", stopReason: "cancelled" },
    { type: "steered-messages-returned", seqs: [3] },
  );
  expect(pendingReverts(events).map(({ revertId }) => revertId)).toEqual(["r1"]);
});

test("a revert's note names the turn it went back to, and says what changed", () => {
  const revert = { revertId: "r1", toSeq: 1, toMessage: "do the thing", restored: 3, removed: 1 };
  const note = withRevertNotes([revert], "carry on");
  expect(note).toContain('before the turn that began with "do the thing": 3 files put back as they were and 1 file deleted that was created since.');
  expect(note.endsWith("carry on")).toBe(true);
  expect(withRevertNotes([], "carry on")).toBe("carry on");
});

test("a revert that left submodules as they are tells the agent so", () => {
  const revert = { revertId: "r1", toSeq: 1, toMessage: "do the thing", restored: 1, removed: 0, submodulesLeft: 2 };
  expect(withRevertNotes([revert], "carry on")).toContain(
    "1 file put back as it was. 2 submodules that changed stay as they are now: a submodule's files are its own repository's, so Mirador does not put them back. The conversation above is unchanged",
  );
  expect(whatWasLeft({ submodulesLeft: 1 })).toStartWith("1 submodule that changed stays as it is now");
  expect(whatWasLeft({})).toBe("");
});

test("a restore that left the files commits changed says how many, and which of them were edited after", () => {
  expect(whatWasLeft({ committed: { files: 230, editedSince: 0, commits: 3 } })).toBe("3 commits came in since then, and the 230 files they changed stay as committed.");
  expect(whatWasLeft({ committed: { files: 1, editedSince: 1, commits: 1 } })).toBe("1 commit came in since then, and the 1 file it changed stays as committed. It was also edited after that, and keeps those edits.");
  expect(whatWasLeft({ committed: { files: 4, editedSince: 1, commits: null } })).toBe(
    "HEAD moved to another commit since then, and the 4 files that differ there stay as they are. 1 of them was also edited after that, and keeps those edits.",
  );
  expect(whatWasLeft({ committed: { files: 3, editedSince: 2, commits: 2 }, submodulesLeft: 1 })).toBe(
    "2 commits came in since then, and the 3 files they changed stay as committed. 2 of them were also edited after that, and keep those edits. 1 submodule that changed stays as it is now: a submodule's files are its own repository's, so Mirador does not put them back.",
  );
});

test("a revert that left the files commits changed tells the agent so", () => {
  const committed = { files: 2, editedSince: 0, commits: 1 };
  const events = stored(userMessage("do the thing"), { type: "revert", revertId: "r1", toSeq: 1, restored: 1, removed: 0, committed });
  const [revert] = pendingReverts(events);
  expect(revert).toEqual({ revertId: "r1", toSeq: 1, restored: 1, removed: 0, committed, toMessage: "do the thing" });
  expect(withRevertNotes([revert!], "carry on")).toContain(
    ': 1 file put back as it was. 1 commit came in since then, and the 2 files it changed stay as committed. The conversation above is unchanged',
  );
});

test("one file is not called files, and an unchanged tree says so", () => {
  expect(whatChanged({ restored: 1, removed: 1 })).toBe("1 file put back as it was and 1 file deleted that was created since");
  expect(whatChanged({ restored: 2, removed: 3 })).toBe("2 files put back as they were and 3 files deleted that were created since");
  expect(whatChanged({ restored: 0, removed: 0 })).toBe("no file was different");
  expect(whatChanged({ restored: 0, removed: 0, committed: { files: 2, editedSince: 0, commits: 1 } })).toBe("no other file was different");
});

test("a turn is named by its message's first line, shortened when long", () => {
  expect(turnTitle("Fix the parser\nand its tests")).toBe("Fix the parser");
  expect(turnTitle(`${"x".repeat(80)}`)).toHaveLength(61);
  expect(turnTitle("   ")).toBe("an earlier turn");
});

test("a shortened turn title keeps an emoji whole", () => {
  const title = turnTitle(`${"a".repeat(59)}😀b`);
  expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  expect(title).not.toMatch(/^[\uDC00-\uDFFF]/);
  expect(title).toBe(`${"a".repeat(59)}😀…`);
});

test("a shortened turn title keeps a character made of several code points whole", () => {
  for (const cluster of ["🇭🇺", "👨‍👩‍👧", "1️⃣", "👍🏽", "é"]) {
    expect(turnTitle(`${"a".repeat(59)}${cluster} and more text`)).toBe(`${"a".repeat(59)}${cluster}…`);
  }
});

test("a rewind to a turn leaves the turns from there on, and none before it", () => {
  const events = stored(userMessage("first"), userMessage("second"), userMessage("third"));
  expect(turnsFrom(events, 2)).toEqual([
    { seq: 2, text: "second" },
    { seq: 3, text: "third" },
  ]);
  expect(turnsFrom(events, 1)).toHaveLength(3);
});

test("a rewind goes back to the last thing the agent said before the turn", () => {
  const events = stored(userMessage("first"), said("msg_1"), said("msg_1"), said("msg_2"), userMessage("second"), said("msg_3"));
  expect(rewindPointBefore(events, 5)).toBe("msg_2");
});

test("a rewind to the first turn has nothing of the agent's to go back to", () => {
  expect(rewindPointBefore(stored(userMessage("first"), said("msg_1")), 1)).toBeNull();
  expect(rewindPointBefore(stored(said(), userMessage("first")), 2)).toBeNull();
});

test("an agent that can go back to a marked reply can take a conversation back there; one that can't is refused", () => {
  const events = stored(userMessage("first"), said("msg_1"), userMessage("second"));
  expect(whyNoRewindTo("claude", events, 3)).toBeUndefined();
  expect(whyNoRewindTo("opencode", events, 3)).toContain("which opencode can't do");
});

test("with no reply marked, only a first turn can be taken back, by starting the agent afresh", () => {
  expect(whyNoRewindTo("opencode", stored(said(), userMessage("first"), said()), 2)).toBeUndefined();
  const unmarkedTurns = stored(userMessage("first"), said(), userMessage("second"), said());
  for (const harness of ["claude", "opencode", "pi"] as const) expect(whyNoRewindTo(harness, unmarkedTurns, 3)).toContain("no mark");
});

test("a message sent while a turn ran joined it, and the next one after the turn ended or failed starts its own", () => {
  const cancelled: ConversationEvent = { type: "turn-end", stopReason: "cancelled" };
  const events = stored(userMessage("first"), said("msg_1"), userMessage("Also this"), cancelled, userMessage("third"), { type: "error", message: "boom" }, userMessage("fourth"));
  expect([1, 3, 5, 7].map((seq) => joinedRunningTurn(events, seq))).toEqual([false, true, false, false]);
});

test("a message that went out again after its turn starts the next turn, as the agent never had it", () => {
  const events = stored(userMessage("first"), userMessage("Also this"), { type: "turn-end", stopReason: "cancelled" }, { type: "steered-messages-returned", seqs: [2] }, userMessage("Also this"), userMessage("And that"));
  expect([5, 6].map((seq) => joinedRunningTurn(events, seq))).toEqual([false, true]);
});

test("turns taken elsewhere pick up after the agent's latest message in the conversation", () => {
  expect(lastAgentMessageId(stored(userMessage("first"), said("msg_1"), userMessage("second"), said("msg_2"), said()))).toBe("msg_2");
  expect(lastAgentMessageId(stored(userMessage("first")))).toBeNull();
});

test("a rewind says how many turns leave, one turn as one, and every turn when it goes back to the first", () => {
  expect(whatLeaves({ plan: null, turnsLeaving: 1, keptFrom: "Add a button" })).toBe("1 turn leaves the conversation, and the agent's own history goes back with it, to before “Add a button”.");
  expect(whatLeaves({ plan: null, turnsLeaving: 3, keptFrom: "Add a button" })).toBe("3 turns leave the conversation, and the agent's own history goes back with them, to before “Add a button”.");
  expect(whatLeaves({ plan: null, turnsLeaving: 3, keptFrom: null })).toBe("Every turn leaves the conversation, and the agent starts over with nothing of it.");
});

test("what the files do: they go back with a rewind, stay with an undo's turn, say when none changed, stay as they are when kept, or say why they cannot go back", () => {
  const plan = { restored: 1, removed: 0, committed: { files: 2, editedSince: 0, commits: 1 } };
  expect(whatFiles({ plan }, true, false)).toBe("The files go back too, to how they were when this turn began: 1 file put back as it was. 1 commit came in since then, and the 2 files it changed stay as committed.");
  expect(whatFiles({ plan }, false, false)).toBe(
    "The files go back to how they were when this turn began: 1 file put back as it was. 1 commit came in since then, and the 2 files it changed stay as committed. The turn above stays in the conversation, and the agent is told the files no longer hold it.",
  );
  expect(whatFiles({ plan: { restored: 0, removed: 0 } }, true, false)).toBe("No file changed since this turn began.");
  expect(whatFiles({ plan: { ...plan, restored: 0 } }, true, false)).toBe("No other file changed since this turn began. 1 commit came in since then, and the 2 files it changed stay as committed.");
  expect(whatFiles({ plan: { restored: 0, removed: 0 } }, false, false)).toBe("No file changed since this turn began.");
  expect(whatFiles({ plan }, true, true)).toBe("The files stay as they are now, with what the turns that leave did to them.");
  expect(whatFiles({ plan: null, filesNote: "this workspace is not a git repository" }, true, false)).toBe("The files stay as they are: this workspace is not a git repository");
  expect(whatFiles({ plan: null, filesNote: "this workspace is not a git repository" }, false, false)).toBe("this workspace is not a git repository");
  expect(whatFiles({ plan: null }, true, false)).toBe("");
});

test("keeping the files and undoing a turn's files are offered only when going back would put any back, and the file list only when it names any", () => {
  expect(putsAnyFileBack({ restored: 0, removed: 1 })).toBe(true);
  expect(putsAnyFileBack({ restored: 0, removed: 0, committed: { files: 2, editedSince: 0, commits: 1 } })).toBe(false);
  expect(putsAnyFileBack(null)).toBe(false);
  expect(anythingToUndo({ plan: { restored: 0, removed: 0 } }, false)).toBe(false);
  expect(anythingToUndo({ plan: { restored: 1, removed: 0 } }, false)).toBe(true);
  expect(anythingToUndo({ plan: { restored: 0, removed: 0 } }, true)).toBe(true);
  const none = { paths: [], more: 0 };
  expect(listsAnyFile({ deleted: none, putBack: none, committed: { paths: ["pulled.txt"], more: 0 } })).toBe(true);
  expect(listsAnyFile({ deleted: none, putBack: none, committed: none })).toBe(false);
});

test("the notes for the agent come out the same from only the events their folds read as from the whole log", () => {
  const events = stored(
    userMessage("first"),
    { type: "user-command", commandId: "k1", command: "ls" },
    { type: "user-command-output", commandId: "k1", stream: "stdout", text: "a.txt" },
    { type: "user-command-ended", commandId: "k1", exitCode: 0 },
    { type: "user-command", commandId: "k2", command: "pwd" },
    { type: "user-command-ended", commandId: "k2", exitCode: 0 },
    { type: "user-command-dropped", commandIds: ["k2"] },
    said("m1"),
    revertEvent("r1", 1),
    userMessage("joined", { attachedCommandIds: ["k1"], attachedRevertIds: ["r1"] }),
    { type: "turn-end", stopReason: "cancelled" },
    { type: "steered-messages-returned", seqs: [10], commandIds: ["k1"] },
    { type: "files-kept", turnSeq: 1, checkpoint: "abc" },
  );
  const read = new Set<string>([...USER_COMMAND_EVENT_TYPES, ...REVERT_EVENT_TYPES]);
  const notes = (log: StoredEvent[]) => ({ commands: awaitingDelivery(userCommandsIn(log)), reverts: pendingReverts(log) });
  expect(notes(events).commands).toHaveLength(1);
  expect(notes(events).reverts).toHaveLength(1);
  expect(notes(events.filter(({ event }) => read.has(event.type)))).toEqual(notes(events));
});

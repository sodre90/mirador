import { harnessLabels, harnessRewinds, type CommittedFiles, type ConversationEvent, type HarnessId, type RestoreFiles, type RestorePlan, type StoredEvent } from "./model.ts";
import { returnedSteerSeqs } from "./steered-messages.ts";
import { cutWithEllipsis } from "./text-cut.ts";

/** A turn whose files the user put back, and what the restore did. */
export interface Revert {
  revertId: string;
  /** The turn the files were put back to: its message is the last one whose changes are still in the files. */
  toSeq: number;
  toMessage: string;
  restored: number;
  removed: number;
  submodulesLeft?: number;
  committed?: CommittedFiles;
}

const messageOf = (events: StoredEvent[], seq: number) => {
  const event = events.find((stored) => stored.seq === seq)?.event;
  return event?.type === "user-message" ? event.text : "";
};

/** The events `pendingReverts` reads; it ignores any other. */
export const REVERT_EVENT_TYPES = ["revert", "user-message", "steered-messages-returned"] as const satisfies readonly ConversationEvent["type"][];

/** The reverts whose note has not gone to the agent with a message of the user's yet. */
export function pendingReverts(events: StoredEvent[]): Revert[] {
  const returned = returnedSteerSeqs(events);
  const sent = new Set(events.flatMap(({ seq, event }) => (event.type === "user-message" && !returned.has(seq) ? (event.attachedRevertIds ?? []) : [])));
  return events
    .filter(({ event }) => event.type === "revert")
    .map(({ event }) => event as Extract<ConversationEvent, { type: "revert" }>)
    .filter(({ revertId }) => !sent.has(revertId))
    .map(({ revertId, toSeq, restored, removed, submodulesLeft, committed }) => ({
      revertId,
      toSeq,
      restored,
      removed,
      ...(submodulesLeft && { submodulesLeft }),
      ...(committed && { committed }),
      toMessage: messageOf(events, toSeq),
    }));
}

/** A turn of the conversation, named by the message that began it. */
export interface Turn {
  seq: number;
  text: string;
}

/** The turns of the conversation whose files Mirador kept, so they can be put back, oldest first. */
export function undoableTurns(events: StoredEvent[]): Turn[] {
  const keptLater = new Set(events.flatMap(({ event }) => (event.type === "files-kept" ? [event.turnSeq] : [])));
  return events.flatMap(({ seq, event }) => (event.type === "user-message" && (event.checkpoint || keptLater.has(seq)) ? [{ seq, text: event.text }] : []));
}

/** The turns from `seq` on: what a rewind to that point takes out of the conversation. */
export function turnsFrom(events: StoredEvent[], seq: number): Turn[] {
  return events.flatMap(({ seq: at, event }) => (event.type === "user-message" && at >= seq ? [{ seq: at, text: event.text }] : []));
}

/**
 * The agent's own mark of the last thing it said before the turn at `seq`, which is where a rewind sends its session
 * back to: a fork point names an assistant message, and the agent hands out one mark per reply that both its live
 * session and its transcript on disk agree on.
 */
export function rewindPointBefore(events: StoredEvent[], seq: number): string | null {
  const said = events.flatMap(({ seq: at, event }) =>
    at < seq && event.type === "acp" && event.update.sessionUpdate === "agent_message_chunk" && event.update.messageId
      ? [event.update.messageId]
      : [],
  );
  return said.at(-1) ?? null;
}

export const endsTurn = ({ event }: Pick<StoredEvent, "event">) => event.type === "turn-end" || event.type === "error";

/**
 * Whether the message at `seq` joined a turn already running rather than starting one: another message of the user's
 * came after the last turn's end and before it. A rewind there leaves the agent's session where that message came in,
 * not where the next turn began.
 */
export function joinedRunningTurn(events: StoredEvent[], seq: number): boolean {
  const before = events.filter(({ seq: at }) => at < seq);
  const turnBegan = before.findLastIndex(endsTurn) + 1;
  return before.slice(turnBegan).some(({ event }) => event.type === "user-message");
}

const cannotLeaveSessionBehind = (harness: HarnessId) => `Taking a conversation back needs the agent to leave part of its own session behind, which ${harnessLabels[harness]} can't do.`;
const NO_MARK_TO_GO_BACK_TO = "The agent's replies before this turn carry no mark of where its session should go back to, so it can't be taken back there.";

/**
 * Why the agent's session can't go back to before the turn at `seq`, if it can't. With nothing marked to go back to, a
 * fresh session stands in only for a first turn: after earlier turns it would silently forget them.
 */
export function whyNoRewindTo(harness: HarnessId, events: StoredEvent[], seq: number): string | undefined {
  if (rewindPointBefore(events, seq) === null) return events.some(({ seq: at, event }) => at < seq && event.type === "user-message") ? NO_MARK_TO_GO_BACK_TO : undefined;
  return harnessRewinds[harness] ? undefined : cannotLeaveSessionBehind(harness);
}

/** The agent's latest message in the conversation, where turns taken elsewhere since pick up. */
export const lastAgentMessageId = (events: StoredEvent[]) => rewindPointBefore(events, Infinity);

/** The start of a turn's message, short enough to name that turn in a label or a note. */
export function turnTitle(text: string) {
  const first = text.trim().split("\n")[0];
  return cutWithEllipsis(first, 60) || "an earlier turn";
}

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const whatChanged = ({ restored, removed, committed }: Pick<Revert, "restored" | "removed" | "committed">) => {
  const parts = [
    restored > 0 && counted(restored, "file put back as it was", "files put back as they were"),
    removed > 0 && counted(removed, "file deleted that was created since", "files deleted that were created since"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" and ") : committed ? "no other file was different" : "no file was different";
};

/** The files commits changed since the turn began, which a restore leaves as the commits have them. */
function whatCommitsLeft({ files, editedSince, commits }: CommittedFiles) {
  const oneFile = files === 1;
  const left =
    commits === null
      ? `HEAD moved to another commit since then, and the ${counted(files, "file that differs there stays", "files that differ there stay")} as ${oneFile ? "it is" : "they are"}.`
      : `${counted(commits, "commit", "commits")} came in since then, and the ${counted(files, "file", "files")} ${commits === 1 ? "it" : "they"} changed ${oneFile ? "stays" : "stay"} as committed.`;
  if (editedSince === 0) return left;
  const edited = oneFile ? "It was also edited after that, and keeps those edits." : `${editedSince} of them ${editedSince === 1 ? "was" : "were"} also edited after that, and ${editedSince === 1 ? "keeps" : "keep"} those edits.`;
  return `${left} ${edited}`;
}

const whatSubmodulesLeft = (submodulesLeft: number) =>
  `${submodulesLeft === 1 ? "1 submodule that changed stays as it is" : `${submodulesLeft} submodules that changed stay as they are`} now: a submodule's files are its own repository's, so Mirador does not put them back.`;

/** What a restore does not put back, said after what it does; empty when nothing was left. */
export const whatWasLeft = ({ submodulesLeft = 0, committed }: Pick<Revert, "submodulesLeft" | "committed">) =>
  [committed && whatCommitsLeft(committed), submodulesLeft > 0 && whatSubmodulesLeft(submodulesLeft)].filter(Boolean).join(" ");

/** What going back to a turn would do, as the host works it out while the dialog is up. */
export interface UndoPreview {
  plan: RestorePlan | null;
  /** Which files the plan's counts are. */
  files?: RestoreFiles;
  /** Why the files stay as they are, when they do. */
  filesNote?: string;
  /** Why the conversation cannot go back, when it cannot. */
  cannotRewind?: string;
  /** What a rewind leaves: how many turns go, and the turn it goes back to; null keptFrom: all of them. */
  turnsLeaving?: number;
  keptFrom?: string | null;
}

/** What the conversation loses: the turns from this one on, and the agent's own history with them. */
export function whatLeaves({ turnsLeaving = 1, keptFrom }: UndoPreview) {
  const turns = turnsLeaving === 1 ? "1 turn leaves" : `${turnsLeaving} turns leave`;
  return keptFrom
    ? `${turns} the conversation, and the agent's own history goes back with ${turnsLeaving === 1 ? "it" : "them"}, to before “${keptFrom}”.`
    : "Every turn leaves the conversation, and the agent starts over with nothing of it.";
}

export const putsAnyFileBack = (plan: RestorePlan | null) => plan !== null && plan.restored + plan.removed > 0;

/** A rewind always has turns to drop; an undo of a turn's files has something to do only when a file would go back. */
export const anythingToUndo = (preview: UndoPreview, rewind: boolean) => rewind || putsAnyFileBack(preview.plan);

/** What the files do: they go back too, or they stay as they are and this says why. */
export function whatFiles(preview: UndoPreview, rewind: boolean, keepFiles: boolean) {
  if (preview.filesNote) return rewind ? `The files stay as they are: ${preview.filesNote}` : preview.filesNote;
  if (!preview.plan) return "";
  if (keepFiles) return "The files stay as they are now, with what the turns that leave did to them.";
  const putsBack = putsAnyFileBack(preview.plan);
  const putBack = putsBack
    ? `${rewind ? "The files go back too," : "The files go back"} to how they were when this turn began: ${whatChanged(preview.plan)}.`
    : `${preview.plan.committed ? "No other file" : "No file"} changed since this turn began.`;
  const changed = [putBack, whatWasLeft(preview.plan)].filter(Boolean).join(" ");
  return rewind || !putsBack ? changed : `${changed} The turn above stays in the conversation, and the agent is told the files no longer hold it.`;
}

export const listsAnyFile = ({ deleted, putBack, committed }: RestoreFiles) => [deleted, putBack, committed].some(({ paths }) => paths.length > 0);

/** How the agent is told its changes are no longer in the files, ahead of the message it is being sent. */
export function withRevertNotes(reverts: Revert[], message: string) {
  if (reverts.length === 0) return message;
  const notes = reverts.map((revert) =>
    [
      `The user put this workspace's files back to how they were before the turn that began with "${revert.toMessage}": ${whatChanged(revert)}.`,
      whatWasLeft(revert),
      "The conversation above is unchanged, but the files no longer hold what was changed or created after that point.",
    ]
      .filter(Boolean)
      .join(" "),
  );
  return `${notes.join("\n\n")}\n\n${message}`;
}

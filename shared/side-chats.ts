import { worksForARoom, type Conversation, type HarnessId, type SideChatAccess, type StoredEvent } from "./model.ts";
import { buildTimeline } from "./timeline.ts";

export const SIDE_CHAT_COMMAND = "btw";

/** The question of a `/btw question` message, empty for a bare `/btw`; null for any other message. */
export function sideChatQuestionIn(message: string): string | null {
  const match = /^\s*\/btw(?:\s+([\s\S]*?))?\s*$/.exec(message);
  return match ? (match[1] ?? "") : null;
}

/**
 * The mode each agent stays read-only in, as tried on each agent in November 2026: Claude Code's plan mode blocks
 * commands and asks before edits, Codex's read-only mode sandboxes both, Antigravity's plan mode asks before both, and
 * Mirador answers every such question from a side chat with no. opencode's plan mode blocks edits but still runs
 * commands without asking, and pi has no permissions at all.
 */
const readOnlyModes: Record<HarnessId, string | null> = { claude: "plan", codex: "read-only", antigravity: "plan", opencode: "plan", pi: null, copilot: null };

const holdsSideChatsToReading: Record<HarnessId, boolean> = { claude: true, codex: true, antigravity: true, opencode: false, pi: false, copilot: false };

export const sideChatModeOf = (harness: HarnessId) => readOnlyModes[harness];

/** Each agent's mode that asks the most and still lets it change files: Claude Code and Antigravity ask before edits there, Codex before it leaves the folder. */
const fileChangingModes: Record<HarnessId, string | null> = { claude: "default", codex: "workspace-write", antigravity: "default", opencode: null, pi: null, copilot: null };

export const fileChangingModeOf = (harness: HarnessId) => fileChangingModes[harness];

/**
 * Whether a turn goes on in the mode it started in, whatever mode its session is switched to meanwhile. Codex's does: its
 * adapter passes the mode along with a message only. Claude Code and Antigravity, as tried on each in November 2026, ask
 * about the next edit of a turn switched to plan mode.
 */
export const keepsModeThroughTurn = (harness: HarnessId) => harness === "codex";

/** Whether the agent itself can stop a side chat from changing files and running commands, rather than only ask it not to. */
export const canHoldSideChatsToReading = (harness: HarnessId) => holdsSideChatsToReading[harness];

/** Whether the side chat's agent is stopped from changing files and running commands, rather than only asked not to, or let. */
export const sideChatIsReadOnly = ({ harness, sideChatMayChangeFiles }: Pick<Conversation, "harness" | "sideChatMayChangeFiles">) =>
  canHoldSideChatsToReading(harness) && !sideChatMayChangeFiles;

export const sideChatAccessOf = ({ sideChatMayChangeFiles }: Pick<Conversation, "sideChatMayChangeFiles">): SideChatAccess => (sideChatMayChangeFiles ? "can-change-files" : "read-only");

export const isSideChat = (conversation: Pick<Conversation, "sideChatOf">) => conversation.sideChatOf !== undefined;

/** Who opens a new side chat, beside which conversation, and what its workspace and Settings say side chats may do. */
export interface SideChatOpening {
  parent: Pick<Conversation, "harness" | "roomId" | "broughtIntoRoom" | "sideChatAccess">;
  openedByOwner: boolean;
  /** Null for what Settings say. */
  workspaceChoice: SideChatAccess | null;
  setting: SideChatAccess;
}

/**
 * Whether there is a choice of what the conversation's side chats may do: only where its agent can hold one to reading, as
 * another can't be stopped and is only asked to read, and where it works for no room, as a room's only read.
 */
export const sideChatAccessIsAChoice = (parent: Pick<Conversation, "harness" | "roomId" | "broughtIntoRoom">) =>
  canHoldSideChatsToReading(parent.harness) && !worksForARoom(parent);

/**
 * Whether a new side chat may change files, in the mode of the conversation it is beside: only one the owner opens, where
 * there is a choice and the conversation, else its workspace, else Settings, lets its side chats change files.
 */
export function sideChatMayChangeFiles({ parent, openedByOwner, workspaceChoice, setting }: SideChatOpening): boolean {
  if (!sideChatAccessIsAChoice(parent) || !openedByOwner) return false;
  return (parent.sideChatAccess ?? workspaceChoice ?? setting) === "can-change-files";
}

/** The text as a Markdown quote, each of its lines quoted. */
export const quoted = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");

/** The first line that is not part of a quote: what a side chat that begins with quoted text asks. */
export const askedOutsideQuotes = (message: string) =>
  message
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith(">")) ?? message.trim();

/** About a long working session's worth of messages; older ones are left out of the handover first. */
const HANDOVER_CHARACTERS = 60_000;

/** The conversation so far as plain text, newest kept when it is too long: for an agent that cannot copy the session itself. */
export function conversationAsText(events: StoredEvent[], maxCharacters = HANDOVER_CHARACTERS): string {
  const lines = buildTimeline(events).flatMap((block) => {
    if (block.kind === "user") return [`User: ${block.text.trim()}`];
    if (block.kind === "agent") return [`Assistant: ${block.text.trim()}`];
    if (block.kind === "tool") return [`(tool: ${block.title})`];
    return [];
  });
  const kept: string[] = [];
  let length = 0;
  for (const line of [...lines].reverse()) {
    if (length + line.length > maxCharacters) break;
    kept.unshift(line);
    length += line.length + 2;
  }
  return [...(kept.length < lines.length ? ["(earlier messages left out)"] : []), ...kept].join("\n\n");
}

const SIDE_CHAT_BRIEF_TAG = "mirador-side-chat";

const READING_ONLY =
  "Answer the user's questions directly. Read and search as you need, but do not change files, run commands that change anything, or start on the main conversation's task.";

const CHANGING_FILES =
  "Answer the user's questions directly, and change files or run commands where the user asks you to, but do not start on the main conversation's task. The main conversation's agent may be editing the same files right now: read a file again just before you change it, and say what you changed.";

/**
 * What the agent hears before the side chat's first question. A forked session already holds the conversation; a new
 * one gets it in `handover`.
 */
export function sideChatBrief(handover: string | null, mayChangeFiles: boolean): string {
  const context =
    handover === null
      ? "This session is a copy of the main conversation."
      : `You cannot see the main conversation, so here it is as text:\n<conversation>\n${handover}\n</conversation>`;
  return [
    `<${SIDE_CHAT_BRIEF_TAG}>`,
    "The user opened a side chat to ask about their conversation with an agent, without interrupting it.",
    context,
    "The main conversation goes on without you, and nothing said here reaches it unless the user sends it there.",
    mayChangeFiles ? CHANGING_FILES : READING_ONLY,
    "Answer here in text: a side chat shows no canvas, so pages you show and questions you ask there go unseen.",
    `</${SIDE_CHAT_BRIEF_TAG}>`,
  ].join("\n");
}

/** What the agent of a side chat hears with the next message once the user switched what the side chat may do. */
export const sideChatAccessNote = (access: SideChatAccess) =>
  [`<${SIDE_CHAT_BRIEF_TAG}>`, "The user switched what this side chat may do.", access === "can-change-files" ? CHANGING_FILES : READING_ONLY, `</${SIDE_CHAT_BRIEF_TAG}>`].join("\n");

export const isSideChatBrief = (text: string) => text.startsWith(`<${SIDE_CHAT_BRIEF_TAG}>`);

/** A side chat's answer, as the main conversation's message box takes it: quoted, after a line the agent reads to know where it came from. */
export const answerForMainChat = (answer: string) => `From a side chat:\n\n${quoted(answer)}\n\n`;

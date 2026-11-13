import type { Conversation, HarnessId, StoredEvent } from "./model.ts";
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

const keepsSideChatsReadOnly: Record<HarnessId, boolean> = { claude: true, codex: true, antigravity: true, opencode: false, pi: false, copilot: false };

export const sideChatModeOf = (harness: HarnessId) => readOnlyModes[harness];

/** Whether the agent itself stops a side chat from changing files and running commands, rather than only being asked not to. */
export const sideChatIsReadOnly = (harness: HarnessId) => keepsSideChatsReadOnly[harness];

export const isSideChat = (conversation: Pick<Conversation, "sideChatOf">) => conversation.sideChatOf !== undefined;

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

/**
 * What the agent hears before the side chat's first question. A forked session already holds the conversation; a new
 * one gets it in `handover`.
 */
export function sideChatBrief(handover: string | null): string {
  const context =
    handover === null
      ? "This session is a copy of the main conversation."
      : `You cannot see the main conversation, so here it is as text:\n<conversation>\n${handover}\n</conversation>`;
  return [
    `<${SIDE_CHAT_BRIEF_TAG}>`,
    "The user opened a side chat to ask about their conversation with an agent, without interrupting it.",
    context,
    "The main conversation goes on without you, and nothing said here reaches it unless the user sends it there.",
    "Answer the user's questions directly. Read and search as you need, but do not change files, run commands that change anything, or start on the main conversation's task.",
    "Answer here in text: a side chat shows no canvas, so pages you show and questions you ask there go unseen.",
    `</${SIDE_CHAT_BRIEF_TAG}>`,
  ].join("\n");
}

export const isSideChatBrief = (text: string) => text.startsWith(`<${SIDE_CHAT_BRIEF_TAG}>`);

/** A side chat's answer, as the main conversation's message box takes it: quoted, after a line the agent reads to know where it came from. */
export const answerForMainChat = (answer: string) => `From a side chat:\n\n${quoted(answer)}\n\n`;

import type { HostProblem } from "./host-problems.ts";
import { isUntitled, type Conversation, type JoinRequest } from "./model.ts";
import { cutWithEllipsis } from "./text-cut.ts";

/** Why a conversation needs you: everything that makes it your move. */
export type NotificationReason =
  | { kind: "question"; question: string }
  | { kind: "permission"; tool?: string | null }
  | { kind: "finished" }
  | { kind: "error"; message: string; problem?: HostProblem }
  /** A job the agent left running ended, and its message is for you rather than the agent. */
  | { kind: "job-ended"; message: string };

/** What a notification says, for a page or the desktop app to put in its own language; title and body say it in English. */
export type NotificationAbout =
  | { kind: "conversation"; reason: NotificationReason; untitled?: true }
  | { kind: "join-request"; request: Pick<JoinRequest, "name" | "fromAddress" | "tailscaleUser"> };

/** What a notification is about, so a device can let through only the kinds its owner wants. */
export type NotificationKind = NotificationReason["kind"] | "join-request";

export interface SystemNotification {
  /** Set on the ones phones may also get as pushes; a phone answers notification.shown with it. */
  id?: string;
  kind: NotificationKind;
  /** Set when another machine sent it on through this host; the conversation is that machine's. */
  machineId?: string;
  /** None when it is about this machine itself, e.g. a device asking to join it. */
  conversationId?: string;
  title: string;
  workspace: string;
  body: string;
  about?: NotificationAbout;
}

const BODY_LENGTH = 200;

function reasonText(reason: NotificationReason) {
  switch (reason.kind) {
    case "question":
      return `Asks: ${reason.question}`;
    case "permission":
      return `Wants permission: ${reason.tool || "a tool"}`;
    case "finished":
      return "Finished, waiting for you";
    case "error":
      return `Stopped with an error: ${reason.message}`;
    case "job-ended":
      return reason.message;
  }
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** On one line, and short enough for a notification to show it whole. */
export const notificationBody = (text: string) => cutWithEllipsis(oneLine(text), BODY_LENGTH - 1, BODY_LENGTH);

export const systemNotification = (
  conversation: Pick<Conversation, "id" | "title" | "titleSetByUser">,
  workspace: string,
  reason: NotificationReason,
): SystemNotification => ({
  kind: reason.kind,
  conversationId: conversation.id,
  title: conversation.title,
  workspace,
  body: notificationBody(reasonText(reason)),
  about: { kind: "conversation", reason, ...(isUntitled(conversation) && { untitled: true as const }) },
});

export type TurnOutcome = { stopReason: string } | { error: string; problem?: HostProblem };

/**
 * A turn you cancelled, one whose queued message goes out right away, or one that finished to wait for a job whose end
 * resumes the agent, is not your move.
 */
export function turnEndReason(
  outcome: TurnOutcome,
  { messagesQueued = false, resumedByAJob = false } = {},
): Extract<NotificationReason, { kind: "finished" | "error" }> | null {
  if (messagesQueued) return null;
  if ("error" in outcome) return { kind: "error", message: outcome.error, ...(outcome.problem && { problem: outcome.problem }) };
  return outcome.stopReason === "cancelled" || resumedByAJob ? null : { kind: "finished" };
}

/** On this machine's own screen, so whoever sits there can let the device in, typing the number it shows. */
export const joinRequestNotification = ({ name, fromAddress, tailscaleUser }: JoinRequest): SystemNotification => ({
  kind: "join-request",
  title: `${name} asks to join Mirador`,
  workspace: "",
  body: `From ${fromAddress}${tailscaleUser ? `, signed in to Tailscale as ${tailscaleUser}` : ""}. Open Mirador to approve it by typing the number it shows.`,
  about: { kind: "join-request", request: { name, fromAddress, tailscaleUser } },
});

/** Where a notification has no subtitle line (browsers, Linux), the workspace leads the body. */
export const bodyWithWorkspace = ({ workspace, body }: SystemNotification) => (workspace ? `${workspace} · ${body}` : body);

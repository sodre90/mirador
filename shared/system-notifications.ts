import type { HostProblem } from "./host-problems.ts";
import { isUntitled, type Conversation, type JoinRequest } from "./model.ts";
import type { RoomAlert } from "./room-reading.ts";
import type { RoomAuthorRole } from "./rooms.ts";
import { cutWithEllipsis } from "./text-cut.ts";
import { oneLine } from "./written-text.ts";

/** What waits in a room for your OK that no tool asks for: a task, by whose name and role where the room knows it, or the room's workspace for an agent someone brought. */
export type RoomAsk = { kind: "task"; by: string; role?: RoomAuthorRole } | { kind: "workspace"; agent: string };

/** Why a conversation needs you: everything that makes it your move. */
export type NotificationReason =
  | { kind: "question"; question: string }
  | { kind: "permission"; tool?: string | null; ask?: RoomAsk }
  | { kind: "finished" }
  | { kind: "error"; message: string; problem?: HostProblem }
  /** A job the agent left running ended, and its message is for you rather than the agent. */
  | { kind: "job-ended"; message: string }
  /** The time came that the user asked to come back to it at. */
  | { kind: "reminder"; note?: string };

/** What a notification says, for a page or the desktop app to put in its own language; title and body say it in English. */
export type NotificationAbout =
  | { kind: "conversation"; reason: NotificationReason; untitled?: true }
  | { kind: "join-request"; request: Pick<JoinRequest, "name" | "fromAddress" | "tailscaleUser"> }
  | { kind: "room"; alert: RoomAlert };

/** What a notification is about, so a device can let through only the kinds its owner wants; "plugin" is one a plugin sends of its own. */
export type NotificationKind = NotificationReason["kind"] | "join-request" | "plugin";

export interface SystemNotification {
  /** Set on the ones phones may also get as pushes; a phone answers notification.shown with it. */
  id?: string;
  kind: NotificationKind;
  /** Set when another machine sent it on through this host; the conversation is that machine's. */
  machineId?: string;
  /** None when it is about this machine itself, e.g. a device asking to join it. */
  conversationId?: string;
  /** The room it calls you to, of this machine or, with `machineId`, of that one. */
  roomId?: string;
  title: string;
  workspace: string;
  body: string;
  about?: NotificationAbout;
}

const BODY_LENGTH = 200;

function roomAskText(ask: RoomAsk) {
  if (ask.kind === "workspace") return `the room's workspace, for ${ask.agent}`;
  return ask.role ? `a task of ${ask.by}, ${ask.role}` : `a task from ${ask.by}`;
}

function reasonText(reason: NotificationReason) {
  switch (reason.kind) {
    case "question":
      return `Asks: ${reason.question}`;
    case "permission":
      return `Wants permission: ${reason.ask ? roomAskText(reason.ask) : reason.tool || "a tool"}`;
    case "finished":
      return "Finished, waiting for you";
    case "error":
      return `Stopped with an error: ${reason.message}`;
    case "job-ended":
      return reason.message;
    case "reminder":
      return reason.note ? `Back to it: ${reason.note}` : "You asked to come back to this now";
  }
}

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

/** Something in a room waits for you with no agent's conversation of yours to tell of it: the room's name as the title, and what for. */
export const roomWaitingNotification = (roomId: string, roomName: string, place: string, reason: NotificationReason): SystemNotification => ({
  kind: reason.kind,
  roomId,
  title: roomName,
  workspace: place,
  body: notificationBody(reasonText(reason)),
  about: { kind: "conversation", reason },
});

export type TurnOutcome = { stopReason: string } | { error: string; problem?: HostProblem };

/**
 * A turn you cancelled, one whose queued message goes out right away, or one that finished to wait for a job whose end
 * resumes the agent, is not your move.
 */
export function turnEndReason(
  outcome: TurnOutcome,
  { messagesQueued = false, resumedByAJob = false, holdsQueue = false } = {},
): Extract<NotificationReason, { kind: "finished" | "error" }> | null {
  if (messagesQueued && !holdsQueue) return null;
  if ("error" in outcome) return { kind: "error", message: outcome.error, ...(outcome.problem && { problem: outcome.problem }) };
  return outcome.stopReason === "cancelled" || resumedByAJob ? null : { kind: "finished" };
}

/** On this machine's own screen, so whoever sits there can let the device in, typing the number it shows. */
export const joinRequestNotification = ({ name, fromAddress, tailscaleUser }: JoinRequest): SystemNotification => ({
  kind: "join-request",
  title: `${name} asks to join Mirador`,
  workspace: "",
  body: `From ${fromAddress}${tailscaleUser ? `, signed in to Tailscale as ${tailscaleUser}` : ""}. Open Mirador to approve it by typing the number it shows. Approving makes it one of your own devices, with full control of Mirador; let anyone else in with a room invite.`,
  about: { kind: "join-request", request: { name, fromAddress, tailscaleUser } },
});

function roomAlertText(alert: RoomAlert) {
  switch (alert.about) {
    case "mention":
      return `${alert.by} tagged you: ${alert.text}`;
    case "confirm":
      return `Waits for you to confirm the answer: ${alert.question}`;
    case "approve":
      return `Waits for your approval: ${alert.what}`;
    case "knock":
      return alert.by ? `Someone waits for you to let them in, giving the name “${alert.by}”` : "Someone waits for you to let them in";
  }
}

/** A room calls you: its name as the title, and what for; phones take it as they take an agent's question, which also waits for you. */
export const roomNotification = (roomId: string, roomName: string, place: string, alert: RoomAlert): SystemNotification => ({
  kind: "question",
  roomId,
  title: roomName,
  workspace: place,
  body: notificationBody(roomAlertText(alert)),
  about: { kind: "room", alert },
});

const TITLE_LENGTH = 120;

/** What a plugin tells the user, in its own words: the title and body it wrote, and the workspace it's about. */
export const pluginNotification = (workspace: string, { title, body }: { title: string; body: string }): SystemNotification => ({
  kind: "plugin",
  title: cutWithEllipsis(oneLine(title), TITLE_LENGTH - 1, TITLE_LENGTH),
  workspace,
  body: notificationBody(body),
});

/** Where a notification has no subtitle line (browsers, Linux), the workspace leads the body. */
export const bodyWithWorkspace = ({ workspace, body }: SystemNotification) => (workspace ? `${workspace} · ${body}` : body);

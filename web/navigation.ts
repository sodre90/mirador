import type { Conversation, Workspace } from "../shared/model.ts";
import { isPutAway } from "../shared/reminders.ts";
import { CUSTOM_ORDER, inConversationOrder, type ConversationOrder } from "../shared/conversation-order.ts";
import { isSideChat } from "../shared/side-chats.ts";
import { waitingByUrgency } from "../shared/waiting.ts";

export interface NavigationState {
  workspaces: Workspace[];
  conversations: Conversation[];
  selectedConversationId: string | null;
  conversationOrder?: ConversationOrder;
  /** While the pointer is over the list: the times it sorts by, as they were when the pointer got there, so no row moves just as it is clicked. */
  heldTurnTimes?: HeldTurnTimes | null;
}

export type HeldTurnTimes = Map<string, Pick<Conversation, "lastMessageAt" | "lastReplyAt">>;

export const turnTimesOf = (conversations: Conversation[]): HeldTurnTimes =>
  new Map(conversations.map(({ id, lastMessageAt, lastReplyAt }) => [id, { lastMessageAt, lastReplyAt }]));

/**
 * A workspace's conversations in the order the sidebar lists them: favourites first, then the order the user chose (by
 * default where they put them, a new one first), with one a plugin's tool started, and a side chat, right under the
 * conversation it belongs to; a delegated task until the user dismisses it, and a dismissed one again while it waits
 * for the user.
 */
export function conversationsIn(state: Pick<NavigationState, "conversations" | "conversationOrder" | "heldTurnTimes">, workspaceId: string): Conversation[] {
  const order = inConversationOrder(state.conversationOrder ?? CUSTOM_ORDER);
  const asHeld = (conversation: Conversation) => {
    const held = state.heldTurnTimes?.get(conversation.id);
    return held ? { ...conversation, ...held } : conversation;
  };
  const inOrder = state.conversations
    .filter((conversation) => conversation.workspaceId === workspaceId && !isDismissedAndSettled(conversation) && !isPutAway(conversation.reminder))
    .sort((a, b) => order(asHeld(a), asHeld(b)));
  const callerOf = (conversation: Conversation) => (isUnderCaller(conversation, inOrder) ? callerIdOf(conversation) : null);
  return inOrder.filter((conversation) => !callerOf(conversation)).flatMap((caller) => [caller, ...inOrder.filter((conversation) => callerOf(conversation) === caller.id)]);
}

/** A workspace's conversations put away until a reminder, the soonest back first: its Later group. */
export const putAwayIn = (state: Pick<NavigationState, "conversations">, workspaceId: string): Conversation[] =>
  state.conversations
    .filter((conversation) => conversation.workspaceId === workspaceId && isPutAway(conversation.reminder))
    .sort((a, b) => a.reminder!.at - b.reminder!.at);

const isDismissedAndSettled = (conversation: Conversation) => conversation.startedBy?.dismissed === true && !conversation.waitingFor;

/** The conversation that started this one through a plugin's tool, or that this side chat is beside. */
export const callerIdOf = (conversation: Pick<Conversation, "startedBy" | "sideChatOf">) => conversation.startedBy?.conversationId ?? conversation.sideChatOf;

/** Whether the sidebar lists the conversation under its caller, which it does while that one is listed too. */
export const isUnderCaller = (conversation: Conversation, listed: Conversation[]) => {
  const callerId = callerIdOf(conversation);
  return callerId !== undefined && listed.some(({ id }) => id === callerId);
};

/** A conversation under its caller shows while the caller's row is unfolded, or while it waits for the user. */
export const showsInSidebar = (conversation: Conversation, listed: Conversation[], callersOpened: ReadonlySet<string>) =>
  !isUnderCaller(conversation, listed) || callersOpened.has(callerIdOf(conversation)!) || Boolean(conversation.waitingFor);

const newest = (conversations: Conversation[]) => conversations.reduce((newest, each) => (each.createdAt > newest.createdAt ? each : newest));

/** The conversations to step through and number: a side chat opens beside its conversation, so it has no place of its own. */
const steppedThrough = (state: NavigationState, workspaceId: string) => conversationsIn(state, workspaceId).filter((conversation) => !isSideChat(conversation));

const sidebarOrder = (state: NavigationState) => state.workspaces.flatMap(({ id }) => steppedThrough(state, id));

const wrapped = <T>(items: T[], index: number) => items[(index + items.length) % items.length];

/** The workspace of the selected conversation, or the first workspace when nothing is selected. */
export function currentWorkspace(state: NavigationState): Workspace | undefined {
  const selected = state.conversations.find(({ id }) => id === state.selectedConversationId);
  return state.workspaces.find(({ id }) => id === selected?.workspaceId) ?? state.workspaces[0];
}

export function adjacentConversation(state: NavigationState, step: 1 | -1): string | null {
  const ordered = sidebarOrder(state);
  if (ordered.length === 0) return null;
  const index = ordered.findIndex(({ id }) => id === state.selectedConversationId);
  if (index === -1) return (step === 1 ? ordered[0] : ordered.at(-1))!.id;
  return wrapped(ordered, index + step)!.id;
}

/** The most urgent conversation waiting for the user; from one that waits itself, the next most urgent, and round to the first again. */
export function nextWaitingConversation(state: NavigationState): string | null {
  const waiting = waitingByUrgency(sidebarOrder(state));
  if (waiting.every(({ id }) => id === state.selectedConversationId)) return null;
  const index = waiting.findIndex(({ id }) => id === state.selectedConversationId);
  return wrapped(waiting, index + 1)!.id;
}

/** The newest conversation of the next workspace that has any. */
export function adjacentWorkspaceConversation(state: NavigationState, step: 1 | -1): string | null {
  const withConversations = state.workspaces.filter(({ id }) => steppedThrough(state, id).length > 0);
  if (withConversations.length === 0) return null;
  const current = currentWorkspace(state);
  const index = withConversations.findIndex(({ id }) => id === current?.id);
  const target = index === -1 ? withConversations[0]! : wrapped(withConversations, index + step)!;
  return newest(steppedThrough(state, target.id)).id;
}

export function numberedConversation(state: NavigationState, number: number): string | null {
  const workspace = currentWorkspace(state);
  return workspace ? (steppedThrough(state, workspace.id)[number - 1]?.id ?? null) : null;
}

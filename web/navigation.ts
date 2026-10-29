import type { Conversation, Workspace } from "../shared/model.ts";
import { inSidebarOrder } from "../shared/sidebar-order.ts";

export interface NavigationState {
  workspaces: Workspace[];
  conversations: Conversation[];
  selectedConversationId: string | null;
}

/**
 * A workspace's conversations in the order the sidebar lists them: where the user put them, a new one first, and one a
 * plugin's tool started right under the conversation that started it, until the user dismisses its task.
 */
export function conversationsIn(state: Pick<NavigationState, "conversations">, workspaceId: string): Conversation[] {
  const inOrder = state.conversations.filter((conversation) => conversation.workspaceId === workspaceId && !conversation.startedBy?.dismissed).sort(inSidebarOrder);
  const callerOf = (conversation: Conversation) => (isUnderCaller(conversation, inOrder) ? conversation.startedBy!.conversationId : null);
  return inOrder.filter((conversation) => !callerOf(conversation)).flatMap((caller) => [caller, ...inOrder.filter((conversation) => callerOf(conversation) === caller.id)]);
}

/** Whether the sidebar lists the conversation under the one that started it, which it does while that one is listed too. */
export const isUnderCaller = (conversation: Conversation, listed: Conversation[]) =>
  conversation.startedBy !== undefined && listed.some(({ id }) => id === conversation.startedBy!.conversationId);

const newest = (conversations: Conversation[]) => conversations.reduce((newest, each) => (each.createdAt > newest.createdAt ? each : newest));

const sidebarOrder = (state: NavigationState) => state.workspaces.flatMap(({ id }) => conversationsIn(state, id));

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

/** The newest conversation of the next workspace that has any. */
export function adjacentWorkspaceConversation(state: NavigationState, step: 1 | -1): string | null {
  const withConversations = state.workspaces.filter(({ id }) => conversationsIn(state, id).length > 0);
  if (withConversations.length === 0) return null;
  const current = currentWorkspace(state);
  const index = withConversations.findIndex(({ id }) => id === current?.id);
  const target = index === -1 ? withConversations[0]! : wrapped(withConversations, index + step)!;
  return newest(conversationsIn(state, target.id)).id;
}

export function numberedConversation(state: NavigationState, number: number): string | null {
  const workspace = currentWorkspace(state);
  return workspace ? (conversationsIn(state, workspace.id)[number - 1]?.id ?? null) : null;
}

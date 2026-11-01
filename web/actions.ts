import type { Dispatch } from "react";
import type { Workspace } from "../shared/model.ts";
import { connection } from "./connection.ts";
import type { AppAction } from "./state.ts";

/** Without a profile yet, the main pane offers to set one up instead, as it does with no conversation open. */
export function startConversationIn(workspace: Workspace, dispatch: Dispatch<AppAction>) {
  if (workspace.defaultLaunch.profileId === null) return dispatch({ type: "select", conversationId: null });
  dispatch({ type: "awaiting-conversation", workspaceId: workspace.id });
  connection.send({ type: "conversation.create", workspaceId: workspace.id });
}

/** Hidden conversations kept in the page have the same elements as the one on screen. */
const onScreen = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)].find((element) => element.checkVisibility());

export function findInOpenConversation() {
  onScreen<HTMLButtonElement>(".chat-header .find-trigger")?.click();
}

export function startRenamingOpenConversation() {
  onScreen<HTMLElement>('.chat-header [data-rename-trigger="click"]')?.click();
}

/** The canvas takes focus on the control the user most likely wants: an answer button, else the page itself. */
export function focusPane(pane: "chat" | "canvas") {
  if (pane === "chat") return onScreen<HTMLElement>(".composer textarea, .composer .formatted-box")?.focus();
  const panel = onScreen(".canvas-panel");
  const target =
    panel?.querySelector<HTMLElement>(".canvas-body .choose") ??
    panel?.querySelector<HTMLElement>(".canvas-body iframe") ??
    panel?.querySelector<HTMLElement>(".canvas-tab.active");
  target?.focus();
}

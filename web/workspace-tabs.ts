import { useEffect, useRef, type Dispatch } from "react";
import type { Workspace } from "../shared/model.ts";
import { startConversationIn } from "./actions.ts";
import { connection, type ConnectionStatus } from "./connection.ts";
import type { AppAction } from "./state.ts";
import { onConversationToStart } from "./tab-handoffs.ts";

/** The shown workspace's plugin tabs follow their host code: now, after each reconnect, and on every change. */
export function useWorkspaceTabsSubscribed(status: ConnectionStatus, workspaceId: string | undefined, pluginsWithTabs: number) {
  useEffect(() => {
    if (status === "open" && workspaceId && pluginsWithTabs > 0) connection.send({ type: "plugin-tab.subscribe", workspaceId });
  }, [status, workspaceId, pluginsWithTabs]);
}

/** A plugin's tab starts a conversation in its workspace, which then shows, as one the user started would. */
export function useConversationsStartedFromTabs(workspaces: Workspace[], dispatch: Dispatch<AppAction>) {
  const latest = useRef(workspaces);
  latest.current = workspaces;
  useEffect(
    () =>
      onConversationToStart(({ workspaceId, prompt }) => {
        const workspace = latest.current.find(({ id }) => id === workspaceId);
        if (!workspace || workspace.defaultLaunch.profileId === null) return false;
        startConversationIn(workspace, dispatch, prompt);
        return true;
      }),
    [dispatch],
  );
}

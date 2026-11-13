import { useContext, useEffect, useMemo, useRef } from "react";
import {
  pluginItemReplyFailedMessage,
  pluginItemReplyMessage,
  pluginThemeMessage,
  pluginWindowStateMessage,
  workspaceTabPage,
  type CanvasFrameMessage,
} from "../shared/canvas-document.ts";
import { useEnterWhileBusy } from "./busy-sending.ts";
import { CanvasFrame } from "./Canvas.tsx";
import { connection } from "./connection.ts";
import { useFontScale } from "./font-scale.ts";
import { showFramedHint } from "./Hint.tsx";
import { KnownConversations } from "./known-conversations.ts";
import { onPage, themeVariables } from "./PluginItemView.tsx";
import { addToComposerFromTab, startConversationFromTab } from "./tab-handoffs.ts";
import { useShownTheme } from "./theme.ts";

/** A plugin's tab in a workspace, as the canvas bar offers it. */
export interface WorkspacePluginTab {
  plugin: string;
  title: string;
  state: unknown;
  problem: string | null;
}

async function actInTab(plugin: string, workspaceId: string, action: unknown): Promise<unknown> {
  const { reply, problem } = await connection.sendAndAwait(
    (requestId) => ({ type: "plugin-tab.action", requestId, plugin, workspaceId, action }),
    (message, requestId) => (message.type === "plugin-tab.acted" && message.requestId === requestId ? message : undefined),
  );
  if (problem !== null) throw new Error(problem);
  return reply;
}

function promptFromTab(conversationId: string, text: string, afterTurn: boolean) {
  if (!text.trim()) throw new Error("The message is empty.");
  if (!connection.send({ type: "conversation.prompt", conversationId, text, imageIds: [], afterTurn })) throw new Error("Mirador is not connected.");
}

/** The plugin's canvas view, drawing its tab: the tab's state reaches it, its actions reach the plugin, and its hand-offs reach the conversation. */
export function WorkspaceTabView({
  tab,
  viewUrl,
  assetsOrigin,
  workspaceId,
  conversationId,
}: {
  tab: WorkspacePluginTab;
  viewUrl: string;
  assetsOrigin: string;
  workspaceId: string;
  conversationId: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(tab.state);
  latest.current = tab.state;
  const shownTheme = useShownTheme();
  const [fontScale] = useFontScale();
  const enterWhileBusy = useEnterWhileBusy();
  const conversations = useContext(KnownConversations);
  const opensConversations = conversations !== null;
  const frameId = `tab-${tab.plugin}`;
  const page = useMemo(() => workspaceTabPage(viewUrl, frameId, { opensConversations }), [viewUrl, frameId, opensConversations]);
  const post = (message: unknown) => frame.current?.contentWindow?.postMessage(message, "*");
  const postState = () => post(pluginWindowStateMessage(latest.current));
  const postTheme = () => {
    const where = frame.current?.parentElement;
    if (where) post(pluginThemeMessage(themeVariables(where)));
  };
  useEffect(postState, [tab.state]);
  useEffect(postTheme, [shownTheme, fontScale]);
  useEffect(() => () => showFramedHint(null), []);

  const answer = async (requestId: string, reply: () => unknown) => {
    const answerTo = frame.current?.contentWindow;
    try {
      answerTo?.postMessage(pluginItemReplyMessage(requestId, (await reply()) ?? null), "*");
    } catch (error) {
      answerTo?.postMessage(pluginItemReplyFailedMessage(requestId, error instanceof Error ? error.message : String(error)), "*");
    }
  };
  const openInWorkspace = (openedId: string) => {
    if (!conversations?.some(({ id, workspaceId: inWorkspace }) => id === openedId && inWorkspace === workspaceId)) {
      throw new Error(`Conversation ${openedId} isn't one of this workspace's, so the tab can't open it.`);
    }
    location.hash = `#/c/${openedId}`;
  };
  const received = (message: CanvasFrameMessage) => {
    if (message.kind === "item-ready") {
      postTheme();
      postState();
    }
    if (!("requestId" in message) || typeof message.requestId !== "string") return handleUnanswered(message);
    const { requestId } = message;
    if (message.kind === "item-send") void answer(requestId, () => actInTab(tab.plugin, workspaceId, message.action));
    if (message.kind === "item-prompt") void answer(requestId, () => promptFromTab(conversationId, String(message.text), enterWhileBusy === "after-turn"));
    if (message.kind === "tab-start-conversation") void answer(requestId, () => startConversationFromTab(workspaceId, String(message.text)));
    if (message.kind === "tab-add-to-composer") void answer(requestId, () => addToComposerFromTab(conversationId, String(message.text)));
    if (message.kind === "item-open-conversation") void answer(requestId, () => openInWorkspace(String(message.conversationId)));
  };
  const handleUnanswered = (message: CanvasFrameMessage) => {
    if (message.kind === "item-hint" && typeof message.text === "string" && frame.current) {
      const anchor = onPage(frame.current, message.anchor);
      showFramedHint(anchor && { text: message.text, anchor });
    }
    if (message.kind === "item-hint-gone") showFramedHint(null);
  };
  return (
    <CanvasFrame frameId={frameId} html={page} assetsOrigin={assetsOrigin} className="plugin workspace-tab" padded={false} allow="clipboard-write" frameRef={frame} onMessage={received} />
  );
}

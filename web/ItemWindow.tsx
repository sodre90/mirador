import { OpensIn } from "./opens-in.ts";
import { useEffect, useReducer } from "react";
import type { ItemWindowRoute } from "../shared/item-window.ts";
import type { PluginCanvasItem } from "../shared/model.ts";
import { HostBanner, useConnectionStatus, useReloadWhenHostRestarted } from "./App.tsx";
import { isTabItem } from "./Checklist.tsx";
import { connection, type ConnectionStatus } from "./connection.ts";
import { JoinMachine } from "./Devices.tsx";
import { HintLayer } from "./Hint.tsx";
import { t } from "./i18n/index.ts";
import { followTitleInDesktopApp, showItemWindowTitle } from "./item-window.ts";
import { PluginItemView } from "./PluginItemView.tsx";
import { initialStateFor, reducer, selectedOpen, type AppState } from "./state.ts";

/** Subscribes to the item's conversation once connected, and again after each reconnect. */
function useConversationSubscribed(status: ConnectionStatus, conversationId: string) {
  useEffect(() => {
    if (status === "open") connection.send({ type: "conversation.subscribe", conversationId });
  }, [status, conversationId]);
}

function shownItem(state: AppState, itemId: string): PluginCanvasItem | null | undefined {
  const open = selectedOpen(state);
  if (!open) return null;
  if (!open.loaded) return undefined;
  const item = open.canvas.find(({ id }) => id === itemId);
  return item?.kind === "plugin" && !item.dismissed ? item : null;
}

function ItemView({ item, state }: { item: PluginCanvasItem; state: AppState }) {
  const view = <PluginItemView item={item} viewPath={state.canvasViews[item.plugin]} assetsOrigin={state.canvasAssetsOrigin} fitsContent={isTabItem(item)} />;
  return <OpensIn.Provider value={state.editor.opensIn}>{isTabItem(item) ? <div className="checklist">{view}</div> : view}</OpensIn.Provider>;
}

/**
 * One canvas item in a window of its own, live as on the canvas: the user's actions reach its plugin, and its changes
 * reach the view. Its title names the item for window managers' rules. Undefined is still loading, null is gone.
 */
export function ItemWindow({ route }: { route: ItemWindowRoute }) {
  const [state, dispatch] = useReducer(reducer, route.conversationId, initialStateFor);
  const status = useConnectionStatus();
  useReloadWhenHostRestarted(state.hostRunId);
  useConversationSubscribed(status, route.conversationId);
  useEffect(() => {
    followTitleInDesktopApp();
    const unsubscribe = connection.onMessage((message) => dispatch({ type: "server", message }));
    connection.connect();
    return unsubscribe;
  }, []);
  const item = shownItem(state, route.itemId);
  useEffect(() => {
    if (item) showItemWindowTitle(item.title);
  }, [item?.title]);

  if (status === "unauthorized") return <JoinMachine />;
  return (
    <div className="item-window">
      <HostBanner status={status} state={state} />
      <div className="canvas-body">
        {item === undefined && <div className="empty-state">{t.canvas.itemWindow.loading}</div>}
        {item === null && <div className="empty-state item-gone">{t.canvas.itemWindow.gone}</div>}
        {item && <ItemView item={item} state={state} />}
      </div>
      <HintLayer />
    </div>
  );
}

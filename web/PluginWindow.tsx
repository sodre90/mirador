import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  pluginItemReplyFailedMessage,
  pluginItemReplyMessage,
  pluginThemeMessage,
  pluginWindowPage,
  pluginWindowStateMessage,
  type CanvasFrameMessage,
} from "../shared/canvas-document.ts";
import { HostBanner, useConnectionStatus, useReloadWhenHostRestarted } from "./App.tsx";
import { CanvasFrame } from "./Canvas.tsx";
import { connection, type ConnectionStatus } from "./connection.ts";
import { JoinMachine } from "./Devices.tsx";
import { HintLayer, showFramedHint } from "./Hint.tsx";
import { t } from "./i18n/index.ts";
import { followTitleInDesktopApp, showPluginWindowTitle } from "./item-window.ts";
import { onPage, themeVariables } from "./PluginItemView.tsx";
import { useFontScale } from "./font-scale.ts";
import { initialStateFor, reducer } from "./state.ts";
import { useShownTheme } from "./theme.ts";

interface WindowState {
  state: unknown;
  problem: string | null;
}

/** The window's state from the plugin's host code: now, once connected and after each reconnect, and on every change. */
function useWindowState(status: ConnectionStatus, plugin: string) {
  const [windowState, setWindowState] = useState<WindowState>();
  useEffect(
    () =>
      connection.onMessage((message) => {
        if (message.type === "plugin-window.state" && message.plugin === plugin) setWindowState({ state: message.state, problem: message.problem });
      }),
    [plugin],
  );
  useEffect(() => {
    if (status === "open") connection.send({ type: "plugin-window.subscribe", plugin });
  }, [status, plugin]);
  return windowState;
}

async function actInWindow(plugin: string, action: unknown): Promise<unknown> {
  const { reply, problem } = await connection.sendAndAwait(
    (requestId) => ({ type: "plugin-window.action", requestId, plugin, action }),
    (message, requestId) => (message.type === "plugin-window.acted" && message.requestId === requestId ? message : undefined),
  );
  if (problem !== null) throw new Error(problem);
  return reply;
}

/** The plugin's canvas view, drawing its window: the window's state reaches it, and its actions reach the plugin. */
function PluginWindowView({ plugin, state, viewUrl, assetsOrigin }: { plugin: string; state: unknown; viewUrl: string; assetsOrigin: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(state);
  latest.current = state;
  const shownTheme = useShownTheme();
  const [fontScale] = useFontScale();
  const page = useMemo(() => pluginWindowPage(viewUrl, plugin), [viewUrl, plugin]);
  const post = (message: unknown) => frame.current?.contentWindow?.postMessage(message, "*");
  const postState = () => post(pluginWindowStateMessage(latest.current));
  const postTheme = () => {
    const where = frame.current?.parentElement;
    if (where) post(pluginThemeMessage(themeVariables(where)));
  };
  useEffect(postState, [state]);
  useEffect(postTheme, [shownTheme, fontScale]);

  const answer = async (requestId: string, reply: () => unknown) => {
    const answerTo = frame.current?.contentWindow;
    try {
      answerTo?.postMessage(pluginItemReplyMessage(requestId, (await reply()) ?? null), "*");
    } catch (error) {
      answerTo?.postMessage(pluginItemReplyFailedMessage(requestId, error instanceof Error ? error.message : String(error)), "*");
    }
  };
  const received = (message: CanvasFrameMessage) => {
    if (message.kind === "item-ready") {
      postTheme();
      postState();
    }
    if (message.kind === "item-send" && typeof message.requestId === "string") void answer(message.requestId, () => actInWindow(plugin, message.action));
    if (message.kind === "item-hint" && typeof message.text === "string" && frame.current) {
      const anchor = onPage(frame.current, message.anchor);
      showFramedHint(anchor && { text: message.text, anchor });
    }
    if (message.kind === "item-hint-gone") showFramedHint(null);
  };
  return (
    <CanvasFrame frameId={plugin} html={page} assetsOrigin={assetsOrigin} className="plugin" padded={false} allow="clipboard-write" frameRef={frame} onMessage={received} />
  );
}

/** A canvas plugin's own window, belonging to no conversation, titled after the plugin's name for window managers' rules. */
export function PluginWindow({ plugin }: { plugin: string }) {
  const [state, dispatch] = useReducer(reducer, null, initialStateFor);
  const status = useConnectionStatus();
  useReloadWhenHostRestarted(state.hostRunId);
  const windowState = useWindowState(status, plugin);
  useEffect(() => {
    followTitleInDesktopApp();
    showPluginWindowTitle(plugin);
    const unsubscribe = connection.onMessage((message) => dispatch({ type: "server", message }));
    connection.connect();
    return unsubscribe;
  }, []);
  const words = t.canvas.pluginWindow;
  const known = state.hostRunId !== null;
  const viewPath = state.canvasViews[plugin];
  const hasWindow = plugin in state.pluginWindows && viewPath !== undefined;

  if (status === "unauthorized") return <JoinMachine />;
  return (
    <div className="item-window">
      <HostBanner status={status} state={state} />
      <div className="canvas-body">
        {(!known || (hasWindow && windowState === undefined)) && <div className="empty-state">{t.canvas.itemWindow.loading}</div>}
        {known && !hasWindow && <div className="empty-state plugin-window-missing">{words.missing(plugin)}</div>}
        {hasWindow && windowState?.problem && <div className="empty-state plugin-window-problem">{windowState.problem}</div>}
        {hasWindow && windowState && !windowState.problem && (
          <PluginWindowView plugin={plugin} state={windowState.state} viewUrl={`${state.canvasAssetsOrigin}${viewPath}`} assetsOrigin={state.canvasAssetsOrigin} />
        )}
      </div>
      <HintLayer />
    </div>
  );
}

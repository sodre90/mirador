import { useOpensIn } from "./opens-in.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { pluginItemOf } from "../shared/canvas-plugins.ts";
import {
  pluginItemMessage,
  pluginItemPage,
  pluginItemReplyFailedMessage,
  pluginItemReplyMessage,
  pluginThemeMessage,
  type CanvasFrameMessage,
  type PluginItemContext,
} from "../shared/canvas-document.ts";
import type { PluginCanvasItem } from "../shared/model.ts";
import { CanvasFrame } from "./Canvas.tsx";
import { connection } from "./connection.ts";
import { replyProblemText } from "./host-error.ts";
import { t } from "./i18n/index.ts";
import { useEnterWhileBusy } from "./busy-sending.ts";
import { useExternalImagesBlocked } from "./external-images.ts";
import { useFontScale } from "./font-scale.ts";
import { showFramedHint } from "./Hint.tsx";
import { useShownTheme } from "./theme.ts";
import { useTypingAids } from "./typing-aids.ts";
import { usePaneFullscreen } from "./Workspace.tsx";

/** Hands the user's action to the item's plugin on the host and waits for its reply. */
async function replyTo(itemId: string, action: unknown): Promise<unknown> {
  const acted = await connection.sendAndAwait(
    (requestId) => ({ type: "canvas.item-action", requestId, itemId, action }),
    (message, requestId) => (message.type === "canvas.item-acted" && message.requestId === requestId ? message : undefined),
  );
  const problem = replyProblemText(acted);
  if (problem !== null) throw new Error(problem);
  return acted.reply;
}

const THEME_COLOURS = ["bg", "panel", "panel-2", "border", "text", "muted", "faint", "accent", "accent-text", "accent-soft", "danger", "ok", "warn", "code-bg"];

/** The panel's colours resolved where the frame sits, as a theme scope there may differ from the page's. */
export function themeVariables(where: HTMLElement): Record<string, string> {
  const probe = document.createElement("span");
  where.append(probe);
  const colours = THEME_COLOURS.map((name) => {
    probe.style.color = `var(--${name})`;
    return [`--mirador-${name}`, getComputedStyle(probe).color];
  });
  probe.remove();
  const style = getComputedStyle(where);
  return {
    ...Object.fromEntries(colours),
    "--mirador-font": style.fontFamily,
    "--mirador-mono": style.getPropertyValue("--mono").trim(),
    "--mirador-font-scale": style.getPropertyValue("--font-scale").trim() || "1",
  };
}

/** A rectangle the frame's page measured, where it shows on the panel's page, the frame scaled down to fit included. */
export function onPage(frame: HTMLIFrameElement, anchor: unknown): DOMRect | null {
  const { left, top, width, height } = (anchor ?? {}) as Record<string, unknown>;
  if (![left, top, width, height].every((value) => typeof value === "number")) return null;
  const shown = frame.getBoundingClientRect();
  const scale = frame.offsetWidth ? shown.width / frame.offsetWidth : 1;
  return new DOMRect(shown.left + (left as number) * scale, shown.top + (top as number) * scale, (width as number) * scale, (height as number) * scale);
}

/** Sends what the user wrote in the view to the agent, as the composer sends. */
function promptFrom(conversationId: string, text: string, afterTurn: boolean) {
  if (!text.trim()) throw new Error("The message is empty.");
  if (!connection.send({ type: "conversation.prompt", conversationId, text, imageIds: [], afterTurn })) throw new Error("Mirador is not connected.");
}

/** What a plugin published, when its plugin isn't installed to draw it: never a blank page. */
function WithoutItsPlugin({ item }: { item: PluginCanvasItem }) {
  return (
    <div className="plugin-item-missing">
      <p>{t.canvas.pluginMissing(item.plugin)}</p>
      <pre>{JSON.stringify(item.data, null, 2)}</pre>
    </div>
  );
}

/**
 * A plugin's item, drawn by the plugin's canvas view: its page loads once and every change to the item reaches it as a
 * message, with Mirador's look as it is now. `seenAgentEditAt` is the agent's change the user last saw, as it was when the
 * item came into view.
 */
export function PluginItemView({
  item,
  viewPath,
  assetsOrigin,
  seenAgentEditAt = null,
  fitsContent = false,
}: {
  item: PluginCanvasItem;
  viewPath: string | undefined;
  assetsOrigin: string;
  seenAgentEditAt?: number | null;
  fitsContent?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(item);
  latest.current = item;
  const [seenWhenShown] = useState(seenAgentEditAt);
  const imagesFromOtherSites = !useExternalImagesBlocked();
  const typingAids = useTypingAids();
  const opensIn = useOpensIn();
  const enterWhileBusy = useEnterWhileBusy();
  const paneFullscreen = usePaneFullscreen("canvas");
  const fullscreen = fitsContent ? undefined : paneFullscreen;
  const shownTheme = useShownTheme();
  const [fontScale] = useFontScale();
  const viewUrl = viewPath && `${assetsOrigin}${viewPath}`;
  const page = useMemo(() => viewUrl && pluginItemPage(viewUrl, item.id, { inTab: fitsContent, opensFiles: true }), [viewUrl, item.id, fitsContent]);
  const context: PluginItemContext = {
    seenAgentEditAt: seenWhenShown,
    imagesFromOtherSites,
    typingAids,
    opensIn,
    ...(fullscreen && { fullscreen: fullscreen.isFullscreen }),
  };
  const post = (message: unknown) => frame.current?.contentWindow?.postMessage(message, "*");
  const postItem = () => post(pluginItemMessage(pluginItemOf(latest.current), context));
  const postTheme = () => {
    const where = frame.current?.parentElement;
    if (where) post(pluginThemeMessage(themeVariables(where)));
  };

  useEffect(postItem, [item, imagesFromOtherSites, typingAids, opensIn, fullscreen?.isFullscreen]);
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

  const received = (message: CanvasFrameMessage) => {
    if (message.kind === "item-ready") {
      postTheme();
      postItem();
    }
    if (message.kind === "item-send" && typeof message.requestId === "string") void answer(message.requestId, () => replyTo(item.id, message.action));
    if (message.kind === "item-prompt" && typeof message.requestId === "string") {
      void answer(message.requestId, () => promptFrom(item.conversationId, String(message.text), enterWhileBusy === "after-turn"));
    }
    if (message.kind === "item-fullscreen") fullscreen?.setFullscreen(message.on === true);
    if (message.kind === "item-hint" && typeof message.text === "string" && frame.current) {
      const anchor = onPage(frame.current, message.anchor);
      showFramedHint(anchor && { text: message.text, anchor });
    }
    if (message.kind === "item-hint-gone") showFramedHint(null);
    if (message.kind === "item-open-file" && typeof message.path === "string") connection.send({ type: "files.open", conversationId: item.conversationId, path: message.path });
  };

  if (!page) return <WithoutItsPlugin item={item} />;
  return (
    <CanvasFrame
      frameId={item.id}
      html={page}
      assetsOrigin={assetsOrigin}
      className="plugin"
      fitsContent={fitsContent}
      padded={false}
      policy={{ imagesFromOtherSites }}
      allow="clipboard-write"
      frameRef={frame}
      onMessage={received}
    />
  );
}

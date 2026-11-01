import { useEffect, useMemo, useRef, useState } from "react";
import {
  appFileUrl,
  appKey,
  appMediaGrantUrl,
  appPromptText,
  MAX_APP_PROMPT_IMAGES,
  type AppDocumentState,
  type AppMediaGrant,
  type AppStorageItems,
  type InstalledApp,
  type OpenApp,
} from "../shared/apps.ts";
import {
  appAnswerFailedMessage,
  appAnswerMessage,
  appFileFailedMessage,
  appFileMessage,
  appStateMessage,
  appViewPage,
  type CanvasFrameMessage,
} from "../shared/canvas-document.ts";
import { useEnterWhileBusy } from "./busy-sending.ts";
import { CanvasFrame } from "./Canvas.tsx";
import { connection, type ConnectionStatus } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { uploadImage } from "./pasted-images.ts";
import { usePaneFullscreen } from "./Workspace.tsx";

const SENT_NOTE_MS = 8000;

/** How many views of each app the page shows, kept conversations' hidden canvases included. */
const viewsShowing = new Map<string, number>();

/**
 * The page gets the app's document while any of its views shows the app, and again after it reconnects. Each view
 * subscribes, for the host to send it the app's storage, but only the last one to go unsubscribes.
 */
function useAppSubscribed(openApp: OpenApp) {
  const { workspaceId, app } = openApp;
  const [status, setStatus] = useState<ConnectionStatus>(connection.status);
  useEffect(() => connection.onStatus(setStatus), []);
  useEffect(() => {
    if (status !== "open") return;
    const key = appKey(openApp);
    viewsShowing.set(key, (viewsShowing.get(key) ?? 0) + 1);
    connection.send({ type: "app.subscribe", workspaceId, app });
    return () => {
      const left = viewsShowing.get(key)! - 1;
      if (left) return void viewsShowing.set(key, left);
      viewsShowing.delete(key);
      connection.send({ type: "app.unsubscribe", workspaceId, app });
    };
  }, [status, workspaceId, app]);
}

/**
 * The app's storage in the workspace as the host sends it after this view mounts, for the view's page to start with. A
 * later change reaches the next page: the page that made it holds it already.
 */
function useStorageAtLoad(openApp: OpenApp) {
  const [atLoad, setAtLoad] = useState<{ key: string; items: AppStorageItems } | null>(null);
  const key = appKey(openApp);
  useEffect(
    () =>
      connection.onMessage((message) => {
        if (message.type === "app.storage" && appKey(message) === key) setAtLoad((known) => (known?.key === key ? known : { key, items: message.items }));
      }),
    [key],
  );
  return atLoad?.key === key ? atLoad.items : null;
}

/** The pictures a view sends with the user's words, or why they can't go. */
function picturesFrom(images: unknown): Blob[] {
  const pictures = Array.isArray(images) ? images : [];
  if (!pictures.every((picture) => picture instanceof Blob && picture.type.startsWith("image/"))) throw new Error("Only images can go with a message.");
  if (pictures.length > MAX_APP_PROMPT_IMAGES) throw new Error(`A message can carry at most ${MAX_APP_PROMPT_IMAGES} images.`);
  return pictures;
}

/** Sends what the user wrote in the view, with its pictures, to the conversation's agent, and says for a while that it went. */
function useAppPrompt(openApp: OpenApp, conversationId: string) {
  const enterWhileBusy = useEnterWhileBusy();
  const [sentAt, setSentAt] = useState<number | null>(null);
  useEffect(() => {
    if (sentAt === null) return;
    const timer = setTimeout(() => setSentAt(null), SENT_NOTE_MS);
    return () => clearTimeout(timer);
  }, [sentAt]);
  const prompt = async (text: unknown, images: unknown) => {
    if (typeof text !== "string" || !text.trim()) throw new Error("There is nothing to send.");
    const imageIds = await Promise.all(picturesFrom(images).map((picture) => uploadImage(conversationId, picture)));
    const message = { type: "conversation.prompt", conversationId, text: appPromptText(openApp, text), imageIds, afterTurn: enterWhileBusy === "after-turn" } as const;
    if (!connection.send(message)) throw new Error("Mirador is not connected.");
    setSentAt(Date.now());
  };
  return { prompt, sent: sentAt !== null };
}

/** The bytes of a file next to the app's document, or the host's reason it can't be had. */
async function fileForView(openApp: OpenApp, path: string) {
  const response = await fetch(appFileUrl(openApp, path));
  if (!response.ok) throw new Error((await response.text()) || `Mirador answered ${response.status}.`);
  return { bytes: await response.arrayBuffer(), type: response.headers.get("content-type") ?? "" };
}

/** The address on the canvas assets the view streams a file next to the app's document from. */
async function mediaUrlForView(openApp: OpenApp, path: string, assetsOrigin: string) {
  const response = await fetch(appMediaGrantUrl(openApp, path), { method: "POST" });
  if (!response.ok) throw new Error((await response.text()) || `Mirador answered ${response.status}.`);
  const grant: AppMediaGrant = await response.json();
  return `${assetsOrigin}${grant.path}`;
}

/** An app's view, live: its page loads once and every change to the document reaches it as a message. */
export function AppView({
  openApp,
  installed,
  documentState,
  assetsOrigin,
  conversationId,
}: {
  openApp: OpenApp;
  installed: InstalledApp;
  documentState: AppDocumentState | undefined;
  assetsOrigin: string;
  conversationId: string;
}) {
  const storageAtLoad = useStorageAtLoad(openApp);
  useAppSubscribed(openApp);
  const { prompt, sent } = useAppPrompt(openApp, conversationId);
  const fullscreen = usePaneFullscreen("canvas");
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(documentState);
  latest.current = documentState;
  const frameId = `app:${openApp.workspaceId}/${openApp.app}`;
  const viewUrl = `${assetsOrigin}${installed.viewPath}`;
  const page = useMemo(() => storageAtLoad && appViewPage(viewUrl, frameId, storageAtLoad), [viewUrl, frameId, storageAtLoad]);
  const postState = () => latest.current && frame.current?.contentWindow?.postMessage(appStateMessage(latest.current), "*");

  useEffect(postState, [documentState]);

  const sendFile = async (requestId: string, path: string) => {
    const answerTo = frame.current?.contentWindow;
    try {
      const { bytes, type } = await fileForView(openApp, path);
      answerTo?.postMessage(appFileMessage(requestId, bytes, type), "*", [bytes]);
    } catch (error) {
      answerTo?.postMessage(appFileFailedMessage(requestId, error instanceof Error ? error.message : String(error)), "*");
    }
  };

  const answer = async (requestId: string, answering: () => Promise<unknown>) => {
    const answerTo = frame.current?.contentWindow;
    try {
      answerTo?.postMessage(appAnswerMessage(requestId, (await answering()) ?? null), "*");
    } catch (error) {
      answerTo?.postMessage(appAnswerFailedMessage(requestId, error instanceof Error ? error.message : String(error)), "*");
    }
  };

  const { workspaceId, app } = openApp;
  const received = (message: CanvasFrameMessage) => {
    if (message.kind === "app-ready") postState();
    if (message.kind === "app-apply") connection.send({ type: "app.apply", workspaceId, app, op: message.op });
    if (message.kind === "app-prompt" && typeof message.requestId === "string") void answer(message.requestId, () => prompt(message.text, message.images));
    if (message.kind === "app-read-file" && typeof message.path === "string" && typeof message.requestId === "string") void sendFile(message.requestId, message.path);
    if (message.kind === "app-media-url" && typeof message.path === "string" && typeof message.requestId === "string") {
      const { path } = message;
      void answer(message.requestId, () => mediaUrlForView(openApp, path, assetsOrigin));
    }
    if (message.kind === "app-run" && typeof message.task === "string") connection.send({ type: "app.run", workspaceId, app, task: message.task });
    if (message.kind === "app-stop-task") connection.send({ type: "app.stop-task", workspaceId, app });
    if (message.kind === "app-storage-set" && typeof message.key === "string" && (typeof message.value === "string" || message.value === null)) {
      connection.send({ type: "app.storage-set", workspaceId, app, key: message.key, value: message.value });
    }
  };

  return (
    <div className="app-view">
      {documentState?.problem && (
        <p className="app-problem">
          {t.shell.appView.cannotRead(openApp.file, documentState.problem)}
        </p>
      )}
      {page && <CanvasFrame frameId={frameId} html={page} assetsOrigin={assetsOrigin} className="app" frameRef={frame} onMessage={received} />}
      {sent && (
        <div className="app-sent" role="status">
          {t.shell.appView.sent}
          {fullscreen?.isFullscreen && (
            <button type="button" className="link" onClick={() => fullscreen.setFullscreen(false)}>
              {t.shell.appView.showChat}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

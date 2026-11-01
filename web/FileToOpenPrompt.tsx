import { useEffect, useRef } from "react";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import type { AppAction, AppState } from "./state.ts";

/**
 * Before a link opens a file outside the workspace that the agent did not change: names the file that would open, and
 * opens that very file, so a link changed meanwhile cannot open another one. It takes the focus on Cancel, so a stray
 * Enter opens nothing.
 */
export function FileToOpenPrompt({ fileToOpen, dispatch }: { fileToOpen: AppState["fileToOpen"]; dispatch: (action: AppAction) => void }) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelButton.current?.focus(), [fileToOpen]);
  if (!fileToOpen) return null;
  const cancel = () => dispatch({ type: "dismiss-file-to-open" });
  const open = () => {
    connection.send({ type: "files.open", conversationId: fileToOpen.conversationId, path: fileToOpen.file, ownerAgreed: true });
    cancel();
  };
  return (
    <section
      className="file-to-open"
      role="alertdialog"
      aria-label={t.canvas.fileToOpen.title}
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
    >
      <h2>{t.canvas.fileToOpen.title}</h2>
      <p>
        <code>{fileToOpen.file}</code> {t.canvas.fileToOpen.outside}
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={open}>
          {t.canvas.fileToOpen.open}
        </button>
        <button ref={cancelButton} type="button" onClick={cancel}>
          {t.canvas.fileToOpen.cancel}
        </button>
      </div>
    </section>
  );
}

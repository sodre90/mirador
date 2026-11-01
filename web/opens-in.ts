import { createContext, useContext } from "react";
import { t } from "./i18n/index.ts";

/** The editor the host opens files in, by name; null when it finds none. */
export const OpensIn = createContext<string | null>(null);

export const useOpensIn = () => useContext(OpensIn);

export const openInLabel = (editor: string | null) => (editor ? t.canvas.changes.openIn(editor) : t.canvas.changes.openInEditor);

import { useEffect, useState } from "react";
import type { Attachment } from "./pasted-images.ts";

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function useStoredDraft<T>(key: string, decode: (stored: string | null) => T, encode: (value: T) => string | null) {
  const [draft, setDraft] = useState(() => decode(stored(key)));
  useEffect(() => {
    try {
      const encoded = encode(draft);
      if (encoded === null) localStorage.removeItem(key);
      else localStorage.setItem(key, encoded);
    } catch {}
  }, [key, draft]);
  return [draft, setDraft] as const;
}

/** What the user typed but hasn't sent, kept per conversation so switching away and back loses nothing. */
export const useDraft = (conversationId: string) =>
  useStoredDraft(`mirador-draft-${conversationId}`, (text) => text ?? "", (text) => text || null);

function decodeAttachments(json: string | null): Attachment[] {
  try {
    return json ? (JSON.parse(json) as Attachment[]) : [];
  } catch {
    return [];
  }
}

/** The images pasted into that unsent text. */
export const useDraftAttachments = (conversationId: string) =>
  useStoredDraft(`mirador-draft-images-${conversationId}`, decodeAttachments, (attachments) => (attachments.length > 0 ? JSON.stringify(attachments) : null));

export const joinDrafts = (...texts: string[]) => texts.filter((text) => text.trim()).join("\n\n");

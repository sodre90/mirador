import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { mentionAt, withMention, type MentionSuggestion } from "../shared/mentions.ts";
import { connection } from "./connection.ts";
import { SuggestionList, suggestionAttributes, suggestionKey, usePickedSuggestion } from "./SuggestionList.tsx";
import { t } from "./i18n/index.ts";

const LIST_ID = "mention-paths";

/** The host's suggestions for the query; the last ones stay shown while the next are on their way, so the list does not flicker. */
function useMentionSuggestions(conversationId: string, query: string | null) {
  const [answered, setAnswered] = useState<{ conversationId: string; suggestions: MentionSuggestion[] } | null>(null);
  useEffect(() => {
    if (query === null) return;
    const requestId = crypto.randomUUID();
    const unsubscribe = connection.onMessage((message) => {
      if (message.type === "mentions.suggested" && message.requestId === requestId) setAnswered({ conversationId, suggestions: message.suggestions });
    });
    connection.send({ type: "mentions.suggest", requestId, conversationId, query });
    return unsubscribe;
  }, [conversationId, query]);
  return query !== null && answered?.conversationId === conversationId ? answered.suggestions : [];
}

function MentionPath({ suggestion }: { suggestion: MentionSuggestion }) {
  const path = suggestion.path.replace(/\/$/, "");
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    <span className={`mention-path ${suggestion.directory ? "directory" : "file"}`}>
      <span className="mention-parent">{path.slice(0, path.length - name.length)}</span>
      <span className="mention-name">
        {name}
        {suggestion.directory ? "/" : ""}
      </span>
    </span>
  );
}

/**
 * Suggests paths for the @mention being written, as Claude Code does: ↑/↓ pick, Tab or Enter take one (a directory
 * stays open to go on into it), Esc puts them away.
 */
export function useMentionMenu({
  conversationId,
  text,
  caret,
  setText,
  setCaret,
  textarea,
}: {
  conversationId: string;
  text: string;
  caret: number;
  setText: (text: string) => void;
  setCaret: (caret: number) => void;
  textarea: RefObject<HTMLTextAreaElement | null>;
}) {
  const query = mentionAt(text, caret)?.query ?? null;
  const suggestions = useMentionSuggestions(conversationId, query);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const { pickedIndex, move } = usePickedSuggestion(suggestions.length, query);
  const open = suggestions.length > 0 && dismissedAt !== text;

  const take = (suggestion: MentionSuggestion) => {
    const next = withMention(text, caret, suggestion);
    setText(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  /** Handles the key if the menu is open and the key is one of its own; returns whether it did. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const key = open ? suggestionKey(event) : null;
    if (!key) return false;
    if (key === "next") move(1);
    else if (key === "previous") move(-1);
    else if (key === "dismiss") setDismissedAt(text);
    else take(suggestions[pickedIndex]!);
    event.preventDefault();
    return true;
  };

  const menu = open ? (
    <SuggestionList id={LIST_ID} label={t.chat.menus.paths} className="mention-paths" items={suggestions} keyOf={({ path }) => path} pickedIndex={pickedIndex} onPick={take}>
      {(suggestion) => <MentionPath suggestion={suggestion} />}
    </SuggestionList>
  ) : null;
  return { onKeyDown, textareaAttributes: suggestionAttributes(LIST_ID, open, pickedIndex), menu };
}

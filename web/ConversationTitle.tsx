import { useState, type KeyboardEvent } from "react";
import type { Conversation } from "../shared/model.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";
import { shownTitle } from "./shown-title.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

/** A conversation's title that turns into a text field for renaming: Enter or leaving the field saves, Esc cancels. */
export function ConversationTitle({
  conversation,
  startEditingOn,
  className,
}: {
  conversation: Conversation;
  startEditingOn: "click" | "double-click";
  className: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const typingAidAttributes = useTypingAidAttributes();
  const shown = shownTitle(conversation);

  const save = () => {
    const title = draft?.trim();
    setDraft(null);
    if (title && title !== shown) connection.send({ type: "conversation.rename", conversationId: conversation.id, title });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
    }
  };

  if (draft !== null) {
    return (
      <input
        {...typingAidAttributes}
        autoFocus
        className={`${className} rename`}
        aria-label={t.shell.conversationTitle.label}
        value={draft}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={save}
        onClick={(event) => event.stopPropagation()}
      />
    );
  }
  const startEditing = () => setDraft(shown);
  return (
    <span
      className={`${className} renamable`}
      title={startEditingOn === "click" ? t.shell.conversationTitle.clickToRename(shown) : t.shell.conversationTitle.doubleClickToRename(shown)}
      data-rename-trigger={startEditingOn}
      onClick={startEditingOn === "click" ? startEditing : undefined}
      onDoubleClick={startEditingOn === "double-click" ? startEditing : undefined}
    >
      {shown}
    </span>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/** What a key does to the suggestions shown over the message box. */
export type SuggestionKey = "next" | "previous" | "complete" | "choose" | "dismiss";

export function suggestionKey(event: KeyboardEvent<HTMLTextAreaElement>): SuggestionKey | null {
  if (event.nativeEvent.isComposing) return null;
  if (event.key === "ArrowDown") return "next";
  if (event.key === "ArrowUp") return "previous";
  if (event.key === "Tab" && !event.shiftKey) return "complete";
  if (event.key === "Enter" && !event.shiftKey) return "choose";
  if (event.key === "Escape") return "dismiss";
  return null;
}

/** Which suggestion is picked; back to the first whenever `startOver` changes. */
export function usePickedSuggestion(count: number, startOver: unknown) {
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    setPicked(0);
  }, [startOver]);
  const pickedIndex = Math.max(0, Math.min(picked, count - 1));
  const move = (step: 1 | -1) => setPicked((pickedIndex + step + count) % count);
  return { pickedIndex, move };
}

const optionId = (listId: string, index: number) => `${listId}-${index}`;

/** ARIA attributes tying the message box to the suggestions shown for it. */
export const suggestionAttributes = (listId: string, open: boolean, pickedIndex: number) => ({
  "aria-autocomplete": "list" as const,
  "aria-controls": open ? listId : undefined,
  "aria-activedescendant": open ? optionId(listId, pickedIndex) : undefined,
});

/** No suggestions shown: what a menu gives the message box while it has nothing to offer. */
export const noSuggestions = {
  onKeyDown: () => false,
  textareaAttributes: suggestionAttributes("", false, 0),
  menu: null,
};

export function SuggestionList<Item>({
  id,
  label,
  className,
  items,
  keyOf,
  pickedIndex,
  onPick,
  children,
}: {
  id: string;
  label: string;
  className: string;
  items: Item[];
  keyOf: (item: Item) => string;
  pickedIndex: number;
  onPick: (item: Item) => void;
  children: (item: Item) => ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector(`#${optionId(id, pickedIndex)}`)?.scrollIntoView({ block: "nearest" });
  }, [pickedIndex]);
  return (
    <ul ref={list} id={id} className={`composer-suggestions ${className}`} role="listbox" aria-label={label}>
      {items.map((item, index) => (
        <li
          key={keyOf(item)}
          id={optionId(id, index)}
          role="option"
          aria-selected={index === pickedIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(item)}
        >
          {children(item)}
        </li>
      ))}
    </ul>
  );
}

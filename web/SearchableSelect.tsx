import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { filterChoiceGroups, type Choice, type ChoiceGroup } from "./choices.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";

/** A select for long lists: opens a search box over the choices, grouped, and chosen from the keyboard or the pointer. */
export function SearchableSelect({
  label,
  hint,
  value,
  groups,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  groups: ChoiceGroup[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const typingAidAttributes = useTypingAidAttributes();
  const [activeValue, setActiveValue] = useState(value);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const optionId = (choiceValue: string) => `${listId}-${encodeURIComponent(choiceValue)}`;
  const allChoices = useMemo(() => groups.flatMap(({ choices }) => choices), [groups]);
  const visibleGroups = useMemo(() => filterChoiceGroups(groups, query), [groups, query]);
  const visibleChoices = useMemo(() => visibleGroups.flatMap(({ choices }) => choices), [visibleGroups]);
  const current = allChoices.find((choice) => choice.value === value);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) button.current?.focus();
  };
  const choose = (choice: Choice) => {
    if (choice.value !== value) onChange(choice.value);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    setActiveValue(value);
    const closeWhenOutside = (event: PointerEvent) => root.current?.contains(event.target as Node) || close(false);
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, [open]);

  useEffect(() => {
    const [first] = visibleChoices;
    if (first && !visibleChoices.some((choice) => choice.value === activeValue)) setActiveValue(first.value);
  }, [visibleChoices]);

  useLayoutEffect(() => {
    if (open) document.getElementById(optionId(activeValue))?.scrollIntoView({ block: "nearest" });
  }, [open, activeValue]);

  const onSearchKeyDown = (event: KeyboardEvent) => {
    const index = visibleChoices.findIndex((choice) => choice.value === activeValue);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = visibleChoices[Math.min(visibleChoices.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) setActiveValue(next.value);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = visibleChoices[index] ?? visibleChoices[0];
      if (chosen) choose(chosen);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  };

  return (
    <span className="config picker" ref={root} data-hint={open ? undefined : hint}>
      <span onClick={() => setOpen(true)}>{label}</span>
      <button
        ref={button}
        type="button"
        className="picker-button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {current?.name ?? value}
      </button>
      {open && (
        <div className="picker-popover">
          <input
            {...typingAidAttributes}
            autoFocus
            className="picker-search"
            role="combobox"
            aria-label={`Search ${label.toLowerCase()} choices`}
            aria-controls={listId}
            aria-expanded="true"
            aria-activedescendant={visibleChoices.length > 0 ? optionId(activeValue) : undefined}
            placeholder={`Search ${allChoices.length} choices…`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          <div className="picker-list" id={listId} role="listbox" aria-label={`${label} choices`}>
            {visibleGroups.map((group) => (
              <div key={group.name} role="group" aria-label={group.name || "Other"}>
                {group.name && <div className="picker-group-name">{group.name}</div>}
                {group.choices.map((choice) => (
                  <div
                    key={choice.value}
                    id={optionId(choice.value)}
                    role="option"
                    aria-selected={choice.value === value}
                    className={`picker-option ${choice.value === activeValue ? "active" : ""}`}
                    title={choice.description ?? undefined}
                    onPointerMove={() => setActiveValue(choice.value)}
                    onClick={() => choose(choice)}
                  >
                    {choice.label}
                  </div>
                ))}
              </div>
            ))}
            {visibleChoices.length === 0 && <div className="picker-empty">Nothing matches “{query}”.</div>}
          </div>
        </div>
      )}
    </span>
  );
}

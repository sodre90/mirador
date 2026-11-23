import type { KeyboardEvent } from "react";

const pageSteps: Partial<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowUp: -1 };

/** Which page each shows, for the panel beside the list: the list's tabs name it, and it names them. */
export const settingsPanel = (page: string) => ({ role: "tabpanel", id: "settings-page", "aria-labelledby": `settings-tab-${page}` }) as const;

/**
 * The pages of a settings dialog. Up and Down move between them, as in a list of tabs. No page is chosen while the
 * dialog shows something else, such as what a search found.
 */
export function SettingsPageList<Page extends string>({
  pages,
  labels,
  label,
  page,
  onChoose,
}: {
  pages: readonly Page[];
  labels: Record<Page, string>;
  label: string;
  page: Page | null;
  onChoose: (page: Page) => void;
}) {
  const chooseWithArrows = (event: KeyboardEvent<HTMLElement>) => {
    const step = pageSteps[event.key];
    if (!step) return;
    event.preventDefault();
    const next = page === null ? pages[0]! : pages[(pages.indexOf(page) + step + pages.length) % pages.length]!;
    onChoose(next);
    event.currentTarget.querySelector<HTMLElement>(`#settings-tab-${next}`)?.focus();
  };
  const reachedByTab = page ?? pages[0];
  return (
    <nav className="settings-pages" role="tablist" aria-orientation="vertical" aria-label={label} onKeyDown={chooseWithArrows}>
      {pages.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`settings-tab-${id}`}
          aria-selected={id === page}
          aria-controls="settings-page"
          tabIndex={id === reachedByTab ? 0 : -1}
          onClick={() => onChoose(id)}
        >
          {labels[id]}
        </button>
      ))}
    </nav>
  );
}

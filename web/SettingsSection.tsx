import { createContext, useContext, type HTMLAttributes, type ReactNode } from "react";
import { language } from "./language.ts";
import { foundBy } from "./settings-search.ts";

/** What Settings is searched for, and the name of the page searched, which finds every setting on it. */
interface SettingsSearch {
  query: string;
  page: string;
}

const SettingsSearchContext = createContext<SettingsSearch>({ query: "", page: "" });

export function SettingsSearchScope({ query, page, children }: SettingsSearch & { children: ReactNode }) {
  return <SettingsSearchContext.Provider value={{ query, page }}>{children}</SettingsSearchContext.Provider>;
}

function useFoundBySearch() {
  const { query, page } = useContext(SettingsSearchContext);
  return (texts: readonly string[]) => (query.trim() !== "" && foundBy(query, [page, ...texts], language)) || undefined;
}

/** Whether what a search found shows this title already, as the name of the page it is on. */
function useTitledByPage(title: string) {
  const { query, page } = useContext(SettingsSearchContext);
  return query.trim() !== "" && title === page;
}

/**
 * Attributes for a row of Settings, with its hint shown on pointing at it, marked found where the search finds its label
 * or hint. What a search found shows only the rows it found, unless it found their whole section (styles.css).
 */
export function useSettingRow() {
  const found = useFoundBySearch();
  return (label: string, hint?: string, ...foundAlsoBy: string[]) => ({
    "data-setting": "",
    "data-hint": hint,
    "data-found": found([label, hint ?? "", ...foundAlsoBy]),
  });
}

interface SettingsSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: string;
  /** Under the title, and searched where it is text. */
  hint?: ReactNode;
  /** More of what finds the whole section, such as the words of a hint that isn't plain text. */
  foundAlsoBy?: readonly string[];
  /** In place of the plain heading, such as one with a button beside it. */
  heading?: ReactNode;
}

/** A heading of Settings and the settings under it, all of them shown where the search finds the section itself. */
export function SettingsSection({ title, hint, foundAlsoBy = [], heading, className, children, ...attributes }: SettingsSectionProps) {
  const found = useFoundBySearch();
  const titledByPage = useTitledByPage(title);
  return (
    <section
      className={className ? `settings-section ${className}` : "settings-section"}
      data-found={found([title, ...(typeof hint === "string" ? [hint] : []), ...foundAlsoBy])}
      {...attributes}
    >
      {heading ? <div className="settings-section-heading">{heading}</div> : !titledByPage && <h3 className="settings-section-heading">{title}</h3>}
      {hint && <p className="hint settings-section-hint">{hint}</p>}
      {children}
    </section>
  );
}

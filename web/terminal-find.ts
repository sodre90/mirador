import type { ISearchOptions, ISearchResultChangeEvent } from "@xterm/addon-search";
import { t } from "./i18n/index.ts";

const words = t.terminals.find;

/** The search addon counts and highlights this many matches at most, from the top of the scrollback down. */
export const HIGHLIGHT_LIMIT = 1_000;

export interface FindToggles {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export const noToggles: FindToggles = { caseSensitive: false, wholeWord: false, regex: false };

/** The terminal stays dark in both app themes, so these are the conversation's dark find colours, with the text kept readable on them. */
const matchColours = {
  matchBackground: "#4a3c10",
  matchOverviewRuler: "#5c4a0f",
  activeMatchBackground: "#7a5410",
  activeMatchBorder: "#ffb340",
  activeMatchColorOverviewRuler: "#ffb340",
};

export const searchOptions = (toggles: FindToggles): ISearchOptions => ({ ...toggles, decorations: matchColours });

function isValidPattern(query: string) {
  try {
    new RegExp(query);
    return true;
  } catch {
    return false;
  }
}

/** The addon throws on a regular expression that does not compile, so such a query is not searched for. */
export const isSearchable = (query: string, toggles: FindToggles) => query !== "" && (!toggles.regex || isValidPattern(query));

/** Where the current match is among them all, counted from the top, or why there is none. */
export function findTally(query: string, toggles: FindToggles, results: ISearchResultChangeEvent | null) {
  if (query === "") return "";
  if (!isSearchable(query, toggles)) return words.invalidPattern;
  if (!results || results.resultCount === 0) return words.noMatches;
  const total = results.resultCount >= HIGHLIGHT_LIMIT ? `${HIGHLIGHT_LIMIT}+` : String(results.resultCount);
  return results.resultIndex >= 0 ? words.position(results.resultIndex + 1, total) : words.matches(total);
}

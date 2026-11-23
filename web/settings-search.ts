/** As Settings search compares it: lower case in the page's language, without accents, so "mellekszal" finds "Mellékszálak". */
export const foldedForSearch = (text: string, language: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase(language);

/** Whether each word of the query is somewhere in the texts, in any order; a query of no words finds everything. */
export function foundBy(query: string, texts: readonly string[], language: string) {
  const searched = foldedForSearch(texts.join("\n"), language);
  return foldedForSearch(query, language)
    .split(/\s+/)
    .filter((word) => word !== "")
    .every((word) => searched.includes(word));
}

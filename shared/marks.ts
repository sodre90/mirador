/** The colours a workspace's mark takes by its name, whatever its pastel, so the mark stands out on the card's tint. */
const workspaceMarkColors = ["#6e56cf", "#0e9384", "#d9822b", "#3e63dd", "#d6409f", "#12a594", "#8e4ec6", "#ad7f58"];

export function workspaceMarkColor(name: string) {
  const hash = [...name].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 7);
  return workspaceMarkColors[hash % workspaceMarkColors.length]!;
}

const firstCharacters = (text: string, count: number) => [...text].slice(0, count).join("");

/**
 * What a workspace's or a machine's mark reads: the first letters of two words, or the first two of one. A name
 * without letters or digits, such as one of only emoji, shows its first two characters whole, and an empty one "?".
 * Names are composed first, as macOS may give a folder's name decomposed.
 */
export function markInitials(name: string) {
  const composed = name.normalize("NFC").trim();
  const words = composed.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’]*/gu) ?? [];
  const initials =
    words.length > 1 ? words.slice(0, 2).map((word) => firstCharacters(word, 1)).join("") : firstCharacters(words[0]?.replace(/['’]/g, "") ?? composed, 2);
  return initials.toUpperCase() || "?";
}

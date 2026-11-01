/** Words as speech recognition wrote them, for matching what was said: lower case, without punctuation. */
export const spokenWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Without the words around what was meant, so "OK, repeat that, please" is "repeat that". */
export const withoutPoliteness = (said: string) =>
  said.replace(/^((please|ok|okay|um|uh|well|can you|could you|would you)\s+)+|(\s+(please|then|thanks|thank you))+$/g, "").trim();

const graphemer = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const graphemesOf = (text: string) => Array.from(graphemer.segment(text), ({ segment }) => segment);

export const firstGraphemes = (text: string, count: number) => graphemesOf(text).slice(0, count).join("");

export const cutWithEllipsis = (text: string, keep: number, cutWhenLongerThan = keep) => {
  const graphemes = graphemesOf(text);
  return graphemes.length > cutWhenLongerThan ? `${graphemes.slice(0, keep).join("")}…` : text;
};

export const lastGraphemes = (text: string, count: number) => graphemesOf(text).slice(-count).join("");

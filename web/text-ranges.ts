import { matchOffsets, type MatchOptions } from "../shared/find.ts";

/** Text nodes read as one string, so a match may span the elements that markdown and code highlighting split it into. */
export function joinedText(nodes: Text[]) {
  let length = 0;
  const pieces = nodes.map((node) => {
    const start = length;
    length += node.data.length;
    return { node, start };
  });
  return { pieces, text: pieces.map(({ node }) => node.data).join("") };
}

/** A range over each of the first `limit` matches of the query in the text nodes, read as one string. */
export function rangesOver(nodes: Text[], query: string, options: MatchOptions, limit = Infinity): Range[] {
  const { pieces, text } = joinedText(nodes);
  const at = (offset: number, holds: (start: number) => boolean) => {
    const piece = pieces.findLast(({ start }) => holds(start))!;
    return [piece.node, offset - piece.start] as const;
  };
  return matchOffsets(text, query, options)
    .slice(0, limit)
    .map(([start, end]) => {
      const range = document.createRange();
      range.setStart(...at(start, (pieceStart) => pieceStart <= start));
      range.setEnd(...at(end, (pieceStart) => pieceStart < end));
      return range;
    });
}

/** Scrolls the scroller itself, never the panes around it as scrollIntoView would, so the box sits in its middle. */
export function scrollToMiddle(scroller: HTMLElement, box: { top: number; height: number }) {
  scroller.scrollTop += box.top - scroller.getBoundingClientRect().top - (scroller.clientHeight - box.height) / 2;
}

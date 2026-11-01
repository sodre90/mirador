export type Direction = "left" | "right" | "up" | "down";

export interface PlacedTerminal {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Splits share an edge, give or take the divider and rounding. */
const EDGE_SLACK = 12;

const isAhead = (from: PlacedTerminal, other: PlacedTerminal, direction: Direction) => {
  switch (direction) {
    case "left":
      return other.right <= from.left + EDGE_SLACK;
    case "right":
      return other.left >= from.right - EDGE_SLACK;
    case "up":
      return other.bottom <= from.top + EDGE_SLACK;
    case "down":
      return other.top >= from.bottom - EDGE_SLACK;
  }
};

const isHorizontal = (direction: Direction) => direction === "left" || direction === "right";

const gapTo = (from: PlacedTerminal, other: PlacedTerminal, direction: Direction) =>
  isHorizontal(direction) ? Math.max(other.left - from.right, from.left - other.right) : Math.max(other.top - from.bottom, from.top - other.bottom);

const overlapWith = (from: PlacedTerminal, other: PlacedTerminal, direction: Direction) =>
  isHorizontal(direction)
    ? Math.min(from.bottom, other.bottom) - Math.max(from.top, other.top)
    : Math.min(from.right, other.right) - Math.max(from.left, other.left);

/** The nearest terminal that way, preferring the one beside the most of this one's edge, as iTerm2 and cmux pick; none at the edge. */
export function terminalToward(placed: PlacedTerminal[], fromId: string, direction: Direction): string | null {
  const from = placed.find(({ id }) => id === fromId);
  if (!from) return null;
  const ahead = placed.filter((other) => other.id !== fromId && isAhead(from, other, direction));
  const beside = ahead.filter((other) => overlapWith(from, other, direction) > 0);
  const [nearest] = (beside.length > 0 ? beside : ahead).toSorted(
    (a, b) => gapTo(from, a, direction) - gapTo(from, b, direction) || overlapWith(from, b, direction) - overlapWith(from, a, direction),
  );
  return nearest?.id ?? null;
}

/** The next or previous terminal in reading order, going round. */
export function terminalAfter(terminalIds: string[], fromId: string, step: 1 | -1): string | null {
  const index = terminalIds.indexOf(fromId);
  if (index === -1 || terminalIds.length < 2) return null;
  return terminalIds[(index + step + terminalIds.length) % terminalIds.length]!;
}

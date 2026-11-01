/** Side by side (columns) or one above the other (rows). */
export type SplitAxis = "columns" | "rows";

/** How a tab's terminals sit: one terminal, or terminals and groups of them along an axis. */
export type TerminalLayout = { terminalId: string } | { axis: SplitAxis; children: TerminalLayout[] };

export type TerminalGroup = Extract<TerminalLayout, { axis: SplitAxis }>;

export const isTerminal = (layout: TerminalLayout): layout is { terminalId: string } => "terminalId" in layout;

/** In reading order: left to right, top to bottom. */
export const terminalsIn = (layout: TerminalLayout): string[] => (isTerminal(layout) ? [layout.terminalId] : layout.children.flatMap(terminalsIn));

/** Keeps a group's key while terminals come and go after its first one, so it keeps its size. */
export const layoutKey = (layout: TerminalLayout) => (isTerminal(layout) ? layout.terminalId : `${layout.axis}:${terminalsIn(layout)[0]}`);

/** The new terminal goes right after the split one: beside it for columns, below it for rows. */
export function splitTerminal(layout: TerminalLayout, terminalId: string, newTerminalId: string, axis: SplitAxis): TerminalLayout {
  const added = { terminalId: newTerminalId };
  if (isTerminal(layout)) return layout.terminalId === terminalId ? { axis, children: [layout, added] } : layout;
  const index = layout.children.findIndex((child) => isTerminal(child) && child.terminalId === terminalId);
  if (index !== -1 && layout.axis === axis) return { ...layout, children: layout.children.toSpliced(index + 1, 0, added) };
  return { ...layout, children: layout.children.map((child) => splitTerminal(child, terminalId, newTerminalId, axis)) };
}

/** The others close up: a group left with one member gives way to it, and one along its parent's axis joins the parent. */
export function withoutTerminal(layout: TerminalLayout, terminalId: string): TerminalLayout | null {
  if (isTerminal(layout)) return layout.terminalId === terminalId ? null : layout;
  const children = layout.children
    .map((child) => withoutTerminal(child, terminalId))
    .filter((child) => child !== null)
    .flatMap((child) => (!isTerminal(child) && child.axis === layout.axis ? child.children : [child]));
  if (children.length === 0) return null;
  return children.length === 1 ? children[0]! : { ...layout, children };
}

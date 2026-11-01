import { t } from "./i18n/index.ts";

export type PaneId = "conversation" | "canvas" | "terminals";
export type HideablePane = Exclude<PaneId, "conversation">;

/** Which pane is on the left (full height), right top and right bottom. */
export type Slots = readonly [PaneId, PaneId, PaneId];

export interface LayoutDefault {
  slots: Slots;
  hidden: Record<HideablePane, boolean>;
}

export interface PaneLayout extends LayoutDefault {
  leftShare: number;
  topShare: number;
  fullscreen: PaneId | null;
  /**
   * The time of the agent's latest news on the canvas when the user last hid it, in the host's clock as the news has
   * it: newer news shows it again. Missing from layouts kept before it was.
   */
  canvasHiddenAfter?: number;
}

export const paneLabels: Record<PaneId, string> = t.labels.pane;

export const DEFAULT_LEFT_SHARE = 0.45;
export const DEFAULT_TOP_SHARE = 0.55;

export const FACTORY_DEFAULT: LayoutDefault = { slots: ["conversation", "canvas", "terminals"], hidden: { canvas: false, terminals: true } };

const panes: PaneId[] = ["conversation", "canvas", "terminals"];

export const arrangements: Slots[] = panes.flatMap((left) => {
  const [top, bottom] = panes.filter((pane) => pane !== left) as [PaneId, PaneId];
  return [
    [left, top, bottom],
    [left, bottom, top],
  ] as Slots[];
});

export const sameSlots = (a: Slots, b: Slots) => a.every((pane, index) => pane === b[index]);

export const layoutFrom = (layoutDefault: LayoutDefault): PaneLayout => ({
  ...layoutDefault,
  leftShare: DEFAULT_LEFT_SHARE,
  topShare: DEFAULT_TOP_SHARE,
  fullscreen: null,
});

export function swapPanes(layout: PaneLayout, first: PaneId, second: PaneId): PaneLayout {
  const slots = layout.slots.map((pane) => (pane === first ? second : pane === second ? first : pane)) as unknown as Slots;
  return { ...layout, slots };
}

const fullscreenPaneOf = (layout: PaneLayout) =>
  layout.fullscreen === "conversation" || (layout.fullscreen && !layout.hidden[layout.fullscreen]) ? layout.fullscreen : null;

/** Shown, and not covered by another pane in fullscreen. */
export function inView(layout: PaneLayout, pane: HideablePane) {
  const fullscreen = fullscreenPaneOf(layout);
  return !layout.hidden[pane] && (fullscreen === null || fullscreen === pane);
}

/** Hides a pane in view; shows one that is hidden or covered, leaving the fullscreen that would cover it. */
export function toggledInView(layout: PaneLayout, pane: HideablePane): PaneLayout {
  if (inView(layout, pane)) return { ...layout, hidden: { ...layout.hidden, [pane]: true } };
  return { ...layout, hidden: { ...layout.hidden, [pane]: false }, fullscreen: null };
}

const isShare = (value: unknown): value is number => typeof value === "number" && value > 0 && value < 1;

const isSlots = (value: unknown): value is Slots =>
  Array.isArray(value) && arrangements.some((arrangement) => sameSlots(arrangement, value as unknown as Slots));

const isHidden = (value: unknown): value is Record<HideablePane, boolean> =>
  typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).canvas === "boolean" && typeof (value as Record<string, unknown>).terminals === "boolean";

export const isLayoutDefault = (value: unknown): value is LayoutDefault =>
  typeof value === "object" && value !== null && isSlots((value as LayoutDefault).slots) && isHidden((value as LayoutDefault).hidden);

const isPaneOrNone = (value: unknown) => value === null || panes.includes(value as PaneId);

export const isPaneLayout = (value: unknown): value is PaneLayout =>
  isLayoutDefault(value) && isShare((value as PaneLayout).leftShare) && isShare((value as PaneLayout).topShare) && isPaneOrNone((value as PaneLayout).fullscreen);

const LEFT_AREA = "1 / 1 / 4 / 2";
const TOP_AREA = "1 / 3 / 2 / 4";
const BOTTOM_AREA = "3 / 3 / 4 / 4";
const WHOLE_AREA = "1 / 1 / 4 / 4";

export interface Placement {
  columns: string;
  rows: string;
  areas: Partial<Record<PaneId, string>>;
  columnDivider: string | null;
  rowDivider: string | null;
  /** The pane in the top-left corner, where the button that shows a hidden sidebar sits over its bar. */
  topLeft: PaneId | null;
}

const split = (share: number) => `minmax(0, ${share}fr) var(--splitter-width) minmax(0, ${1 - share}fr)`;
const firstTrackOnly = "minmax(0, 1fr) 0 0";
const lastTrackOnly = "0 0 minmax(0, 1fr)";

/**
 * Places the shown panes on a 3×3 grid whose middle tracks hold the dividers. A pane keeps its slot's area whatever
 * else is shown; hiding a pane only collapses its tracks, so the others never move to another element and reload.
 */
export function placement(layout: PaneLayout, shown: Record<PaneId, boolean>, fullscreen: PaneId | null): Placement {
  const [left, top, bottom] = layout.slots.map((pane) => (shown[pane] ? pane : null));
  const right = Boolean(top || bottom);
  const areas: Partial<Record<PaneId, string>> = {};
  if (left) areas[left] = LEFT_AREA;
  if (top) areas[top] = TOP_AREA;
  if (bottom) areas[bottom] = BOTTOM_AREA;
  if (fullscreen && shown[fullscreen]) areas[fullscreen] = WHOLE_AREA;
  const isFullscreen = Boolean(fullscreen && shown[fullscreen]);
  return {
    columns: left && right ? split(layout.leftShare) : left ? firstTrackOnly : lastTrackOnly,
    rows: top && bottom ? split(layout.topShare) : bottom ? lastTrackOnly : firstTrackOnly,
    areas,
    columnDivider: left && right && !isFullscreen ? "1 / 2 / 4 / 3" : null,
    rowDivider: top && bottom && !isFullscreen ? "2 / 3 / 3 / 4" : null,
    topLeft: isFullscreen ? fullscreen : (left ?? top ?? bottom),
  };
}

export const DEFAULT_SIDEBAR_WIDTH = 256;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;

export const sidebarWidthWithinLimits = (width: number) => Math.round(Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH));

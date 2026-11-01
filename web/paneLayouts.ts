import { useEffect, useState } from "react";
import {
  DEFAULT_SIDEBAR_WIDTH,
  FACTORY_DEFAULT,
  isLayoutDefault,
  isPaneLayout,
  layoutFrom,
  sidebarWidthWithinLimits,
  type LayoutDefault,
  type PaneLayout,
} from "./layout.ts";

const LAYOUTS_KEY = "mirador-conversation-layouts";
/** Where layouts were kept per workspace, before each conversation had its own. */
const WORKSPACE_LAYOUTS_KEY = "mirador-layouts";
const DEFAULT_KEY = "mirador-default-layout";
const SIDEBAR_WIDTH_KEY = "mirador-sidebar-width";
const SETTINGS_SIZE_KEY = "mirador-settings-size";
const SIDEBAR_HIDDEN_KEY = "mirador-sidebar-hidden";

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function storedLayouts(): Record<string, PaneLayout> {
  const stored = readJson(LAYOUTS_KEY);
  if (typeof stored !== "object" || stored === null) return {};
  return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, PaneLayout] => isPaneLayout(entry[1])));
}

function storedDefault(): LayoutDefault {
  const stored = readJson(DEFAULT_KEY);
  return isLayoutDefault(stored) ? stored : FACTORY_DEFAULT;
}

function forget(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

/**
 * Each conversation's arrangement, sizes, hidden panes and fullscreen pane, kept per browser. A conversation never
 * changed, a new one included, follows the default.
 */
export function useConversationLayouts() {
  const [layouts, setLayouts] = useState(storedLayouts);
  const [layoutDefault, setLayoutDefault] = useState(storedDefault);
  useEffect(() => writeJson(LAYOUTS_KEY, layouts), [layouts]);
  useEffect(() => writeJson(DEFAULT_KEY, layoutDefault), [layoutDefault]);
  useEffect(() => forget(WORKSPACE_LAYOUTS_KEY), []);

  const layoutOf = (conversationId: string | null) => (conversationId && layouts[conversationId]) || layoutFrom(layoutDefault);

  const change = (conversationId: string | null, update: (layout: PaneLayout) => PaneLayout) => {
    if (!conversationId) return;
    setLayouts((current) => ({ ...current, [conversationId]: update(current[conversationId] ?? layoutFrom(layoutDefault)) }));
  };

  const reset = (conversationId: string) =>
    setLayouts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== conversationId)));

  const forgetAllBut = (conversationIds: string[]) =>
    setLayouts((current) => {
      const kept = Object.entries(current).filter(([id]) => conversationIds.includes(id));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });

  return { layoutOf, change, reset, forgetAllBut, layoutDefault, setLayoutDefault };
}

function storedSidebarWidth() {
  const stored = readJson(SIDEBAR_WIDTH_KEY);
  return typeof stored === "number" ? sidebarWidthWithinLimits(stored) : DEFAULT_SIDEBAR_WIDTH;
}

/** The sidebar's width in pixels, the same for every workspace and kept per browser. */
export function useSidebarWidth() {
  const [width, setWidth] = useState(storedSidebarWidth);
  useEffect(() => writeJson(SIDEBAR_WIDTH_KEY, width), [width]);
  return [width, (next: number) => setWidth(sidebarWidthWithinLimits(next))] as const;
}

/** Whether the sidebar is hidden, for every workspace and kept per browser. */
export function useSidebarHidden() {
  const [hidden, setHidden] = useState(() => readJson(SIDEBAR_HIDDEN_KEY) === true);
  useEffect(() => writeJson(SIDEBAR_HIDDEN_KEY, hidden), [hidden]);
  return [hidden, setHidden] as const;
}

interface DialogSize {
  width: number;
  height: number;
}

const isDialogSize = (value: unknown): value is DialogSize =>
  typeof value === "object" && value !== null && [(value as DialogSize).width, (value as DialogSize).height].every((side) => typeof side === "number" && side > 0);

const sizeOf = (dialog: HTMLElement): DialogSize => ({ width: dialog.offsetWidth, height: dialog.offsetHeight });

/**
 * A ref for the Settings dialog: it opens at the size the user last dragged it to, kept per browser. Only a drag of its
 * corner is kept, not a squeeze by a small window.
 */
export function rememberSettingsSize(dialog: HTMLElement | null) {
  if (!dialog) return;
  const stored = readJson(SETTINGS_SIZE_KEY);
  if (isDialogSize(stored)) {
    dialog.style.width = `${stored.width}px`;
    dialog.style.height = `${stored.height}px`;
  }
  let sizeBefore = sizeOf(dialog);
  const keepDraggedSize = () => {
    const size = sizeOf(dialog);
    if (size.width === sizeBefore.width && size.height === sizeBefore.height) return;
    sizeBefore = size;
    writeJson(SETTINGS_SIZE_KEY, size);
  };
  dialog.addEventListener("pointerup", keepDraggedSize);
  return () => dialog.removeEventListener("pointerup", keepDraggedSize);
}
